import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { generateKek } from '@/adapters/crypto/webcrypto-crypto'
import { MemoryAttachmentSync } from '@/adapters/sync/memory-attachment-sync'
import { MemorySync } from '@/adapters/sync/memory-sync'
import { MemoryStorage } from '@/adapters/storage/memory-storage'
import { NoteDocCache } from '@/core/note-doc/cache'
import { Vault } from '@/core/vault/vault'
import { pullManifest } from './manifest-sync'
import { encodeManifest } from './manifest-codec'
import { encryptDocChunk } from './doc-crypto'
import { manifestDocId } from './manifest-sync'
import { createSyncManager, type SyncManager } from './sync-manager'

// Attachment removal marks are permanent: a device never forgets one, so a mark the cloud manifest loses (a
// read-modify-write race with a device pushing an older manifest, or an older app version) is put back (4b review,
// finding 2). Each "device" has its own storage, vault, note docs and manager; they share only the fake cloud.

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


describe('attachment removal mark lost in a manifest race', () => {
  it.each([true, false])('the mark is put back, and the attachment is not uploaded again (race=%s)', async (race) => {
    const a = await device('A')
    const n = a.vault.createNote({ title: 'Pics' })
    const docA = await a.notes.acquire(n.id)
    docA.getXmlFragment('content').insert(0, [mediaEl('att1')])
    a.notes.release(n.id)
    await a.storage.putBlob('att1', new Blob(['png-bytes'], { type: 'image/png' }))
    a.vault.addAttachment({ id: 'att1', filename: 'shot.png', mimeType: 'image/png', size: 9 })
    a.vault.setNoteSynced(n.id, true)
    await a.manager.start()
    await until(async () => ((await pullManifest(sync, kek, 'v1'))?.attachments ?? []).length === 1)

    const b = await device('B')
    await b.manager.start()
    await until(() => !!b.vault.getAttachment('att1'))
    await until(async () => text(await b.notes.acquire(n.id)).includes('att1'))
    b.notes.release(n.id)
    await until(async () => !a.manager.hasPending() && !b.manager.hasPending())

    // what a third device C read just before A's delete (it pushes this back a moment later)
    const stale = (await pullManifest(sync, kek, 'v1'))!

    // A: trash + delete forever (a note there still shows it; "deleted even if a note still shows them")
    a.vault.purgeAttachment('att1')
    await a.storage.deleteBlob('att1')
    await until(async () => (await attachmentSync.downloadAttachment('v1', 'att1')) === null)
    await until(async () => !a.manager.hasPending())

    // C's push, computed from the manifest it read before A's push, lands after it
    if (race) await sync.pushSnapshot('v1', manifestDocId('v1'), await encryptDocChunk(kek, 'v1', manifestDocId('v1'), encodeManifest(stale)), 0)
    await wait(300)
    // something else makes A push again
    a.vault.createNote({ title: 'later' })
    await wait(300)
    await until(async () => !a.manager.hasPending())
    const marks = ((await pullManifest(sync, kek, 'v1'))!.removedAttachments ?? []).map((r) => r.id)

    // B restarts (its note still uses att1, so it kept its copy)
    await b.manager.close()
    b.manager = createSyncManager({ sync, attachmentSync, storage: b.storage, noteDocs: b.notes, vault: b.vault, vaultId: 'v1', kek, deviceId: 'B' })
    await b.manager.start()
    await wait(300)
    await until(async () => !b.manager.hasPending())
    const resurrected = (await attachmentSync.downloadAttachment('v1', 'att1')) !== null

    expect({ marks, resurrected }).toEqual({ marks: ['att1'], resurrected: false })
  })

  it('a device that saved the mark puts it back after the cloud lost it, and does not upload the attachment', async () => {
    const lostMark = { id: 'att1', at: 5 }
    // the cloud lists the attachment again, without the mark (an old app version pushed it)
    const a = await device('A')
    const n = a.vault.createNote({ title: 'Pics' })
    const docA = await a.notes.acquire(n.id)
    docA.getXmlFragment('content').insert(0, [mediaEl('att1')])
    a.notes.release(n.id)
    await a.storage.putBlob('att1', new Blob(['png-bytes'], { type: 'image/png' }))
    a.vault.addAttachment({ id: 'att1', filename: 'shot.png', mimeType: 'image/png', size: 9 })
    a.vault.setNoteSynced(n.id, true)
    await a.manager.start()
    await until(async () => ((await pullManifest(sync, kek, 'v1'))?.attachments ?? []).length === 1)
    await a.manager.close()
    await attachmentSync.deleteAttachment('v1', 'att1')

    // B saw the mark before (db.meta), and still has the attachment because a note there uses it
    const store = markStore([lostMark])
    const b = await device('B', { purgedAttachments: store })
    await b.storage.putBlob('att1', new Blob(['png-bytes'], { type: 'image/png' }))
    b.vault.addAttachment({ id: 'att1', filename: 'shot.png', mimeType: 'image/png', size: 9 })
    await b.manager.start()
    await until(async () => ((await pullManifest(sync, kek, 'v1'))!.removedAttachments ?? []).some((r) => r.id === 'att1'))
    await until(async () => !b.manager.hasPending())
    const cloud = (await pullManifest(sync, kek, 'v1'))!
    expect((cloud.attachments ?? []).map((x) => x.id)).not.toContain('att1')
    expect(await attachmentSync.downloadAttachment('v1', 'att1')).toBeNull()
  })

  it('a mark learned from the cloud is saved, and "deleted elsewhere" is asked once per session', async () => {
    const a = await device('A')
    a.vault.addAttachment({ id: 'att9', filename: 'x.png', mimeType: 'image/png', size: 1 })
    await a.manager.start()
    a.vault.purgeAttachment('att9')
    await until(async () => ((await pullManifest(sync, kek, 'v1'))?.removedAttachments ?? []).some((r) => r.id === 'att9'))

    const store = markStore()
    const asked: string[][] = []
    const b = await device('B', { purgedAttachments: store, onAttachmentsRemovedElsewhere: (ids) => void asked.push(ids) })
    b.vault.addAttachment({ id: 'att9', filename: 'x.png', mimeType: 'image/png', size: 1 }) // kept: "a note uses it"
    await b.manager.start()
    await until(() => store.items.some((x) => x.id === 'att9'))
    // more structure changes from A make B pull the manifest again
    a.vault.setNoteSynced(a.vault.createNote({ title: 'one' }).id, true)
    await until(() => b.vault.listNotes().length === 1)
    a.vault.setNoteSynced(a.vault.createNote({ title: 'two' }).id, true)
    await until(() => b.vault.listNotes().length === 2)
    expect(asked).toEqual([['att9']])
  })
})
