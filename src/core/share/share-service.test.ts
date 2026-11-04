import { beforeEach, describe, expect, it } from 'vitest'
import { generateKek } from '@/adapters/crypto/webcrypto-crypto'
import { MemoryShare } from '@/adapters/share/memory-share'
import { ShareError } from '@/adapters/share/types'
import { createShareService, openSharedLink } from './share-service'
import { buildShareSnapshot, type ShareSnapshot } from './snapshot'

const snap = (text: string, at = 1): ShareSnapshot =>
  buildShareSnapshot({ title: '標題', doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] }, sharedAt: at, linkLabel: () => null })

const ORIGIN = 'https://notes.example'
const errKind = async (p: Promise<unknown>) => {
  try {
    await p
  } catch (e) {
    expect(e).toBeInstanceOf(ShareError)
    return (e as ShareError).kind
  }
  throw new Error('expected a ShareError')
}

describe('share service', () => {
  let store: MemoryShare
  let kek: CryptoKey
  let account: { userId: string; vaultId: string; kek: CryptoKey } | null
  let service: ReturnType<typeof createShareService>

  beforeEach(async () => {
    let t = 1000
    store = new MemoryShare(() => t++)
    kek = await generateKek()
    account = { userId: 'u1', vaultId: 'v1', kek }
    service = createShareService({ adapter: store, account: () => account, origin: ORIGIN })
  })

  it('creates a link that anyone can open without an account', async () => {
    const { url, record } = await service.create('n1', snap('秘密內容'))
    expect(url.startsWith(`${ORIGIN}/s/${record.id}#`)).toBe(true)
    expect(record).toMatchObject({ vaultId: 'v1', noteId: 'n1' })
    expect(await openSharedLink(store, new URL(url))).toEqual(snap('秘密內容'))
  })

  it('the server stores neither the content nor a usable key', async () => {
    const { url, record } = await service.create('n1', snap('秘密內容'))
    const row = store.rows.get(record.id)!
    const stored = new TextDecoder('latin1').decode(row.ciphertext) + row.wrappedKey
    expect(stored).not.toContain('秘密')
    expect(stored).not.toContain(new URL(url).hash.slice(1))
    expect(row.userId).toBe('u1')
  })

  it('copying again gives the same link, from another device that only has the KEK', async () => {
    const { url, record } = await service.create('n1', snap('a'))
    const other = createShareService({ adapter: store, account: () => ({ userId: 'u1', vaultId: 'v1', kek }), origin: ORIGIN })
    const [listed] = await other.listForNote('n1')
    expect(listed.id).toBe(record.id)
    expect(await other.linkFor(listed)).toBe(url)
  })

  it('updating replaces the content behind the same link', async () => {
    const { url, record } = await service.create('n1', snap('舊', 1))
    await service.update(record, snap('新', 2))
    expect(await openSharedLink(store, new URL(url))).toEqual(snap('新', 2))
    const [listed] = await service.listForNote('n1')
    expect(listed.updatedAt).toBeGreaterThan(listed.createdAt)
  })

  it('stopping a link makes it fail right away; updating it then reports not-found', async () => {
    const { url, record } = await service.create('n1', snap('a'))
    await service.stop(record.id)
    expect(await errKind(openSharedLink(store, new URL(url)))).toBe('not-found')
    expect(await errKind(service.update(record, snap('b')))).toBe('not-found')
    expect(await service.listForNote('n1')).toEqual([])
  })

  it('permanently deleting a note stops all of its links, not other notes’ links', async () => {
    const a = await service.create('n1', snap('a'))
    const b = await service.create('n1', snap('b'))
    const c = await service.create('n2', snap('c'))
    await service.removeForNotes(['n1'])
    expect(await errKind(openSharedLink(store, new URL(a.url)))).toBe('not-found')
    expect(await errKind(openSharedLink(store, new URL(b.url)))).toBe('not-found')
    expect(await openSharedLink(store, new URL(c.url))).toEqual(snap('c'))
  })

  it('lists one note’s links, newest first', async () => {
    const a = await service.create('n1', snap('a'))
    await service.create('n2', snap('x'))
    const b = await service.create('n1', snap('b'))
    expect((await service.listForNote('n1')).map((r) => r.id)).toEqual([b.record.id, a.record.id])
  })

  it('needs to be signed in to share', async () => {
    account = null
    expect(await errKind(service.create('n1', snap('a')))).toBe('signed-out')
    expect(await errKind(service.listForNote('n1'))).toBe('signed-out')
  })

  it('a link from another vault (or with a tampered key) does not open', async () => {
    const { url, record } = await service.create('n1', snap('a'))
    const u = new URL(url)
    const key = u.hash.slice(1)
    u.hash = (key[0] === 'A' ? 'B' : 'A') + key.slice(1)
    expect(await errKind(openSharedLink(store, u))).toBe('invalid')
    // the ciphertext of one link served for another link id does not open either
    const other = await service.create('n1', snap('b'))
    store.rows.get(other.record.id)!.ciphertext = store.rows.get(record.id)!.ciphertext
    expect(await errKind(openSharedLink(store, new URL(other.url)))).toBe('invalid')
  })

  it('a link that is not a share link is reported as invalid', async () => {
    expect(await errKind(openSharedLink(store, new URL(`${ORIGIN}/s/abc`)))).toBe('invalid')
    expect(await errKind(openSharedLink(store, new URL(`${ORIGIN}/s/abc#short`)))).toBe('invalid')
  })
})
