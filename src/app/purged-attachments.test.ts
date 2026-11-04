// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MemoryStorage } from '@/adapters/storage/memory-storage'
import { createDb, type NotesDb } from '@/adapters/storage/db'
import { Vault } from '@/core/vault/vault'
import { SYNC_VAULT_KEY } from './account-service'
import { purgedAttachmentStore, recordPurgedAttachments } from './purged-attachments'

const fakeChannel = () =>
  ({ postMessage() {}, close() {}, onmessage: null, addEventListener() {}, removeEventListener() {} }) as unknown as BroadcastChannel
const until = async (cond: () => Promise<boolean>) => {
  for (let i = 0; i < 100 && !(await cond()); i++) await new Promise((r) => setTimeout(r, 10))
}

let db: NotesDb
let vault: Vault
beforeEach(async () => {
  db = createDb('purged-' + Math.random().toString(36).slice(2))
  vault = await Vault.open(new MemoryStorage(), 'v1', { channelFactory: fakeChannel })
})
afterEach(() => {
  vault.close()
  db.close()
})

describe('permanently deleted attachments waiting for the cloud', () => {
  it('records a delete for the signed-in vault (also while sync is not running) until sync clears it', async () => {
    await db.meta.put({ key: SYNC_VAULT_KEY, value: 'vA' })
    recordPurgedAttachments(db, vault)
    const a = vault.addAttachment({ filename: 'a.png', mimeType: 'image/png', size: 1 })
    vault.purgeAttachment(a.id)
    const store = purgedAttachmentStore(db, 'vA')
    await until(async () => (await store.read()).length === 1)
    expect((await store.read()).map((x) => x.id)).toEqual([a.id])
    expect(await purgedAttachmentStore(db, 'vB').read()).toEqual([]) // another account's list stays its own
    await store.markDone([a.id])
    expect(await store.read()).toEqual([])
    expect((await store.known()).map((x) => x.id)).toEqual([a.id]) // the mark itself is kept for good
  })

  it('remembers marks learned from the cloud, once, without making them pending', async () => {
    const store = purgedAttachmentStore(db, 'vA')
    await store.remember([{ id: 'x', at: 1 }, { id: 'y', at: 2 }])
    await store.remember([{ id: 'x', at: 1 }])
    expect((await store.known()).map((m) => m.id)).toEqual(['x', 'y'])
    expect(await store.read()).toEqual([])
    expect(await purgedAttachmentStore(db, 'vB').known()).toEqual([])
  })

  it('a device that never signed in records nothing; a rolled-back insert is not a delete', async () => {
    recordPurgedAttachments(db, vault)
    const a = vault.addAttachment({ filename: 'a.png', mimeType: 'image/png', size: 1 })
    vault.purgeAttachment(a.id)
    await db.meta.put({ key: SYNC_VAULT_KEY, value: 'vA' })
    const b = vault.addAttachment({ filename: 'b.png', mimeType: 'image/png', size: 1 })
    vault.removeAttachment(b.id)
    await new Promise((r) => setTimeout(r, 50))
    expect(await purgedAttachmentStore(db, 'vA').read()).toEqual([])
  })
})
