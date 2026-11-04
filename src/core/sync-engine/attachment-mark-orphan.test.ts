import { afterEach, beforeEach, expect, it } from 'vitest'
import * as Y from 'yjs'
import { generateKek } from '@/adapters/crypto/webcrypto-crypto'
import { MemoryAttachmentSync } from '@/adapters/sync/memory-attachment-sync'
import { MemorySync } from '@/adapters/sync/memory-sync'
import { MemoryStorage } from '@/adapters/storage/memory-storage'
import { NoteDocCache } from '@/core/note-doc/cache'
import { Vault } from '@/core/vault/vault'
import { manifestDocId, pullManifest } from './manifest-sync'
import { encodeManifest } from './manifest-codec'
import { encryptDocChunk } from './doc-crypto'
import { createSyncManager, type SyncManager } from './sync-manager'

// While the cloud manifest has lost an attachment's removal mark, a device that never saw the mark uploads the
// attachment again. When a device that knows the mark puts it back, it deletes that cloud copy again (4b review,
// finding 3). Each "device" has its own storage, vault, note docs and manager; they share only the fake cloud.

/** Two devices must not talk through BroadcastChannel (same vault id in one process) — only through the cloud. */
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
  errors: unknown[]
}

let sync: MemorySync
let attachmentSync: MemoryAttachmentSync
let kek: CryptoKey
const devices: Device[] = []

type Marks = Array<{ id: string; at: number }>
/** A `purgedAttachments` store kept in memory (what db.meta keeps on a real device). */
function markStore(known: Marks = []) {
  const items = known.map((m) => ({ ...m, done: true }))
  return {
    items,
    read: async () => items.filter((x) => !x.done).map(({ id, at }) => ({ id, at })),
    known: async () => items.map(({ id, at }) => ({ id, at })),
    markDone: async (ids: string[]) => void items.forEach((x) => ids.includes(x.id) && (x.done = true)),
    remember: async (marks: Marks) => void items.push(...marks.filter((m) => !items.some((x) => x.id === m.id)).map((m) => ({ ...m, done: true }))),
  }
}

async function device(name: string, extra: Partial<Parameters<typeof createSyncManager>[0]> = {}): Promise<Device> {
  const storage = new MemoryStorage()
  const vault = await Vault.open(storage, 'v1', { channelFactory: isolated })
  const notes = new NoteDocCache(storage, { channelFactory: isolated })
  const errors: unknown[] = []
  const manager = createSyncManager({
    sync, attachmentSync, storage, noteDocs: notes, vault, vaultId: 'v1', kek, deviceId: name,
    onError: (e) => errors.push(e),
    ...extra,
  })
  const d = { storage, vault, notes, manager, errors }
  devices.push(d)
  return d
}

function mediaEl(attachmentId: string) {
  const e = new Y.XmlElement('media')
  e.setAttribute('id', 'm1')
  e.setAttribute('attachmentId', attachmentId)
  return e
}
const text = (doc: Y.Doc) => doc.getXmlFragment('content').toString()

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

it('a copy re-uploaded while the mark was lost is deleted again once the mark is back', async () => {
  const aStore = markStore()
  const a = await device('A', { purgedAttachments: aStore })
  const n = a.vault.createNote({ title: 'Pics' })
  const docA = await a.notes.acquire(n.id)
  docA.getXmlFragment('content').insert(0, [mediaEl('att1')])
  a.notes.release(n.id)
  await a.storage.putBlob('att1', new Blob(['png-bytes'], { type: 'image/png' }))
  a.vault.addAttachment({ id: 'att1', filename: 'shot.png', mimeType: 'image/png', size: 9 })
  a.vault.setNoteSynced(n.id, true)
  await a.manager.start()
  await until(async () => ((await pullManifest(sync, kek, 'v1'))?.attachments ?? []).length === 1)

  // C gets everything, then is closed (laptop asleep) while A deletes the attachment
  const cStore = markStore()
  const c = await device('C', { purgedAttachments: cStore })
  await c.manager.start()
  await until(() => !!c.vault.getAttachment('att1'))
  await until(async () => text(await c.notes.acquire(n.id)).includes('att1'))
  c.notes.release(n.id)
  await until(async () => !a.manager.hasPending() && !c.manager.hasPending())
  await c.manager.close()

  const stale = (await pullManifest(sync, kek, 'v1'))!
  a.vault.purgeAttachment('att1')
  await a.storage.deleteBlob('att1')
  await until(async () => (await attachmentSync.downloadAttachment('v1', 'att1')) === null)
  await until(async () => !a.manager.hasPending())
  aStore.items.push({ id: 'att1', at: Date.now(), done: true }) // what recordPurgedAttachments + markDone leave in db.meta
  await a.manager.close() // A goes offline / is closed
  // a third device's push computed before A's lands after it: the mark is gone from the cloud
  await sync.pushSnapshot('v1', manifestDocId('v1'), await encryptDocChunk(kek, 'v1', manifestDocId('v1'), encodeManifest(stale)), 0)
  await wait(50)

  // C wakes up before A pushes again
  c.manager = createSyncManager({ sync, attachmentSync, storage: c.storage, noteDocs: c.notes, vault: c.vault, vaultId: 'v1', kek, deviceId: 'C', purgedAttachments: cStore })
  await c.manager.start()
  await wait(300)
  await until(async () => !c.manager.hasPending())
  const reuploaded = (await attachmentSync.downloadAttachment('v1', 'att1')) !== null

  // A comes back: the mark is put back
  a.manager = createSyncManager({ sync, attachmentSync, storage: a.storage, noteDocs: a.notes, vault: a.vault, vaultId: 'v1', kek, deviceId: 'A', purgedAttachments: aStore })
  await a.manager.start()
  await wait(300)
  await until(async () => !a.manager.hasPending())
  await wait(300)
  const marks = ((await pullManifest(sync, kek, 'v1'))!.removedAttachments ?? []).map((r) => r.id)
  const cloudCopyLeft = (await attachmentSync.downloadAttachment('v1', 'att1')) !== null

  expect({ reuploaded, marks, cloudCopyLeft }).toEqual({ reuploaded: true, marks: ['att1'], cloudCopyLeft: false })
})
