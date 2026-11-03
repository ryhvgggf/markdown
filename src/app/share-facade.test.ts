// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MemoryShare } from '@/adapters/share/memory-share'
import { createDb, type NotesDb } from '@/adapters/storage/db'
import { generateShareKey, encryptShareSnapshot, wrapShareKey } from '@/core/sync-engine/doc-crypto'
import { toB64 } from '@/adapters/crypto/webcrypto-crypto'
import { ShareError } from '@/adapters/share/types'
import { ACCOUNT_KEY } from './account-service'
import { createShareFacade, PENDING_SHARE_REMOVALS_KEY } from './share-facade'

let db: NotesDb
let adapter: MemoryShare
let kek: CryptoKey
beforeEach(async () => {
  db = createDb('share-facade-' + Math.random().toString(36).slice(2))
  adapter = new MemoryShare()
  kek = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
})
afterEach(() => db.close())

const signIn = () => db.meta.put({ key: ACCOUNT_KEY, value: { userId: 'u1', email: 'a@b.c', vaultId: 'v1', kek } })
const facade = () => createShareFacade({ db, adapter: async () => adapter, origin: 'https://x.test' })
const pending = async () => (await db.meta.get(PENDING_SHARE_REMOVALS_KEY))?.value

async function addLink(noteId: string, id: string) {
  const key = await generateShareKey()
  await adapter.create({
    id,
    vaultId: 'v1',
    noteId,
    userId: 'u1',
    wrappedKey: toB64(await wrapShareKey(kek, 'v1', id, key)),
    ciphertext: await encryptShareSnapshot(key, id, new Uint8Array([1])),
  })
}

describe('share facade', () => {
  it('run needs an account', async () => {
    await expect(facade().run(async () => 1)).rejects.toMatchObject({ kind: 'signed-out' })
    await signIn()
    expect(await facade().run(async () => 1)).toBe(1)
  })

  it('stops the links of a permanently deleted note when signed in', async () => {
    await signIn()
    await addLink('n1', 'a'.repeat(22))
    await addLink('n2', 'b'.repeat(22))
    await facade().noteRemoved(['n1'])
    expect([...adapter.rows.values()].map((r) => r.noteId)).toEqual(['n2'])
    expect(await pending()).toBeUndefined()
  })

  it('keeps the removal queued while signed out and finishes it after sign-in', async () => {
    await addLink('n1', 'a'.repeat(22))
    const f = facade()
    await f.noteRemoved(['n1'])
    expect(adapter.rows.size).toBe(1)
    expect(await pending()).toEqual(['n1'])
    await signIn()
    await f.flushPending()
    expect(adapter.rows.size).toBe(0)
    expect(await pending()).toBeUndefined()
  })

  it('keeps a removal that failed and retries it', async () => {
    await signIn()
    await addLink('n1', 'a'.repeat(22))
    const real = adapter.removeForNote.bind(adapter)
    adapter.removeForNote = async () => {
      throw new ShareError('unknown', 'offline')
    }
    const f = facade()
    await f.noteRemoved(['n1'])
    expect(adapter.rows.size).toBe(1)
    expect(await pending()).toEqual(['n1'])
    adapter.removeForNote = real
    await f.flushPending()
    expect(adapter.rows.size).toBe(0)
    expect(await pending()).toBeUndefined()
  })

  it('does nothing when sharing is not configured', async () => {
    const f = createShareFacade({ db, adapter: null, origin: 'https://x.test' })
    await f.noteRemoved(['n1'])
    expect(await pending()).toBeUndefined()
    await expect(f.run(async () => 1)).rejects.toMatchObject({ kind: 'signed-out' })
  })
})
