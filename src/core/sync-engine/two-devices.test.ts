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

describe('removal elsewhere (3f-4)', () => {
  async function pair() {
    const a = await device('A')
    const n = a.vault.createNote({ title: 'Shared' })
    a.vault.setNoteSynced(n.id, true)
    const doc = await a.notes.acquire(n.id)
    const p = new Y.XmlElement('paragraph')
    p.insert(0, [new Y.XmlText('kept text')])
    doc.getXmlFragment('content').insert(0, [p])
    a.notes.release(n.id)
    await a.manager.start()
    const b = await device('B')
    await b.manager.start()
    await until(() => !!b.vault.getNote(n.id))
    await until(() => !a.manager.hasPending() && !b.manager.hasPending())
    return { a, b, n }
  }
  const cloudDocs = () => sync.listDocs('v1')

  it('a permanent delete on one device unsyncs the note on the other, keeps its content, and it does not come back', async () => {
    const { a, b, n } = await pair()
    a.vault.purgeNote(n.id)
    await until(() => b.vault.getNote(n.id)?.synced === false)
    expect(b.vault.getNote(n.id)).toMatchObject({ title: 'Shared', deletedAt: null })
    const docB = await b.notes.acquire(n.id)
    expect(text(docB)).toContain('kept text')
    // editing it on B must not put it back in the cloud
    const p = new Y.XmlElement('paragraph')
    p.insert(0, [new Y.XmlText('more')])
    docB.getXmlFragment('content').insert(0, [p])
    b.notes.release(n.id)
    await wait(300)
    expect(await cloudDocs()).not.toContain(n.id)
    expect(a.vault.getNote(n.id)).toBeUndefined()
    const manifest = await pullManifest(sync, kek, 'v1')
    expect(manifest?.notes.map((x) => x.id)).not.toContain(n.id)
    expect(manifest?.removed?.map((x) => x.id)).toContain(n.id)
  })

  it('turning sync off on one device does the same on the other (A keeps its own copy)', async () => {
    const { a, b, n } = await pair()
    a.vault.setNoteSynced(n.id, false)
    await until(() => b.vault.getNote(n.id)?.synced === false)
    await wait(300)
    expect(await cloudDocs()).not.toContain(n.id)
    expect(a.vault.getNote(n.id)?.synced).toBe(false)
    expect(b.errors).toEqual([])
  })

  it('a device that was closed during the removal unsyncs the note when it comes back, and does not upload it again', async () => {
    const { a, b, n } = await pair()
    await b.manager.close()
    a.vault.purgeNote(n.id)
    await until(async () => !(await cloudDocs()).includes(n.id))
    await until(async () => ((await pullManifest(sync, kek, 'v1'))?.removed ?? []).length === 1)

    const again = createSyncManager({ sync, attachmentSync, storage: b.storage, noteDocs: b.notes, vault: b.vault, vaultId: 'v1', kek, deviceId: 'B' })
    await again.start()
    await wait(300)
    expect(b.vault.getNote(n.id)?.synced).toBe(false)
    expect(await cloudDocs()).not.toContain(n.id)
    await again.close()
  })

  it('syncing the note again from the other device (a mistaken delete) brings it back everywhere', async () => {
    const { a, b, n } = await pair()
    a.vault.purgeNote(n.id)
    await until(() => b.vault.getNote(n.id)?.synced === false)
    await until(async () => ((await pullManifest(sync, kek, 'v1'))?.removed ?? []).length === 1)

    b.vault.setNoteSynced(n.id, true)
    await until(() => !!a.vault.getNote(n.id))
    expect(a.vault.getNote(n.id)?.synced).toBe(true)
    await until(async () => (await cloudDocs()).includes(n.id))
    const docA = await a.notes.acquire(n.id)
    await until(() => text(docA).includes('kept text'))
    a.notes.release(n.id)
    await until(async () => ((await pullManifest(sync, kek, 'v1'))?.removed ?? []).length === 0)
    expect(b.vault.getNote(n.id)?.synced).toBe(true) // the stale mark did not unsync it again
  })

  it('a note that was never removed is left alone when the manifest has no marks', async () => {
    const { a, b, n } = await pair()
    await wait(200)
    expect(b.vault.getNote(n.id)?.synced).toBe(true)
    expect(a.vault.getNote(n.id)?.synced).toBe(true)
  })
})

