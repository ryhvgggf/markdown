// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import { MemoryStorage } from '@/adapters/storage/memory-storage'
import { createDb, type NotesDb } from '@/adapters/storage/db'
import { StorageError } from '@/adapters/storage/types'
import { Indexer } from '../indexer/indexer'
import { NoteDocCache } from '../note-doc/cache'
import { TRASH_TTL_MS, Vault } from '../vault/vault'
import { ATTACHMENT_DELETE_AFTER_KEY, INDEX_VERSION, LAST_ATTACHMENT_GC_KEY, Maintenance, PENDING_PURGE_KEY } from './maintenance'

const fakeChannel = () =>
  ({ postMessage() {}, close() {}, onmessage: null, addEventListener() {}, removeEventListener() {} }) as unknown as BroadcastChannel
const DAY = 86_400_000

let db: NotesDb
let storage: MemoryStorage
let vault: Vault
let notes: NoteDocCache
let indexer: Indexer
let onError: ReturnType<typeof vi.fn<(e: StorageError) => void>>
let m: Maintenance

beforeEach(async () => {
  db = createDb('maint-' + Math.random().toString(36).slice(2))
  storage = new MemoryStorage()
  vault = await Vault.open(storage, 'v1', { channelFactory: fakeChannel })
  notes = new NoteDocCache(storage, { channelFactory: fakeChannel })
  indexer = new Indexer(db, vault, notes, storage)
  onError = vi.fn()
  m = new Maintenance({ db, storage, vault, notes, indexer, onError })
  await db.meta.put({ key: 'indexVersion', value: INDEX_VERSION })
})
afterEach(() => {
  vault.close()
  db.close()
})

function body(parts: Array<string | Y.XmlElement>): Uint8Array {
  const d = new Y.Doc()
  const p = new Y.XmlElement('paragraph')
  p.setAttribute('id', 'p' + Math.random())
  p.insert(0, parts.map((x) => (typeof x === 'string' ? new Y.XmlText(x) : x)))
  d.getXmlFragment('content').insert(0, [p])
  return Y.encodeStateAsUpdate(d)
}
function media(id: string) {
  const e = new Y.XmlElement('media')
  e.setAttribute('attachmentId', id)
  return e
}
async function noteWith(title: string, parts: Array<string | Y.XmlElement>) {
  const n = vault.createNote({ title })
  await storage.appendUpdate(n.id, body(parts))
  return n
}
async function attachment(ageDays: number) {
  const a = vault.addAttachment({ filename: 'a.png', mimeType: 'image/png', size: 3 })
  ;(vault.doc.getMap('attachments').get(a.id) as Y.Map<unknown>).set('createdAt', Date.now() - ageDays * DAY)
  await storage.putBlob(a.id, new Blob(['abc'], { type: 'image/png' }))
  return a.id
}
const corrupt = (id: string) => storage.appendUpdate(id, new Uint8Array([255, 255, 255, 255]))
const expire = (id: string) => {
  vault.trashNote(id)
  ;(vault.doc.getMap('notes').get(id) as Y.Map<unknown>).set('deletedAt', Date.now() - TRASH_TTL_MS - DAY)
}

