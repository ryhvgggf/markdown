import { beforeEach, describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { generateKek } from '@/adapters/crypto/webcrypto-crypto'
import { MemoryAttachmentSync } from '@/adapters/sync/memory-attachment-sync'
import { MemorySync } from '@/adapters/sync/memory-sync'
import { MemoryStorage } from '@/adapters/storage/memory-storage'
import { NoteDocCache } from '@/core/note-doc/cache'
import { Vault } from '@/core/vault/vault'
import { manifestDocId, pullManifest } from './manifest-sync'
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

  it('picks up a note another device turned sync on for, without this device restarting', async () => {
    await mkManager().start()
    await wait()
    expect(vault.listNotes()).toHaveLength(0)

    // Device B: a separate Vault sharing the same cloud (`sync`), turning a note's sync on.
    const storageB = new MemoryStorage()
    const vaultB = await Vault.open(storageB, 'v1')
    const notesB = vaultB.createNote({ title: 'From device B' })
    vaultB.setNoteSynced(notesB.id, true)
    const noteDocsB = new NoteDocCache(storageB)
    const managerB = createSyncManager({ sync, attachmentSync, storage: storageB, noteDocs: noteDocsB, vault: vaultB, vaultId: 'v1', kek, deviceId: 'devB' })
    await managerB.start()
    await wait()

    await wait(100) // this device's manager hears the manifest notification and merges it in on its own
    expect(vault.getNote(notesB.id)?.title).toBe('From device B')
    expect(vault.getNote(notesB.id)?.synced).toBe(true)

    await manager!.close()
    await managerB.close()
  })

  it('finishes an in-flight manifest merge before detaching the vault observer on close() (merged note still gets bound, not left synced-but-unbound)', async () => {
    // Deterministic repro instead of hoping real timing lands inside the race window: gate this manager's
    // (and only this manager's — device B keeps the real, ungated `sync`) next manifest pull so it's
    // provably still in flight — suspended, not just "probably not done yet" — when close() runs.
    let gateArmed = false
    let releaseGate = () => {}
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve
    })
    const gated = Object.assign(Object.create(Object.getPrototypeOf(sync)), sync, {
      pullDoc: async (vaultId: string, docId: string) => {
        if (gateArmed && docId === manifestDocId('v1')) {
          gateArmed = false
          await gate
        }
        return sync.pullDoc(vaultId, docId)
      },
    })

    const acquiredIds: string[] = []
    const realAcquire = noteDocs.acquire.bind(noteDocs)
    noteDocs.acquire = (id: string) => {
      acquiredIds.push(id)
      return realAcquire(id)
    }

    const managerA = createSyncManager({ sync: gated, attachmentSync, storage, noteDocs, vault, vaultId: 'v1', kek, deviceId: 'dev1' })
    await managerA.start()
    await wait()
    gateArmed = true // armed only now, so start()'s own initial manifest pull (above) was never gated

    const storageB = new MemoryStorage()
    const vaultB = await Vault.open(storageB, 'v1')
    const noteB = vaultB.createNote({ title: 'From device B' })
    vaultB.setNoteSynced(noteB.id, true)
    const noteDocsB = new NoteDocCache(storageB)
    const managerB = createSyncManager({ sync, attachmentSync, storage: storageB, noteDocs: noteDocsB, vault: vaultB, vaultId: 'v1', kek, deviceId: 'devB' })
    await managerB.start()

    // devB's manifest push notifies managerA, which schedules its own merge; wait for that merge's pull to
    // actually reach (and suspend on) the gate — `gateArmed` flips back to false the moment it does.
    for (let i = 0; i < 50 && gateArmed; i++) await wait(5)
    expect(gateArmed).toBe(false) // sanity: the merge really is suspended mid-pull right now, not finished

    const closePromise = managerA.close() // must wait for that in-flight merge before detaching the observer
    releaseGate()
    await closePromise

    expect(vault.getNote(noteB.id)?.synced).toBe(true) // the merge itself still completed
    // If close() had detached the vault observer before the merge's own setNoteSynced ran, onVaultChange
    // would never have enqueued a reconcile for this note, and turnOn (hence noteDocs.acquire) would never
    // have been called for it at all in this session — unlike `synced`, this can't be papered over by
    // checking state after the fact, so it's the one assertion that actually catches the race.
    expect(acquiredIds).toContain(noteB.id)

    await managerB.close()
  })

  it('reports a manifest-merge id collision via onError without touching the local note', async () => {
    const local = vault.createNote({ title: 'Mine', createdAt: 100, updatedAt: 100 })
    const errors: Array<{ docId: string }> = []
    await mkManager((_e, info) => errors.push(info)).start()
    await wait()

    // Someone else's manifest claims the same id with a different createdAt — a genuine collision.
    const { pushManifest } = await import('./manifest-sync')
    await pushManifest(
      sync,
      kek,
      'v1',
      [{ id: local.id, title: 'Unrelated note, same id', folderId: null, order: 'a', createdAt: 999, updatedAt: 999, deletedAt: null, synced: true }],
      [],
    )
    await wait(100)

    expect(vault.getNote(local.id)?.title).toBe('Mine')
    expect(errors.some((e) => e.docId === local.id)).toBe(true)
    await manager!.close()
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