describe('a new device with many notes (3f-4)', () => {
  it('fetches notes in parallel, the open one first, pulling each note once', async () => {
    const a = await device('A')
    const ids: string[] = []
    for (let i = 0; i < 12; i++) {
      const n = a.vault.createNote({ title: `Note ${i}` })
      a.vault.setNoteSynced(n.id, true)
      const doc = await a.notes.acquire(n.id)
      const p = new Y.XmlElement('paragraph')
      p.insert(0, [new Y.XmlText(`body ${i}`)])
      doc.getXmlFragment('content').insert(0, [p])
      a.notes.release(n.id)
      ids.push(n.id)
    }
    await a.manager.start()
    await until(() => !a.manager.hasPending())

    // B sees the same cloud, but every pull takes a while (a real network).
    const pulls: string[] = []
    let running = 0
    let peak = 0
    const slow = Object.create(sync) as MemorySync
    slow.pullDoc = async (v, d) => {
      pulls.push(d)
      running++
      peak = Math.max(peak, running)
      await wait(15)
      running--
      return sync.pullDoc(v, d)
    }
    const storage = new MemoryStorage()
    const vault = await Vault.open(storage, 'v1', { channelFactory: isolated })
    const notes = new NoteDocCache(storage, { channelFactory: isolated })
    const open = ids[7]
    const manager = createSyncManager({ sync: slow, attachmentSync, storage, noteDocs: notes, vault, vaultId: 'v1', kek, deviceId: 'B', priorityNoteId: () => open })
    devices.push({ storage, vault, notes, manager, errors: [] })
    await manager.start()

    expect(peak).toBeGreaterThan(1) // not one after another
    const notePulls = pulls.filter((d) => ids.includes(d))
    expect(notePulls.length).toBe(ids.length) // once per note, not twice
    expect(notePulls[0]).toBe(open) // the one on screen goes first
    for (const [i, id] of ids.entries()) {
      const doc = await notes.acquire(id)
      expect(text(doc)).toContain(`body ${i}`)
      notes.release(id)
    }
  })
})