describe('Maintenance.runStartup (C1, I4, M5, M11)', () => {
  it('survives a corrupt note with an old attachment: nothing is purged, the rest is maintained', async () => {
    const att = await attachment(31)
    await noteWith('Image', ['x', media(att)])
    const victim = vault.createNote({ title: 'Victim' })
    await corrupt(victim.id)
    await db.meta.put({ key: 'indexVersion', value: 1 }) // forces a rebuild too
    const report = await m.runStartup()
    expect(report.unreadable).toContain(victim.id)
    expect(vault.getAttachment(att)).toBeDefined()
    expect(await storage.getBlob(att)).toBeDefined()
    expect((await db.meta.get('indexVersion'))?.value).toBe(INDEX_VERSION)
  })

  it('purges an old unreferenced attachment (blob first, then metadata) and keeps referenced ones', async () => {
    const used = await attachment(40)
    const orphan = await attachment(40)
    const fresh = await attachment(1)
    const t = await noteWith('Trashed', ['x', media(used)])
    vault.trashNote(t.id)
    await m.runStartup()
    expect(vault.getAttachment(orphan)).toBeUndefined()
    expect(await storage.getBlob(orphan)).toBeUndefined()
    expect(vault.getAttachment(used)).toBeDefined()
    expect(vault.getAttachment(fresh)).toBeDefined()
  })

  it('scans attachment references at most once a day', async () => {
    await noteWith('Uses it', ['x', media(await attachment(40))]) // stays stale: referenced
    const spy = vi.spyOn(indexer, 'referencedAttachmentIds')
    await m.runStartup()
    await m.runStartup()
    expect(spy).toHaveBeenCalledTimes(1)
    expect(typeof (await db.meta.get(LAST_ATTACHMENT_GC_KEY))?.value).toBe('number')
    await db.meta.put({ key: LAST_ATTACHMENT_GC_KEY, value: Date.now() - DAY - 1 })
    await m.runStartup()
    expect(spy).toHaveBeenCalledTimes(2)
  })

  it('never throws when storage fails; reports it and finishes the purge on the next start', async () => {
    const n = await noteWith('Old', ['bye'])
    expire(n.id)
    const del = vi.spyOn(storage, 'deleteDoc').mockRejectedValueOnce(new StorageError('quota', 'full'))
    await expect(m.runStartup()).resolves.toBeDefined()
    expect(onError).toHaveBeenCalled()
    expect(vault.getNote(n.id)).toBeUndefined()
    expect((await db.meta.get(PENDING_PURGE_KEY))?.value).toEqual([n.id])
    expect(await storage.loadDoc(n.id)).toHaveLength(1)
    del.mockRestore()
    await m.runStartup()
    expect(await storage.loadDoc(n.id)).toHaveLength(0)
    expect((await db.meta.get(PENDING_PURGE_KEY))?.value ?? []).toEqual([])
  })

  it('finishes a permanent delete interrupted before the vault change was stored', async () => {
    const n = await noteWith('Half', ['gone'])
    vault.trashNote(n.id)
    await db.meta.put({ key: PENDING_PURGE_KEY, value: [n.id] })
    await m.runStartup()
    expect(vault.getNote(n.id)).toBeUndefined()
    expect(await storage.loadDoc(n.id)).toHaveLength(0)
  })

  it('re-indexes notes left dirty and resolves duplicate titles from concurrent tabs', async () => {
    const n = await noteWith('Dirty', ['zebrafish'])
    await db.meta.put({ key: 'dirty:' + n.id, value: 1 })
    const a = vault.createNote({ title: 'Same' })
    const b = vault.createNote({ title: 'Other' })
    ;(vault.doc.getMap('notes').get(b.id) as Y.Map<unknown>).set('title', 'Same')
    ;(vault.doc.getMap('notes').get(b.id) as Y.Map<unknown>).set('createdAt', a.createdAt + 1)
    await m.runStartup()
    expect((await db.noteText.get(n.id))?.text).toBe('zebrafish')
    expect(vault.getNote(a.id)?.title).toBe('Same')
    expect(vault.getNote(b.id)?.title).not.toBe('Same')
  })
})

