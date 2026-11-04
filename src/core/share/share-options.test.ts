import { beforeEach, describe, expect, it } from 'vitest'
import { generateKek } from '@/adapters/crypto/webcrypto-crypto'
import { MemoryShare } from '@/adapters/share/memory-share'
import { ShareError } from '@/adapters/share/types'
import { createShareService, openSharedLink } from './share-service'
import { buildShareSnapshot, type ShareSnapshot } from './snapshot'

/** Phase 4b: expiry, password, renewing a link, listing all links. */

const snap = (text: string, at = 1): ShareSnapshot =>
  buildShareSnapshot({ title: '標題', doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] }, sharedAt: at, linkLabel: () => null })
const ORIGIN = 'https://notes.example'
const DAY = 86_400
const errKind = async (p: Promise<unknown>) => {
  try {
    await p
  } catch (e) {
    expect(e).toBeInstanceOf(ShareError)
    return (e as ShareError).kind
  }
  throw new Error('expected a ShareError')
}
const latin1 = (b: Uint8Array) => new TextDecoder('latin1').decode(b)

describe('share options (phase 4b)', () => {
  let now: number
  let store: MemoryShare
  let kek: CryptoKey
  let service: ReturnType<typeof createShareService>
  /** Another device of the same account. */
  let other: ReturnType<typeof createShareService>
  const open = (url: string, password?: string) => openSharedLink(store, new URL(url), undefined, password)

  beforeEach(async () => {
    now = 1_000_000
    store = new MemoryShare(() => now++)
    kek = await generateKek()
    const account = { userId: 'u1', vaultId: 'v1', kek }
    service = createShareService({ adapter: store, account: () => account, origin: ORIGIN })
    other = createShareService({ adapter: store, account: () => account, origin: ORIGIN })
  })

  describe('expiry', () => {
    it('is counted by the server clock; an expired link does not open; "never" makes it open again', async () => {
      const { url, record } = await service.create('n1', snap('a'))
      const at = await service.setExpiry(record.id, DAY)
      expect(at).toBeGreaterThanOrEqual(1_000_000 + DAY * 1000)
      expect(await open(url)).toEqual(snap('a'))
      now += DAY * 1000
      expect(await errKind(open(url))).toBe('expired')
      // an expired link is kept, not deleted; the owner can bring it back
      const [listed] = await service.listForNote('n1')
      expect(listed.expiresAt).toBe(at)
      expect(await service.setExpiry(record.id, null)).toBeNull()
      expect(await open(url)).toEqual(snap('a'))
    })

    it('an expired protected link says expired, not "needs a password"', async () => {
      const { url, record } = await service.create('n1', snap('a'))
      await service.setPassword(record.id, '六個字的密碼')
      await service.setExpiry(record.id, DAY)
      now += DAY * 1000
      expect(await errKind(open(url))).toBe('expired')
      expect(await errKind(open(url, '六個字的密碼'))).toBe('expired')
    })

    it('does not change the snapshot time, and refuses odd durations', async () => {
      const { record } = await service.create('n1', snap('a'))
      const before = (await service.listForNote('n1'))[0].updatedAt
      await service.setExpiry(record.id, 7 * DAY)
      expect((await service.listForNote('n1'))[0].updatedAt).toBe(before)
      for (const s of [0, -1, 1.5, 400 * DAY]) expect(await errKind(service.setExpiry(record.id, s))).toBe('invalid')
      await service.stop(record.id)
      expect(await errKind(service.setExpiry(record.id, DAY))).toBe('not-found')
    })
  })

  describe('password', () => {
    it('without the password nothing is handed out; the wrong one is refused; the right one opens it', async () => {
      const { url, record } = await service.create('n1', snap('秘密'))
      await service.setPassword(record.id, 'correct horse')
      expect(await store.getPublic(record.id)).toEqual({ status: 'password', saltB64: expect.any(String), iterations: 600_000 })
      expect(await errKind(open(url))).toBe('password-required')
      expect(await errKind(open(url, 'wrong horse'))).toBe('wrong-password')
      expect(await open(url, 'correct horse')).toEqual(snap('秘密'))
    })

    it('the link alone cannot decrypt the stored snapshot, and nothing stored contains the password', async () => {
      const { url, record } = await service.create('n1', snap('秘密'))
      await service.setPassword(record.id, 'correct horse')
      const row = store.rows.get(record.id)!
      const stored = latin1(row.ciphertext) + latin1(row.verifier!) + JSON.stringify(row.password)
      expect(stored).not.toContain('correct horse')
      // a server that hands out the ciphertext anyway: the link key does not open it
      const leaky = { getPublic: async () => ({ status: 'ok' as const, ciphertext: row.ciphertext }), openProtected: store.openProtected.bind(store) }
      expect(await errKind(openSharedLink(leaky, new URL(url)))).toBe('invalid')
    })

    it('a password needs at least 6 characters (not bytes)', async () => {
      const { url, record } = await service.create('n1', snap('a'))
      expect(await errKind(service.setPassword(record.id, '12345'))).toBe('weak-password')
      expect(await errKind(service.setPassword(record.id, '密碼五個字'))).toBe('weak-password')
      await service.setPassword(record.id, '密碼有六個字')
      expect(await open(url, '密碼有六個字')).toEqual(snap('a'))
    })

    it('updating the snapshot keeps the password, from any device, without asking for it', async () => {
      const { url, record } = await service.create('n1', snap('舊', 1))
      await service.setPassword(record.id, 'correct horse')
      const [listed] = await other.listForNote('n1')
      await other.update(listed, snap('新', 2))
      expect(await errKind(open(url))).toBe('password-required')
      expect(await open(url, 'correct horse')).toEqual(snap('新', 2))
    })

    it('changing the password: the old one stops working at once, the new one works, the link stays the same', async () => {
      const { url, record } = await service.create('n1', snap('a'))
      await service.setPassword(record.id, 'old password')
      // someone captured the old proof (or the old ciphertext) before the change
      const oldCiphertext = store.rows.get(record.id)!.ciphertext
      await other.setPassword(record.id, 'new password')
      expect(await errKind(open(url, 'old password'))).toBe('wrong-password')
      expect(await open(url, 'new password')).toEqual(snap('a'))
      expect(latin1(store.rows.get(record.id)!.ciphertext)).not.toBe(latin1(oldCiphertext))
      expect(await other.linkFor((await other.listForNote('n1'))[0])).toBe(url)
    })

    it('changing the password does not change the snapshot time', async () => {
      const { record } = await service.create('n1', snap('a'))
      const before = (await service.listForNote('n1'))[0].updatedAt
      await service.setPassword(record.id, 'correct horse')
      expect((await service.listForNote('n1'))[0].updatedAt).toBe(before)
    })

    it('removing the password: the old one stops mattering, the link alone opens it again', async () => {
      const { url, record } = await service.create('n1', snap('a'))
      await service.setPassword(record.id, 'correct horse')
      const r = await service.setPassword(record.id, null)
      expect(r.password).toBeNull()
      expect(store.rows.get(record.id)!.verifier).toBeNull()
      expect(await open(url)).toEqual(snap('a'))
    })

    it('a viewer who was asked for the password while the owner removed it still gets the note', async () => {
      const { url, record } = await service.create('n1', snap('a'))
      await service.setPassword(record.id, 'correct horse')
      const asked = await store.getPublic(record.id)
      await service.setPassword(record.id, null)
      const raced = { getPublic: async () => asked, openProtected: store.openProtected.bind(store) }
      expect(await openSharedLink(raced, new URL(url), undefined, 'anything')).toEqual(snap('a'))
    })

    it('an update computed before another device changed the password is redone with the new key', async () => {
      const { url, record } = await service.create('n1', snap('a', 1))
      const stale = (await service.listForNote('n1'))[0]
      await other.setPassword(record.id, 'correct horse')
      await service.update(stale, snap('b', 2))
      expect(await open(url, 'correct horse')).toEqual(snap('b', 2))
    })

    it('a server that asks for an absurd number of iterations (slow-down) or a weak setting is refused', async () => {
      const { url, record } = await service.create('n1', snap('a'))
      await service.setPassword(record.id, 'correct horse')
      for (const iterations of [1, 99_999, 50_000_000]) {
        store.rows.get(record.id)!.password!.iterations = iterations
        expect(await errKind(open(url, 'correct horse'))).toBe('invalid')
      }
    })
  })

  describe('a snapshot update from another device in the middle (4b review)', () => {
    /** The adapter, with `between` run right after the first `getOwn` (another device acting meanwhile). */
    const racing = (between: () => Promise<void>) => {
      let once = true
      const raced = Object.create(store) as MemoryShare
      raced.getOwn = async (id: string) => {
        const r = await store.getOwn(id)
        if (once) {
          once = false
          await between()
        }
        return r
      }
      return createShareService({ adapter: raced, account: () => ({ userId: 'u1', vaultId: 'v1', kek }), origin: ORIGIN })
    }

    it('changing the password does not bring back the older snapshot', async () => {
      const { url, record } = await service.create('n1', snap('舊', 1))
      const slow = racing(async () => other.update((await other.listForNote('n1'))[0], snap('新', 2)))
      await slow.setPassword(record.id, 'correct horse')
      expect(await open(url, 'correct horse')).toEqual(snap('新', 2))
    })

    it('renewing the link does not bring back the older snapshot', async () => {
      const { record } = await service.create('n1', snap('舊', 1))
      const slow = racing(async () => other.update((await other.listForNote('n1'))[0], snap('新', 2)))
      const renewed = await slow.renew(record.id)
      expect(await open(renewed.url)).toEqual(snap('新', 2))
    })
  })

  describe('renew', () => {
    it('the old link stops at once; the new one shows the same snapshot, expiry and snapshot time', async () => {
      const { url, record } = await service.create('n1', snap('a'))
      const expiresAt = await service.setExpiry(record.id, 7 * DAY)
      const before = (await service.listForNote('n1'))[0]
      const renewed = await service.renew(record.id)
      expect(renewed.url).not.toBe(url)
      expect(await errKind(open(url))).toBe('not-found')
      expect(await open(renewed.url)).toEqual(snap('a'))
      const [listed] = await service.listForNote('n1')
      expect(listed).toMatchObject({ id: renewed.record.id, noteId: 'n1', expiresAt, updatedAt: before.updatedAt, password: null })
      expect(await service.linkFor(listed)).toBe(renewed.url)
    })

    it('keeps the password: the same password opens the new link, the old link is gone', async () => {
      const { url, record } = await service.create('n1', snap('a'))
      await service.setPassword(record.id, 'correct horse')
      const renewed = await other.renew(record.id)
      expect(await errKind(open(url, 'correct horse'))).toBe('not-found')
      expect(await errKind(open(renewed.url))).toBe('password-required')
      expect(await errKind(open(renewed.url, 'wrong horse'))).toBe('wrong-password')
      expect(await open(renewed.url, 'correct horse')).toEqual(snap('a'))
      // and the owner can still update it without the password
      const [listed] = await service.listForNote('n1')
      await service.update(listed, snap('b', 2))
      expect(await open(renewed.url, 'correct horse')).toEqual(snap('b', 2))
    })

    it('a stopped link cannot be renewed', async () => {
      const { record } = await service.create('n1', snap('a'))
      await service.stop(record.id)
      expect(await errKind(service.renew(record.id))).toBe('not-found')
    })
  })

  it('lists every link of the vault, newest first, with expiry and whether it has a password', async () => {
    const a = await service.create('n1', snap('a'))
    const b = await service.create('n2', snap('b'))
    await service.setPassword(b.record.id, 'correct horse')
    await service.setExpiry(a.record.id, DAY)
    const all = await other.listAll()
    expect(all.map((r) => [r.id, r.noteId, r.expiresAt !== null, r.password !== null])).toEqual([
      [b.record.id, 'n2', false, true],
      [a.record.id, 'n1', true, false],
    ])
  })
})