describe('the same note created separately on two devices (3f-4)', () => {
  /** Content as the import writes it: a fresh Yjs doc per device, so the two histories are unrelated. */
  function body(...lines: string[]): Y.XmlElement[] {
    return lines.map((l, i) => {
      const p = new Y.XmlElement('paragraph')
      p.setAttribute('id', `${l}-${Math.random()}-${i}`) // block ids differ between the two copies too
      p.insert(0, [new Y.XmlText(l)])
      return p
    })
  }
  /** A syncs first; B has its own copy of the same note (id and createdAt) and turns sync on after. */
  async function both(aLines: string[], bLines: string[], edited: { a: number; b: number } = { a: 100, b: 100 }) {
    const a = await device('A')
    const b = await device('B')
    const id = 'same-note'
    for (const d of [a, b]) {
      d.vault.createNote({ id, title: 'T-code', createdAt: 100, updatedAt: d === a ? edited.a : edited.b })
      const doc = await d.notes.acquire(id)
      doc.getXmlFragment('content').insert(0, body(...(d === a ? aLines : bLines)))
      d.notes.release(id)
    }
    a.vault.setNoteSynced(id, true)
    await a.manager.start()
    await until(() => !a.manager.hasPending())
    b.vault.setNoteSynced(id, true)
    await b.manager.start()
    await until(() => !b.manager.hasPending())
    await wait(250)
    await until(() => !a.manager.hasPending() && !b.manager.hasPending())
    return { a, b, note: { id } }
  }
  const paragraphs = async (d: Device, id: string) => {
    const doc = await d.notes.acquire(id)
    const out = doc.getXmlFragment('content').toArray().map((n) => (n as Y.XmlElement).toString().replace(/<paragraph[^>]*>|<\/paragraph>/g, ''))
    d.notes.release(id)
    return out
  }
  const titles = (d: Device) => d.vault.listNotes({ includeTrashed: true }).map((n) => n.title)

  it('identical content is not doubled', async () => {
    const { a, b, note } = await both(['ST22', 'SE01', 'STMS'], ['ST22', 'SE01', 'STMS'])
    expect(await paragraphs(a, note.id)).toEqual(['ST22', 'SE01', 'STMS'])
    expect(await paragraphs(b, note.id)).toEqual(['ST22', 'SE01', 'STMS'])
    expect(a.errors).toEqual([])
    expect(b.errors).toEqual([])
  })

  it('this device edited it more recently: the cloud copy becomes this device\'s, and the other device follows', async () => {
    const { a, b, note } = await both(['old cloud text'], ['edited here', 'on B'], { a: 100, b: 900 })
    expect(await paragraphs(b, note.id)).toEqual(['edited here', 'on B'])
    expect(await paragraphs(a, note.id)).toEqual(['edited here', 'on B']) // A was already syncing: it takes the new copy as a whole
    expect(titles(a)).toEqual(['T-code']) // no extra note, nothing in the trash, on either device
    expect(titles(b)).toEqual(['T-code'])
  })

  it('the cloud copy is newer: this device\'s note becomes the cloud copy, with nothing left over', async () => {
    const { a, b, note } = await both(['newer in the cloud', 'two'], ['older here'], { a: 900, b: 100 })
    expect(await paragraphs(a, note.id)).toEqual(['newer in the cloud', 'two'])
    expect(await paragraphs(b, note.id)).toEqual(['newer in the cloud', 'two'])
    expect(titles(b)).toEqual(['T-code'])
  })

  it('the same time: the cloud copy stays', async () => {
    const { a, b, note } = await both(['cloud'], ['local'], { a: 500, b: 500 })
    expect(await paragraphs(a, note.id)).toEqual(['cloud'])
    expect(await paragraphs(b, note.id)).toEqual(['cloud'])
  })

  it('after one copy replaced the other, edits made on either device reach the other', async () => {
    const { a, b, note } = await both(['one', 'two'], ['one', 'two'])
    const docA = await a.notes.acquire(note.id)
    docA.getXmlFragment('content').insert(2, body('from A'))
    await until(async () => (await paragraphs(b, note.id)).includes('from A'))
    const docB = await b.notes.acquire(note.id)
    docB.getXmlFragment('content').insert(0, body('from B'))
    await until(async () => (await paragraphs(a, note.id)).includes('from B'))
    expect(await paragraphs(a, note.id)).toEqual(await paragraphs(b, note.id))
    expect((await paragraphs(a, note.id)).sort()).toEqual(['from A', 'from B', 'one', 'two'])
    a.notes.release(note.id)
    b.notes.release(note.id)
  })

  it('after this device\'s copy replaced the cloud\'s, the other device\'s later edits still arrive', async () => {
    const { a, b, note } = await both(['old'], ['new one', 'new two'], { a: 100, b: 900 })
    const docA = await a.notes.acquire(note.id)
    docA.getXmlFragment('content').insert(2, body('A adds'))
    await until(async () => (await paragraphs(b, note.id)).includes('A adds'))
    expect(await paragraphs(b, note.id)).toEqual(['new one', 'new two', 'A adds'])
    a.notes.release(note.id)
  })

  it('a note that was already in step is left alone (edits still merge normally)', async () => {
    const { a, b, note } = await both(['one'], ['one'])
    const docB = await b.notes.acquire(note.id)
    docB.getXmlFragment('content').insert(1, body('added on B'))
    await until(async () => (await paragraphs(a, note.id)).includes('added on B'))
    expect(await paragraphs(a, note.id)).toEqual(['one', 'added on B'])
    b.notes.release(note.id)
  })
})