describe('Maintenance.purge (I5)', () => {
  it('removes doc, index rows and attachments no other note references', async () => {
    const own = await attachment(0)
    const shared = await attachment(0)
    const n = await noteWith('Doomed', ['x', media(own), media(shared)])
    const other = await noteWith('Other', ['y', media(shared)])
    vault.trashNote(other.id)
    await indexer.indexNote(n.id)
    vault.trashNote(n.id)
    await m.purge({ kind: 'note', id: n.id })
    expect(vault.getNote(n.id)).toBeUndefined()
    expect(await storage.loadDoc(n.id)).toHaveLength(0)
    expect(await db.noteText.get(n.id)).toBeUndefined()
    expect((await db.meta.get(PENDING_PURGE_KEY))?.value ?? []).toEqual([])
    // attachments are only marked: another note's undo history may still bring them back
    expect(vault.getAttachment(own)).toBeDefined()
    expect(await storage.getBlob(own)).toBeDefined()
    const marks = (await db.meta.get(ATTACHMENT_DELETE_AFTER_KEY))?.value as Record<string, number>
    expect(Object.keys(marks).sort()).toEqual([own, shared].sort())
    // a day later the GC deletes the marked ones that are still unreferenced
    const later = new Maintenance({ db, storage, vault, notes, indexer, onError, now: () => Date.now() + DAY + 1000 })
    await later.runStartup()
    expect(vault.getAttachment(own)).toBeUndefined()
    expect(await storage.getBlob(own)).toBeUndefined()
    expect(vault.getAttachment(shared)).toBeDefined()
    expect((await db.meta.get(ATTACHMENT_DELETE_AFTER_KEY))?.value ?? {}).toEqual({})
  })

  it('keeps a marked attachment that is referenced again before the grace period ends', async () => {
    const own = await attachment(0)
    const n = await noteWith('Doomed', ['x', media(own)])
    vault.trashNote(n.id)
    await m.purge({ kind: 'note', id: n.id })
    await noteWith('Undo brought it back', ['y', media(own)])
    const later = new Maintenance({ db, storage, vault, notes, indexer, onError, now: () => Date.now() + DAY + 1000 })
    await later.runStartup()
    expect(vault.getAttachment(own)).toBeDefined()
    expect(await storage.getBlob(own)).toBeDefined()
  })

  it('purges every note of a folder subtree', async () => {
    const f = vault.createFolder({ name: 'F', parentId: null })
    const n = vault.createNote({ title: 'In', folderId: f.id })
    await storage.appendUpdate(n.id, body(['x']))
    vault.trashFolder(f.id)
    await m.purge({ kind: 'folder', id: f.id })
    expect(vault.listFolders({ includeTrashed: true })).toHaveLength(0)
    expect(await storage.loadDoc(n.id)).toHaveLength(0)
  })

  it('reports a storage failure instead of rejecting, and keeps the purge pending', async () => {
    const n = await noteWith('Doomed', ['x'])
    vault.trashNote(n.id)
    vi.spyOn(storage, 'deleteDoc').mockRejectedValueOnce(new StorageError('unknown', 'boom'))
    await expect(m.purge({ kind: 'note', id: n.id })).resolves.toBe(false)
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ name: 'StorageError' }))
    expect((await db.meta.get(PENDING_PURGE_KEY))?.value).toEqual([n.id])
  })

  it('keeps an attachment when some note cannot be read', async () => {
    const own = await attachment(0)
    const n = await noteWith('Doomed', ['x', media(own)])
    const bad = vault.createNote({ title: 'Bad' })
    await corrupt(bad.id)
    vault.trashNote(n.id)
    await m.purge({ kind: 'note', id: n.id })
    const later = new Maintenance({ db, storage, vault, notes, indexer, onError, now: () => Date.now() + DAY + 1000 })
    await later.runStartup()
    expect(vault.getAttachment(own)).toBeDefined()
  })
})

describe('Maintenance.watchDuplicateTitles (M11)', () => {
  it('renames a duplicate created concurrently by another tab', async () => {
    const off = m.watchDuplicateTitles(10)
    const a = vault.createNote({ title: 'Plan' })
    const b = vault.createNote({ title: 'x' })
    const map = vault.doc.getMap('notes').get(b.id) as Y.Map<unknown>
    vault.doc.transact(() => {
      map.set('createdAt', a.createdAt + 1)
      map.set('title', 'Plan')
    })
    await vi.waitFor(() => expect(vault.getNote(b.id)?.title).toBe('Plan (2)'))
    expect(vault.getNote(a.id)?.title).toBe('Plan')
    off()
  })
})

describe('Maintenance yields to the UI (I4)', () => {
  it('pauses between notes during the O(vault) attachment scan', async () => {
    const pause = vi.fn(async () => {})
    const mm = new Maintenance({ db, storage, vault, notes, indexer, pause })
    for (let i = 0; i < 3; i++) await noteWith('N' + i, ['x', media(await attachment(40))])
    await mm.runStartup()
    expect(pause.mock.calls.length).toBeGreaterThanOrEqual(3)
  })
})

