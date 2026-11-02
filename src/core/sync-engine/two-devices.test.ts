import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { generateKek } from '@/adapters/crypto/webcrypto-crypto'
import { MemoryAttachmentSync } from '@/adapters/sync/memory-attachment-sync'
import { MemorySync } from '@/adapters/sync/memory-sync'
import { MemoryStorage } from '@/adapters/storage/memory-storage'
import { NoteDocCache } from '@/core/note-doc/cache'
import { Vault } from '@/core/vault/vault'
import { pullManifest } from './manifest-sync'
import { createSyncManager, type SyncManager } from './sync-manager'

// 3f-3: a second device signing in pulls what the first one synced, and structure changes flow both ways.
// Each "device" has its own storage, vault, note docs and manager; they share only the fake cloud.

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

async function device(name: string): Promise<Device> {
  const storage = new MemoryStorage()
  const vault = await Vault.open(storage, 'v1', { channelFactory: isolated })
  const notes = new NoteDocCache(storage, { channelFactory: isolated })
  const errors: unknown[] = []
  const manager = createSyncManager({
    sync, attachmentSync, storage, noteDocs: notes, vault, vaultId: 'v1', kek, deviceId: name,
    onError: (e) => errors.push(e),
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

describe('second device', () => {
  it('signing in pulls synced notes with their folders, content and attachments — and nothing unsynced', async () => {
    const a = await device('A')
    const folder = a.vault.createFolder({ name: 'Work', parentId: null })
    const synced = a.vault.createNote({ title: 'Plan', folderId: folder.id })
    a.vault.createNote({ title: 'Private' })
    const doc = await a.notes.acquire(synced.id)
    const para = new Y.XmlElement('paragraph')
    para.insert(0, [new Y.XmlText('hello from A')])
    doc.getXmlFragment('content').insert(0, [para, mediaEl('att1')])
    a.notes.release(synced.id)
    await a.storage.putBlob('att1', new Blob(['png-bytes'], { type: 'image/png' }))
    a.vault.addAttachment({ id: 'att1', filename: 'shot.png', mimeType: 'image/png', size: 9 })
    a.vault.setNoteSynced(synced.id, true)
    await a.manager.start()
    await until(async () => ((await pullManifest(sync, kek, 'v1'))?.attachments ?? []).length === 1)

    const b = await device('B')
    await b.manager.start()
    await until(() => !!b.vault.getAttachment('att1'))

    expect(b.vault.listNotes().map((n) => n.title)).toEqual(['Plan'])
    const nb = b.vault.getNote(synced.id)!
    expect(nb.synced).toBe(true)
    expect(nb.folderId).toBe(folder.id)
    expect(b.vault.listFolders().map((f) => f.name)).toEqual(['Work'])
    expect(text(await b.notes.acquire(synced.id))).toContain('hello from A')
    b.notes.release(synced.id)
    expect(b.vault.getAttachment('att1')).toMatchObject({ filename: 'shot.png', mimeType: 'image/png' })
    expect(await (await b.storage.getBlob('att1'))!.text()).toBe('png-bytes')
    expect(b.errors).toEqual([])
  })

  it('an edit on the new device reaches the first one', async () => {
    const a = await device('A')
    const n = a.vault.createNote({ title: 'Shared' })
    a.vault.setNoteSynced(n.id, true)
    await a.manager.start()
    const b = await device('B')
    await b.manager.start()
    await until(() => !!b.vault.getNote(n.id))
    await until(async () => !b.manager.hasPending())

    const docB = await b.notes.acquire(n.id)
    const p = new Y.XmlElement('paragraph')
    p.insert(0, [new Y.XmlText('typed on B')])
    docB.getXmlFragment('content').insert(0, [p])
    const docA = await a.notes.acquire(n.id)
    await until(() => text(docA).includes('typed on B'))
    a.notes.release(n.id)
    b.notes.release(n.id)
  })

  it('does not re-upload attachments the cloud already has for a note', async () => {
    const a = await device('A')
    const n = a.vault.createNote({ title: 'Pic' })
    const doc = await a.notes.acquire(n.id)
    doc.getXmlFragment('content').insert(0, [mediaEl('att1')])
    a.notes.release(n.id)
    await a.storage.putBlob('att1', new Blob(['x']))
    a.vault.addAttachment({ id: 'att1', filename: 'x.bin', mimeType: 'application/octet-stream', size: 1 })
    a.vault.setNoteSynced(n.id, true)
    await a.manager.start()
    await until(async () => (await attachmentSync.listAttachments('v1', n.id)).length === 1)
    await a.manager.close()
    devices.splice(devices.indexOf(a), 1)

    let uploads = 0
    const original = attachmentSync.uploadAttachment.bind(attachmentSync)
    attachmentSync.uploadAttachment = async (...args) => {
      uploads++
      return original(...args)
    }
    const again = createSyncManager({ sync, attachmentSync, storage: a.storage, noteDocs: a.notes, vault: a.vault, vaultId: 'v1', kek, deviceId: 'A' })
    await again.start()
    await wait()
    expect(uploads).toBe(0)
    await again.close()
    a.vault.close()
  })
})

describe('structure changes both ways', () => {
  async function pair() {
    const a = await device('A')
    const f1 = a.vault.createFolder({ name: 'One', parentId: null })
    const f2 = a.vault.createFolder({ name: 'Two', parentId: null })
    const n = a.vault.createNote({ title: 'Note', folderId: f1.id })
    a.vault.setNoteSynced(n.id, true)
    // f2 holds a second synced note so B knows it too.
    const other = a.vault.createNote({ title: 'Other', folderId: f2.id })
    a.vault.setNoteSynced(other.id, true)
    await a.manager.start()
    const b = await device('B')
    await b.manager.start()
    await until(() => b.vault.listNotes().length === 2)
    await until(() => !a.manager.hasPending() && !b.manager.hasPending())
    return { a, b, n, f1, f2 }
  }

  it('a rename on one device shows up on the other', async () => {
    const { a, b, n } = await pair()
    a.vault.renameNote(n.id, 'Renamed on A')
    await until(() => b.vault.getNote(n.id)?.title === 'Renamed on A')
    b.vault.renameNote(n.id, 'Then on B')
    await until(() => a.vault.getNote(n.id)?.title === 'Then on B')
  })

  it('a move into another folder shows up on the other device', async () => {
    const { a, b, n, f2 } = await pair()
    b.vault.moveNote(n.id, { folderId: f2.id, index: 0 })
    await until(() => a.vault.getNote(n.id)?.folderId === f2.id)
  })

  it('folder renames sync too', async () => {
    const { a, b, f1 } = await pair()
    a.vault.renameFolder(f1.id, 'Uno')
    await until(() => b.vault.listFolders().find((f) => f.id === f1.id)?.name === 'Uno')
  })

  it('the later of two renames wins on both devices', async () => {
    const { a, b, n } = await pair()
    a.vault.renameNote(n.id, 'Earlier')
    await wait(5)
    b.vault.renameNote(n.id, 'Later')
    await until(() => a.vault.getNote(n.id)?.title === 'Later' && b.vault.getNote(n.id)?.title === 'Later')
    await wait(200)
    expect(a.vault.getNote(n.id)?.title).toBe('Later')
    expect(b.vault.getNote(n.id)?.title).toBe('Later')
  })

  it('a pulled title that collides locally gets a suffix here but stays unchanged in the cloud', async () => {
    const a = await device('A')
    const n = a.vault.createNote({ title: 'Guide' })
    a.vault.setNoteSynced(n.id, true)
    await a.manager.start()
    const b = await device('B')
    b.vault.createNote({ title: 'Guide' })
    await b.manager.start()
    await until(() => !!b.vault.getNote(n.id))
    expect(b.vault.getNote(n.id)?.title).toBe('Guide (2)')
    await until(() => !b.manager.hasPending())
    await wait(100)
    expect((await pullManifest(sync, kek, 'v1'))?.notes.find((x) => x.id === n.id)?.title).toBe('Guide')
    expect(a.vault.getNote(n.id)?.title).toBe('Guide')
  })
})