describe('the trash across devices (3f-4)', () => {
  async function pair() {
    const a = await device('A')
    const folder = a.vault.createFolder({ name: 'Work', parentId: null })
    const n = a.vault.createNote({ title: 'Plan', folderId: folder.id })
    const other = a.vault.createNote({ title: 'Other', folderId: folder.id })
    for (const id of [n.id, other.id]) {
      a.vault.setNoteSynced(id, true)
      const doc = await a.notes.acquire(id)
      const p = new Y.XmlElement('paragraph')
      p.insert(0, [new Y.XmlText(`text of ${id}`)])
      doc.getXmlFragment('content').insert(0, [p])
      a.notes.release(id)
    }
    await a.manager.start()
    const b = await device('B')
    await b.manager.start()
    await until(() => b.vault.listNotes().length === 2)
    await until(() => !a.manager.hasPending() && !b.manager.hasPending())
    return { a, b, n, other, folder }
  }

  it('a note trashed on one device is in the trash on the other, and comes back when restored', async () => {
    const { a, b, n } = await pair()
    a.vault.trashNote(n.id)
    await until(() => b.vault.getNote(n.id)?.deletedAt != null)
    expect(b.vault.getNote(n.id)?.deletedAt).toBe(a.vault.getNote(n.id)?.deletedAt) // the 30 days run from the same moment
    expect(b.vault.getNote(n.id)?.synced).toBe(true) // still the same synced note, only in the trash
    a.vault.restoreNote(n.id)
    await until(() => b.vault.getNote(n.id)?.deletedAt === null)
    b.vault.trashNote(n.id)
    await until(() => a.vault.getNote(n.id)?.deletedAt != null)
  })

  it('a folder trashed with its notes is in the trash on the other device, and restoring brings it all back', async () => {
    const { a, b, n, other, folder } = await pair()
    a.vault.trashFolder(folder.id)
    await until(() => b.vault.getNote(n.id)?.deletedAt != null && b.vault.getNote(other.id)?.deletedAt != null)
    expect(b.vault.listFolders().map((f) => f.id)).toEqual([])
    expect(b.vault.listFolders({ includeTrashed: true }).map((f) => f.id)).toEqual([folder.id])
    a.vault.restoreFolder(folder.id)
    await until(() => b.vault.getNote(n.id)?.deletedAt === null && b.vault.getNote(other.id)?.deletedAt === null)
    expect(b.vault.listFolders().map((f) => f.id)).toEqual([folder.id])
    expect(b.vault.getNote(n.id)?.folderId).toBe(folder.id)
  })

  it('the later of two trash/restore actions wins on both devices', async () => {
    const { a, b, n } = await pair()
    a.vault.trashNote(n.id)
    await wait(5)
    b.vault.trashNote(n.id)
    await wait(5)
    b.vault.restoreNote(n.id) // the last word
    await until(() => a.vault.getNote(n.id)?.deletedAt === null && b.vault.getNote(n.id)?.deletedAt === null)
    await wait(200)
    expect(a.vault.getNote(n.id)?.deletedAt).toBeNull()
    expect(b.vault.getNote(n.id)?.deletedAt).toBeNull()
  })

  it('a device that signs in later gets the trashed note in its trash, with its text once restored', async () => {
    const a = await device('A')
    const n = a.vault.createNote({ title: 'Old' })
    a.vault.setNoteSynced(n.id, true)
    const doc = await a.notes.acquire(n.id)
    const p = new Y.XmlElement('paragraph')
    p.insert(0, [new Y.XmlText('still here')])
    doc.getXmlFragment('content').insert(0, [p])
    a.notes.release(n.id)
    await a.manager.start()
    await until(() => !a.manager.hasPending())
    a.vault.trashNote(n.id)
    await until(() => !a.manager.hasPending())
    await wait(100)

    const c = await device('C')
    await c.manager.start()
    expect(c.vault.getNote(n.id)?.deletedAt).not.toBeNull()
    c.vault.restoreNote(n.id)
    const docC = await c.notes.acquire(n.id)
    await until(() => text(docC).includes('still here'))
    c.notes.release(n.id)
  })
})

