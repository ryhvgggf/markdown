import { afterEach, beforeEach, expect, it } from 'vitest'
import * as Y from 'yjs'
import { generateKek } from '@/adapters/crypto/webcrypto-crypto'
import { MemoryAttachmentSync } from '@/adapters/sync/memory-attachment-sync'
import { MemorySync } from '@/adapters/sync/memory-sync'
import { MemoryStorage } from '@/adapters/storage/memory-storage'
import { NoteDocCache } from '@/core/note-doc/cache'
import { Vault } from '@/core/vault/vault'
import { pullManifest } from './manifest-sync'
import { createSyncManager, type SyncManager } from './sync-manager'

// The daily cleanup removes an attachment no note uses from this device only, while the cloud manifest still lists
// it. Sync must not fetch it again on every pull (the cleanup would delete it again the next day), but must fetch it
// once a synced note here uses it (4b review, finding 2). Each "device" has its own storage, vault, note docs and
// manager; they share only the fake cloud.

const isolated = () =>
  ({ postMessage() {}, addEventListener() {}, removeEventListener() {}, close() {} }) as unknown as BroadcastChannel
const wait = (ms = 60) => new Promise((r) => setTimeout(r, ms))
async function until(cond: () => boolean | Promise<boolean>, ms = 2000) {
  const end = Date.now() + ms
  while (!(await cond())) {
    if (Date.now() > end) throw new Error('timed out')
    await wait(20)
  }
}

interface Device {
  storage: MemoryStorage
  vault: Vault
  notes: NoteDocCache
  manager: SyncManager
}
let sync: MemorySync
let attachmentSync: MemoryAttachmentSync
let kek: CryptoKey
const devices: Device[] = []

/** What db.meta keeps on a real device: ids the cleanup removed from this device only. */
function dropStore(initial: string[]) {
  const ids = [...initial]
  return {
    ids,
    read: async () => [...ids],
    remove: async (gone: string[]) => void gone.forEach((g) => ids.includes(g) && ids.splice(ids.indexOf(g), 1)),
  }
}

async function device(name: string, extra: Partial<Parameters<typeof createSyncManager>[0]> = {}): Promise<Device> {
  const storage = new MemoryStorage()
  const vault = await Vault.open(storage, 'v1', { channelFactory: isolated })
  const notes = new NoteDocCache(storage, { channelFactory: isolated })
  const manager = createSyncManager({ sync, attachmentSync, storage, noteDocs: notes, vault, vaultId: 'v1', kek, deviceId: name, ...extra })
  const d = { storage, vault, notes, manager }
  devices.push(d)
  return d
}
const media = (attachmentId: string) => {
  const e = new Y.XmlElement('media')
  e.setAttribute('id', 'm1')
  e.setAttribute('attachmentId', attachmentId)
  return e
}

beforeEach(async () => {
  sync = new MemorySync()
  attachmentSync = new MemoryAttachmentSync()
  kek = await generateKek()
})
afterEach(async () => {
  for (const d of devices.splice(0)) {
    await d.manager.close()
    d.vault.close()
  }
})

/** A has a synced note showing att1 (uploaded); the note is `keepImage` or not. */
async function deviceAWithImage(keepImage: boolean) {
  const a = await device('A')
  const n = a.vault.createNote({ title: 'Pics' })
  const doc = await a.notes.acquire(n.id)
  doc.getXmlFragment('content').insert(0, [media('att1')])
  await a.storage.putBlob('att1', new Blob(['png-bytes'], { type: 'image/png' }))
  a.vault.addAttachment({ id: 'att1', filename: 'shot.png', mimeType: 'image/png', size: 9 })
  a.vault.setNoteSynced(n.id, true)
  await a.manager.start()
  await until(async () => ((await pullManifest(sync, kek, 'v1'))?.attachments ?? []).length === 1)
  if (!keepImage) doc.getXmlFragment('content').delete(0, 1) // taken out of the note; the cloud still lists it
  a.notes.release(n.id)
  await until(async () => !a.manager.hasPending())
  return a
}

it('an attachment the cleanup removed here is not downloaded again on later manifest pulls', async () => {
  const a = await deviceAWithImage(false)
  const b = await device('B', { locallyDropped: dropStore(['att1']) })
  await b.manager.start()
  a.vault.setNoteSynced(a.vault.createNote({ title: 'later' }).id, true) // makes B pull the manifest again
  await until(() => b.vault.listNotes().length === 2)
  await wait(300)
  expect(b.vault.getAttachment('att1')).toBeUndefined()
})

it('once a synced note here uses it, it is forgotten as dropped and downloaded', async () => {
  await deviceAWithImage(true)
  const drops = dropStore(['att1'])
  const b = await device('B', { locallyDropped: drops })
  await b.manager.start()
  await until(() => !!b.vault.getAttachment('att1'))
  expect(drops.ids).toEqual([])
  expect(await b.storage.getBlob('att1')).toBeDefined()
})

it('without the dropped list a device downloads everything the manifest lists (as before)', async () => {
  await deviceAWithImage(false)
  const b = await device('B')
  await b.manager.start()
  await until(() => !!b.vault.getAttachment('att1'))
})
