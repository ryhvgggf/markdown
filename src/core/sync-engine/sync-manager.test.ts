import { beforeEach, describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { generateKek } from '@/adapters/crypto/webcrypto-crypto'
import { MemoryAttachmentSync } from '@/adapters/sync/memory-attachment-sync'
import { MemorySync } from '@/adapters/sync/memory-sync'
import { MemoryStorage } from '@/adapters/storage/memory-storage'
import { NoteDocCache } from '@/core/note-doc/cache'
import { Vault } from '@/core/vault/vault'
import { pullManifest } from './manifest-sync'
import { createSyncManager, type SyncManager } from './sync-manager'

const wait = (ms = 30) => new Promise((r) => setTimeout(r, ms))

let storage: MemoryStorage
let sync: MemorySync
let attachmentSync: MemoryAttachmentSync
let kek: CryptoKey
let vault: Vault
let noteDocs: NoteDocCache
let manager: SyncManager | null

async function setup() {
  storage = new MemoryStorage()
  sync = new MemorySync()
  attachmentSync = new MemoryAttachmentSync()
  kek = await generateKek()
  vault = await Vault.open(storage, 'v1')
  noteDocs = new NoteDocCache(storage)
  manager = null
}
beforeEach(setup)

function mkManager(onError?: (e: unknown, info: { docId: string }) => void) {
  manager = createSyncManager({ sync, attachmentSync, storage, noteDocs, vault, vaultId: 'v1', kek, deviceId: 'dev1', onError })
  return manager
}

function mediaEl(attachmentId: string) {
  const e = new Y.XmlElement('media')
  e.setAttribute('id', 'm1')
  e.setAttribute('attachmentId', attachmentId)
  return e
}

describe('createSyncManager', () => {
  it('start() uploads an initial snapshot for notes already marked synced', async () => {
    const note = vault.createNote({ title: 'Hello' })
    vault.setNoteSynced(note.id, true)
    const doc = await noteDocs.acquire(note.id)
    doc.getText('t').insert(0, 'content')
    noteDocs.release(note.id)

    await mkManager().start()
    expect(await sync.listDocs('v1')).toContain(note.id)
    await manager!.close()
  })

  it('does not re-upload a note already in the cloud from a previous session', async () => {
    const note = vault.createNote({ title: 'Hello' })
    vault.setNoteSynced(note.id, true)
    await sync.pushUpdate('v1', note.id, new Uint8Array([1, 2, 3]), 'other-device')

    await mkManager().start()
    const chunks = await sync.pullDoc('v1', note.id)
    expect(chunks).toHaveLength(1) // the pre-existing update, not a fresh snapshot replacing it
    await manager!.close()
  })

  it('turning sync on for a note live pushes it and updates the manifest', async () => {
    const note = vault.createNote({ title: 'Hello', folderId: null })
    await mkManager().start()
    expect(await sync.listDocs('v1')).not.toContain(note.id)

    vault.setNoteSynced(note.id, true)
    await wait()
    expect(await sync.listDocs('v1')).toContain(note.id)

    const manifest = await pullManifest(sync, kek, 'v1')
    expect(manifest?.notes.map((n) => n.id)).toEqual([note.id])
    await manager!.close()
  })

  it('turning sync off deletes the cloud doc and its attachments, keeps local content', async () => {
    const note = vault.createNote({ title: 'Hello' })
    vault.setNoteSynced(note.id, true)
    const doc = await noteDocs.acquire(note.id)
    await storage.putBlob('att1', new Blob(['img-bytes']))
    doc.getXmlFragment('content').insert(0, [mediaEl('att1')])
    noteDocs.release(note.id)

    await mkManager().start()
    await wait()
    expect(await attachmentSync.listAttachments('v1', note.id)).toEqual(['att1'])

    vault.setNoteSynced(note.id, false)
    await wait()

    expect(await sync.listDocs('v1')).not.toContain(note.id)
    expect(await attachmentSync.listAttachments('v1', note.id)).toEqual([])
    expect(vault.getNote(note.id)?.title).toBe('Hello') // local content untouched
    await manager!.close()
  })

  it('pushes a note\'s attachments on initial sync-on', async () => {
    const note = vault.createNote({ title: 'Hello' })
    const doc = await noteDocs.acquire(note.id)
    await storage.putBlob('att1', new Blob(['img-bytes']))
    doc.getXmlFragment('content').insert(0, [mediaEl('att1')])
    noteDocs.release(note.id)

    await mkManager().start()
    vault.setNoteSynced(note.id, true)
    await wait()

    expect(await attachmentSync.listAttachments('v1', note.id)).toEqual(['att1'])
    const downloaded = await attachmentSync.downloadAttachment('v1', 'att1')
    expect(downloaded).not.toBeNull()
    await manager!.close()
  })

  it('pushes a newly-referenced attachment added to an already-synced note', async () => {
    const note = vault.createNote({ title: 'Hello' })
    vault.setNoteSynced(note.id, true)
    await mkManager().start()
    await wait()
    expect(await attachmentSync.listAttachments('v1', note.id)).toEqual([])

    const doc = noteDocs.peek(note.id)!
    await storage.putBlob('att2', new Blob(['more-bytes']))
    doc.getXmlFragment('content').insert(0, [mediaEl('att2')])
    await wait()

    expect(await attachmentSync.listAttachments('v1', note.id)).toEqual(['att2'])
    await manager!.close()
  })

  it('recomputes the manifest when a synced note is renamed', async () => {
    const note = vault.createNote({ title: 'Before' })
    vault.setNoteSynced(note.id, true)
    await mkManager().start()
    await wait()

    vault.renameNote(note.id, 'After')
    await wait()

    const manifest = await pullManifest(sync, kek, 'v1')
    expect(manifest?.notes.find((n) => n.id === note.id)?.title).toBe('After')
    await manager!.close()
  })

  it('does not sync notes that are never marked synced', async () => {
    const note = vault.createNote({ title: 'Local only' })
    await mkManager().start()
    await wait()
    expect(await sync.listDocs('v1')).toEqual(['v1-manifest']) // the (empty) manifest itself, not the note
    const manifest = await pullManifest(sync, kek, 'v1')
    expect(manifest?.notes ?? []).toEqual([])
    void note
    await manager!.close()
  })

  it('close() stops reacting to further vault changes', async () => {
    const note = vault.createNote({ title: 'Hello' })
    await mkManager().start()
    await manager!.close()

    vault.setNoteSynced(note.id, true)
    await wait()
    expect(await sync.listDocs('v1')).toEqual([])
  })

  it('rapid on→off (toggled off again before turn-on finishes) ends up not synced, no leaked binding or ref', async () => {
    const note = vault.createNote({ title: 'Hello' })
    await mkManager().start()

    vault.setNoteSynced(note.id, true)
    vault.setNoteSynced(note.id, false) // fires before turnOn's first await even resolves
    await wait(50)

    expect(await sync.listDocs('v1')).toEqual(['v1-manifest']) // the note itself never stayed uploaded
    expect(await attachmentSync.listAttachments('v1', note.id)).toEqual([])
    await manager!.close()
    expect(noteDocs.isInUse(note.id)).toBe(false) // the acquire() from turnOn was matched by a release()
  })

  it('rapid off→on (toggled on again before turn-off finishes) ends up synced', async () => {
    const note = vault.createNote({ title: 'Hello' })
    vault.setNoteSynced(note.id, true)
    await mkManager().start()
    await wait() // let the initial turn-on actually finish before the race below

    vault.setNoteSynced(note.id, false)
    vault.setNoteSynced(note.id, true) // fires before turnOff's first await even resolves
    await wait(50)

    expect(await sync.listDocs('v1')).toContain(note.id)
    await manager!.close()
    expect(noteDocs.isInUse(note.id)).toBe(false)
  })

  it('reports per-note errors via onError without here affecting other notes', async () => {
    const good = vault.createNote({ title: 'Good' })
    const bad = vault.createNote({ title: 'Bad' })
    vault.setNoteSynced(good.id, true)
    vault.setNoteSynced(bad.id, true)

    const realPullDoc = sync.pullDoc.bind(sync)
    sync.pullDoc = async (vaultId: string, docId: string) => {
      if (docId === bad.id) throw new Error('boom')
      return realPullDoc(vaultId, docId)
    }
    const errors: Array<{ docId: string }> = []
    await mkManager((_e, info) => errors.push(info)).start()

    expect(await sync.listDocs('v1')).toContain(good.id)
    expect(errors.some((e) => e.docId === bad.id)).toBe(true)
    await manager!.close()
  })
})