describe('being synced follows the account (3f-4)', () => {
  const para = (t: string) => {
    const p = new Y.XmlElement('paragraph')
    p.insert(0, [new Y.XmlText(t)])
    return p
  }
  const content = async (d: Device, id: string) => {
    const doc = await d.notes.acquire(id)
    const out = doc.getXmlFragment('content').toArray().map((n) => (n as Y.XmlElement).toString().replace(/<[^>]+>/g, ''))
    d.notes.release(id)
    return out
  }
  async function pair() {
    const a = await device('A')
    const n = a.vault.createNote({ title: 'Shared' })
    a.vault.setNoteSynced(n.id, true)
    const doc = await a.notes.acquire(n.id)
    doc.getXmlFragment('content').insert(0, [para('first')])
    a.notes.release(n.id)
    await a.manager.start()
    const b = await device('B')
    await b.manager.start()
    await until(() => b.vault.getNote(n.id)?.synced === true)
    await until(() => !a.manager.hasPending() && !b.manager.hasPending())
    return { a, b, n }
  }

  it('turned off on one device and on again: the other device follows both ways and gets the new text', async () => {
    const { a, b, n } = await pair()
    a.vault.setNoteSynced(n.id, false)
    await until(() => b.vault.getNote(n.id)?.synced === false)
    await until(async () => ((await pullManifest(sync, kek, 'v1'))?.removed ?? []).length === 1)
    const docA = await a.notes.acquire(n.id)
    docA.getXmlFragment('content').insert(1, [para('written while off')])
    a.notes.release(n.id)
    a.vault.setNoteSynced(n.id, true)
    await until(() => b.vault.getNote(n.id)?.synced === true) // B shows it as synced again, nobody turned it on there
    await until(async () => (await content(b, n.id)).includes('written while off'))
    expect(await content(b, n.id)).toEqual(['first', 'written while off'])
    expect(b.errors).toEqual([])
  })

  it('a note this device already had (not synced) is synced when it signs in and the account has it', async () => {
    const a = await device('A')
    const n = a.vault.createNote({ id: 'same', title: 'Same', createdAt: 100, updatedAt: 500 })
    a.vault.setNoteSynced(n.id, true)
    const docA = await a.notes.acquire(n.id)
    docA.getXmlFragment('content').insert(0, [para('123'), para('123'), para('123')])
    a.notes.release(n.id)
    await a.manager.start()
    await until(() => !a.manager.hasPending())

    const b = await device('B') // an older copy of the same note, never synced here
    b.vault.createNote({ id: 'same', title: 'Same', createdAt: 100, updatedAt: 100 })
    const docB = await b.notes.acquire('same')
    docB.getXmlFragment('content').insert(0, [para('123')])
    b.notes.release('same')
    expect(b.vault.getNote('same')?.synced).toBe(false)
    await b.manager.start()
    await until(() => b.vault.getNote('same')?.synced === true)
    await until(async () => (await content(b, 'same')).length === 3)
    expect(await content(b, 'same')).toEqual(['123', '123', '123'])
  })

  it('the one who turns it off keeps it off: a manifest that does not know yet does not switch it back on', async () => {
    const { a, b, n } = await pair()
    b.vault.setNoteSynced(n.id, false)
    await wait(300)
    expect(b.vault.getNote(n.id)?.synced).toBe(false)
    await until(() => a.vault.getNote(n.id)?.synced === false) // and A follows the removal
    await wait(300)
    expect(b.vault.getNote(n.id)?.synced).toBe(false)
    expect(a.vault.getNote(n.id)?.synced).toBe(false)
  })

  it('turned off on B, later turned on again on A: B follows (it is the same note everywhere)', async () => {
    const { a, b, n } = await pair()
    b.vault.setNoteSynced(n.id, false)
    await until(() => a.vault.getNote(n.id)?.synced === false)
    await until(async () => ((await pullManifest(sync, kek, 'v1'))?.removed ?? []).length === 1)
    a.vault.setNoteSynced(n.id, true)
    await until(() => b.vault.getNote(n.id)?.synced === true)
  })
})