describe('Maintenance purge timing (round 2)', () => {
  it('finishPendingPurges completes an interrupted permanent delete', async () => {
    const n = await noteWith('Half', ['gone'])
    vault.trashNote(n.id)
    await db.meta.put({ key: PENDING_PURGE_KEY, value: [n.id] })
    await m.finishPendingPurges()
    expect(vault.getNote(n.id)).toBeUndefined()
    expect(await storage.loadDoc(n.id)).toHaveLength(0)
  })

  it('the expired-trash purge skips a note that is open', async () => {
    const n = await noteWith('Old but open', ['x'])
    expire(n.id)
    await notes.acquire(n.id)
    await m.runStartup()
    expect(vault.getNote(n.id)).toBeDefined()
    expect(await storage.loadDoc(n.id)).not.toHaveLength(0)
    expect((await db.meta.get(PENDING_PURGE_KEY))?.value ?? []).toEqual([])
  })

  it('the expired-trash purge skips a note restored while the purge was being recorded', async () => {
    const n = await noteWith('Old', ['x'])
    expire(n.id)
    const orig = db.transaction.bind(db) as (...a: unknown[]) => unknown
    vi.spyOn(db, 'transaction').mockImplementationOnce(((...args: unknown[]) => {
      vault.restoreNote(n.id)
      return orig(...args)
    }) as never)
    await m.runStartup()
    expect(vault.getNote(n.id)?.deletedAt).toBeNull()
    expect(await storage.loadDoc(n.id)).not.toHaveLength(0)
    expect((await db.meta.get(PENDING_PURGE_KEY))?.value ?? []).toEqual([])
  })
})

describe('Maintenance round 3', () => {
  it('a pending purge never deletes a note that was restored meanwhile', async () => {
    const n = await noteWith('Restored', ['keep me'])
    vault.trashNote(n.id)
    vault.restoreNote(n.id)
    await db.meta.put({ key: PENDING_PURGE_KEY, value: [n.id] })
    await m.finishPendingPurges()
    expect(vault.getNote(n.id)?.deletedAt).toBeNull()
    expect(await storage.loadDoc(n.id)).toHaveLength(1)
    expect((await db.meta.get(PENDING_PURGE_KEY))?.value ?? []).toEqual([])
  })

  it('a pending purge of a trashed note that is open stays pending', async () => {
    const n = await noteWith('Open', ['x'])
    vault.trashNote(n.id)
    await notes.acquire(n.id)
    await db.meta.put({ key: PENDING_PURGE_KEY, value: [n.id] })
    await m.finishPendingPurges()
    expect(vault.getNote(n.id)).toBeDefined()
    expect((await db.meta.get(PENDING_PURGE_KEY))?.value).toEqual([n.id])
  })

  it('deferData removes vault entries at once and deletes doc data in the background', async () => {
    const n = await noteWith('Bg', ['x'])
    vault.trashNote(n.id)
    await db.meta.put({ key: PENDING_PURGE_KEY, value: [n.id] })
    let open!: () => void
    const gate = new Promise<void>((r) => (open = r))
    const del = storage.deleteDoc.bind(storage)
    vi.spyOn(storage, 'deleteDoc').mockImplementation(async (id) => (await gate, del(id)))
    await m.finishPendingPurges({ deferData: true }) // resolves while deleteDoc is still blocked
    expect(vault.getNote(n.id)).toBeUndefined()
    expect(await storage.loadDoc(n.id)).toHaveLength(1)
    open()
    await m.idle()
    expect(await storage.loadDoc(n.id)).toHaveLength(0)
  })

  it('keeps the mark of an attachment whose deletion failed', async () => {
    const own = await attachment(0)
    const n = await noteWith('Doomed', ['x', media(own)])
    vault.trashNote(n.id)
    await m.purge({ kind: 'note', id: n.id })
    vi.spyOn(storage, 'deleteBlob').mockRejectedValueOnce(new StorageError('quota', 'full'))
    const later = new Maintenance({ db, storage, vault, notes, indexer, onError, now: () => Date.now() + DAY + 1000 })
    await later.runStartup()
    expect(vault.getAttachment(own)).toBeDefined()
    expect(Object.keys(((await db.meta.get(ATTACHMENT_DELETE_AFTER_KEY))?.value ?? {}) as object)).toEqual([own])
  })

  it('an aborted scan (unreadable note) is not repeated on every start', async () => {
    const own = await attachment(0)
    const n = await noteWith('Doomed', ['x', media(own)])
    vault.trashNote(n.id)
    await m.purge({ kind: 'note', id: n.id })
    await corrupt(vault.createNote({ title: 'Bad' }).id)
    const later = new Maintenance({ db, storage, vault, notes, indexer, onError, now: () => Date.now() + DAY + 1000 })
    const spy = vi.spyOn(indexer, 'referencedAttachmentIds')
    await later.runStartup()
    await later.runStartup()
    expect(spy).toHaveBeenCalledTimes(1)
  })
})
