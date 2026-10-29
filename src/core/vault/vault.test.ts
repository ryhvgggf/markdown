import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryStorage } from '@/adapters/storage/memory-storage'
import { Vault } from './vault'

const DAY = 24 * 60 * 60 * 1000
let storage: MemoryStorage
const open = (s = storage) => Vault.open(s, 'v1', { channelFactory: () => ({ postMessage() {}, close() {}, onmessage: null, addEventListener() {}, removeEventListener() {} }) as unknown as BroadcastChannel })
beforeEach(() => {
  storage = new MemoryStorage()
})

describe('Vault', () => {
  it('persists notes across reopen', async () => {
    const v = await open()
    const n = v.createNote({ title: 'Hello' })
    await new Promise((r) => setTimeout(r, 10))
    v.close()
    const v2 = await open()
    expect(v2.getNote(n.id)?.title).toBe('Hello')
  })

  it('rejects duplicate titles after normalization, allows blanks', async () => {
    const v = await open()
    v.createNote({ title: 'SAP' })
    const x = v.createNote({ title: 'other' })
    expect(() => v.renameNote(x.id, 'sap')).toThrowError(expect.objectContaining({ code: 'duplicate-title' }))
    expect(() => v.renameNote(x.id, ' SAP ')).toThrowError(expect.objectContaining({ code: 'duplicate-title' }))
    expect(() => v.createNote({ title: 'Sap' })).toThrowError(expect.objectContaining({ code: 'duplicate-title' }))
    v.createNote()
    v.createNote({ title: '  ' })
    expect(v.listNotes().filter((n) => n.title === '').length).toBe(2)
  })

  it('rejects folder cycles and leaves structure unchanged', async () => {
    const v = await open()
    const a = v.createFolder({ name: 'a', parentId: null })
    const b = v.createFolder({ name: 'b', parentId: a.id })
    const c = v.createFolder({ name: 'c', parentId: b.id })
    expect(() => v.moveFolder(a.id, { parentId: c.id, index: 0 })).toThrowError(
      expect.objectContaining({ code: 'cycle' }),
    )
    expect(() => v.moveFolder(a.id, { parentId: a.id, index: 0 })).toThrowError(
      expect.objectContaining({ code: 'cycle' }),
    )
    expect(v.listFolders().find((f) => f.id === a.id)?.parentId).toBeNull()
  })

  it('moves notes and throws not-found', async () => {
    const v = await open()
    const f = v.createFolder({ name: 'f', parentId: null })
    const n = v.createNote({ title: 'n' })
    v.moveNote(n.id, { folderId: f.id, index: 0 })
    expect(v.getNote(n.id)?.folderId).toBe(f.id)
    expect(() => v.renameNote('nope', 'x')).toThrowError(expect.objectContaining({ code: 'not-found' }))
  })

  it('setNoteSynced flips the sync flag and throws not-found for a missing note', async () => {
    const v = await open()
    const n = v.createNote({ title: 'n' })
    expect(v.getNote(n.id)?.synced).toBe(false)
    v.setNoteSynced(n.id, true)
    expect(v.getNote(n.id)?.synced).toBe(true)
    expect(v.listNotes().find((x) => x.id === n.id)?.synced).toBe(true)
    v.setNoteSynced(n.id, false)
    expect(v.getNote(n.id)?.synced).toBe(false)
    expect(() => v.setNoteSynced('nope', true)).toThrowError(expect.objectContaining({ code: 'not-found' }))
  })

  it('trashes and restores folders recursively; orphan restores to root', async () => {
    const v = await open()
    const a = v.createFolder({ name: 'a', parentId: null })
    const b = v.createFolder({ name: 'b', parentId: a.id })
    const n = v.createNote({ title: 'n', folderId: b.id })
    v.trashFolder(a.id)
    expect(v.listFolders({ includeTrashed: true }).every((f) => f.deletedAt !== null)).toBe(true)
    expect(v.getNote(n.id)?.deletedAt).not.toBeNull()
    v.restoreFolder(a.id)
    expect(v.listFolders().length).toBe(2)
    expect(v.getNote(n.id)?.deletedAt).toBeNull()

    v.trashFolder(a.id)
    v.restoreFolder(b.id)
    expect(v.listFolders().find((f) => f.id === b.id)?.deletedAt).toBeNull()
  })

  it('restoreFolder falls back to root when parent purged', async () => {
    const v = await open()
    const a = v.createFolder({ name: 'a', parentId: null })
    const b = v.createFolder({ name: 'b', parentId: a.id })
    v.trashFolder(b.id)
    v.trashFolder(a.id)
    v.purgeExpired(Date.now() + 31 * DAY)
    expect(v.listFolders({ includeTrashed: true }).length).toBe(0)
    const c = v.createFolder({ name: 'c', parentId: null })
    const d = v.createFolder({ name: 'd', parentId: c.id })
    v.trashFolder(d.id)
    v.doc.transact(() => v.doc.getMap('folders').delete(c.id))
    v.restoreFolder(d.id)
    expect(v.listFolders().find((f) => f.id === d.id)?.parentId).toBeNull()
  })

  it('restoreNote dedupes colliding title and handles purged folder', async () => {
    const v = await open()
    const f = v.createFolder({ name: 'f', parentId: null })
    const n = v.createNote({ title: 'T', folderId: f.id })
    v.trashNote(n.id)
    v.createNote({ title: 't' })
    v.restoreNote(n.id)
    expect(v.getNote(n.id)?.title).toBe('T (2)')
    v.trashNote(n.id)
    v.doc.transact(() => v.doc.getMap('folders').delete(f.id))
    v.restoreNote(n.id)
    expect(v.getNote(n.id)?.folderId).toBeNull()
  })

  it('purgeExpired removes only >30-day items and returns unreferenced attachments', async () => {
    const v = await open()
    const old = v.createNote({ title: 'old' })
    const recent = v.createNote({ title: 'recent' })
    v.trashNote(old.id)
    v.trashNote(recent.id)
    const now = Date.now()
    v.doc.transact(() => {
      const notes = v.doc.getMap<import('yjs').Map<unknown>>('notes')
      notes.get(old.id)!.set('deletedAt', now - 31 * DAY)
      notes.get(recent.id)!.set('deletedAt', now - 29 * DAY)
    })
    v.addAttachment({ filename: 'a', mimeType: 'image/png', size: 1 })
    expect(v.purgeExpired(now)).toEqual({ noteIds: [old.id], attachmentIds: [] })
    expect(v.getNote(old.id)).toBeUndefined()
    expect(v.getNote(recent.id)).toBeDefined()
  })

  it('purgeExpired only removes old unreferenced attachments', async () => {
    const v = await open()
    const now = Date.now()
    const fresh = v.addAttachment({ filename: 'f', mimeType: 'image/png', size: 1 })
    const oldUnref = v.addAttachment({ filename: 'o', mimeType: 'image/png', size: 1 })
    const oldRef = v.addAttachment({ filename: 'r', mimeType: 'image/png', size: 1 })
    v.doc.transact(() => {
      const att = v.doc.getMap<import('yjs').Map<unknown>>('attachments')
      att.get(oldUnref.id)!.set('createdAt', now - 31 * DAY)
      att.get(oldRef.id)!.set('createdAt', now - 31 * DAY)
    })
    expect(v.hasStaleAttachments(now)).toBe(true)
    expect(v.purgeExpired(now).attachmentIds).toEqual([])
    const r = v.purgeExpired(now, new Set([oldRef.id]))
    expect(r.attachmentIds).toEqual([oldUnref.id])
    const att = v.doc.getMap('attachments')
    expect(att.has(oldUnref.id)).toBe(false)
    expect(att.has(fresh.id)).toBe(true)
    expect(att.has(oldRef.id)).toBe(true)
  })

  it('hasStaleAttachments is false for an empty vault or only fresh attachments', async () => {
    const v = await open()
    expect(v.hasStaleAttachments(Date.now())).toBe(false)
    v.addAttachment({ filename: 'f', mimeType: 'image/png', size: 1 })
    expect(v.hasStaleAttachments(Date.now())).toBe(false)
  })

  describe('attachment trash', () => {
    const add = (v: Vault, name = 'a.png') => v.addAttachment({ filename: name, mimeType: 'image/png', size: 1 })

    it('new attachments are live; legacy records without deletedAt read as live', async () => {
      const v = await open()
      const a = add(v)
      expect(a.deletedAt).toBeNull()
      ;(v.doc.getMap('attachments').get(a.id) as import('yjs').Map<unknown>).delete('deletedAt')
      expect(v.getAttachment(a.id)?.deletedAt).toBeNull()
      expect(v.listAttachments().map((x) => x.id)).toEqual([a.id])
    })

    it('trash and restore move an attachment in and out of the trash, whatever its age or use', async () => {
      const v = await open()
      const a = add(v)
      const b = add(v, 'b.png')
      v.trashAttachment(a.id)
      expect(v.getAttachment(a.id)?.deletedAt).toEqual(expect.any(Number))
      expect(v.listAttachments().map((x) => x.id)).toEqual([b.id])
      expect(v.listAttachments({ includeTrashed: true }).map((x) => x.id).sort()).toEqual([a.id, b.id].sort())
      v.restoreAttachment(a.id)
      expect(v.getAttachment(a.id)?.deletedAt).toBeNull()
      expect(() => v.trashAttachment('nope')).toThrowError(expect.objectContaining({ code: 'not-found' }))
    })

    it('expiredAttachmentIds lists attachments trashed more than 30 days ago', async () => {
      const v = await open()
      const old = add(v)
      const recent = add(v, 'r.png')
      add(v, 'live.png')
      v.trashAttachment(old.id)
      v.trashAttachment(recent.id)
      const now = Date.now()
      ;(v.doc.getMap('attachments').get(old.id) as import('yjs').Map<unknown>).set('deletedAt', now - 31 * DAY)
      ;(v.doc.getMap('attachments').get(recent.id) as import('yjs').Map<unknown>).set('deletedAt', now - 29 * DAY)
      expect(v.expiredAttachmentIds(now)).toEqual([old.id])
    })

    it('the unreferenced-attachment GC leaves trashed attachments to the trash', async () => {
      const v = await open()
      const now = Date.now()
      const trashed = add(v)
      ;(v.doc.getMap('attachments').get(trashed.id) as import('yjs').Map<unknown>).set('createdAt', now - 40 * DAY)
      v.trashAttachment(trashed.id)
      expect(v.hasStaleAttachments(now)).toBe(false)
      expect(v.unreferencedAttachmentIds(now, new Set())).toEqual([])
      expect(v.purgeExpired(now, new Set()).attachmentIds).toEqual([])
      expect(v.getAttachment(trashed.id)).toBeDefined()
      v.restoreAttachment(trashed.id) // restored: counts as in use from now, not from its upload
      expect(v.getAttachment(trashed.id)?.restoredAt).toEqual(expect.any(Number))
      expect(v.unreferencedAttachmentIds(now, new Set())).toEqual([])
      expect(v.unreferencedAttachmentIds(now + 31 * DAY, new Set())).toEqual([trashed.id])
    })
  })

  it('resolveDuplicateTitles renames the later-created note', async () => {
    const v = await open()
    const a = v.createNote({ title: 'X' })
    const b = v.createNote({ title: 'Y' })
    v.doc.transact(() => {
      const notes = v.doc.getMap<import('yjs').Map<unknown>>('notes')
      notes.get(a.id)!.set('createdAt', 1)
      notes.get(b.id)!.set('createdAt', 2)
      notes.get(b.id)!.set('title', 'X')
    })
    expect(v.resolveDuplicateTitles()).toEqual([b.id])
    expect(v.getNote(b.id)?.title).toBe('X (2)')
    expect(v.getNote(a.id)?.title).toBe('X')
  })

  it('observe fires on change and unsubscribes', async () => {
    const v = await open()
    const cb = vi.fn()
    const off = v.observe(cb)
    v.createNote({ title: 'a' })
    expect(cb).toHaveBeenCalled()
    off()
    cb.mockClear()
    v.createNote({ title: 'b' })
    expect(cb).not.toHaveBeenCalled()
  })

  it('purgeFolder removes the folder subtree and every note inside, returning the note ids', async () => {
    const v = await open()
    const a = v.createFolder({ name: 'A', parentId: null })
    const b = v.createFolder({ name: 'B', parentId: a.id })
    const keep = v.createFolder({ name: 'Keep', parentId: null })
    const n1 = v.createNote({ title: 'one', folderId: a.id })
    const n2 = v.createNote({ title: 'two', folderId: b.id })
    const n3 = v.createNote({ title: 'three', folderId: keep.id })
    v.trashFolder(a.id)
    expect(v.purgeFolder(a.id).sort()).toEqual([n1.id, n2.id].sort())
    expect(v.listFolders({ includeTrashed: true }).map((f) => f.id)).toEqual([keep.id])
    expect(v.listNotes({ includeTrashed: true }).map((n) => n.id)).toEqual([n3.id])
  })

  it('purgeExpired keeps the whole folder chain of a skipped note', async () => {
    const v = await open()
    const top = v.createFolder({ name: 'top', parentId: null })
    const mid = v.createFolder({ name: 'mid', parentId: top.id })
    const n = v.createNote({ title: 'kept', folderId: mid.id })
    v.trashFolder(top.id)
    const old = Date.now() - 31 * DAY
    for (const id of [top.id, mid.id]) (v.doc.getMap('folders').get(id) as import('yjs').Map<unknown>).set('deletedAt', old)
    ;(v.doc.getMap('notes').get(n.id) as import('yjs').Map<unknown>).set('deletedAt', old)
    v.purgeExpired(Date.now(), undefined, new Set([n.id]))
    expect(v.listFolders({ includeTrashed: true }).map((f) => f.id).sort()).toEqual([top.id, mid.id].sort())
    expect(v.getNote(n.id)).toBeDefined()
  })
})

describe('Vault — import options', () => {
  it('creates notes, folders and attachments with given ids and times', async () => {
    const v = await open()
    const f = v.createFolder({ id: 'fold-1', name: 'F', parentId: null })
    expect(f.id).toBe('fold-1')
    const n = v.createNote({ id: 'note-1', title: 'A', folderId: 'fold-1', createdAt: 1000, updatedAt: 2000 })
    expect(n).toMatchObject({ id: 'note-1', createdAt: 1000, updatedAt: 2000, folderId: 'fold-1' })
    const a = v.addAttachment({ id: 'att-1', createdAt: 3000, filename: 'x.png', mimeType: 'image/png', size: 1 })
    expect(v.getAttachment('att-1')).toMatchObject({ id: 'att-1', createdAt: 3000 })
    expect(a.id).toBe('att-1')
  })

  it('refuses an id that is already taken', async () => {
    const v = await open()
    v.createNote({ id: 'x', title: 'A' })
    expect(() => v.createNote({ id: 'x', title: 'B' })).toThrow(expect.objectContaining({ code: 'exists' }))
    v.createFolder({ id: 'f', name: 'F', parentId: null })
    expect(() => v.createFolder({ id: 'f', name: 'G', parentId: null })).toThrow(expect.objectContaining({ code: 'exists' }))
    v.addAttachment({ id: 'a', filename: 'a', mimeType: 'x', size: 1 })
    expect(() => v.addAttachment({ id: 'a', filename: 'b', mimeType: 'x', size: 1 })).toThrow(expect.objectContaining({ code: 'exists' }))
  })
})

describe('Vault — undo (notes & folders)', () => {
  it('undo/redo only tracks mutations made through asUserAction', async () => {
    const v = await open()
    expect(v.canUndo()).toBe(false)
    const n = v.asUserAction(() => v.createNote({ title: 'A' }))
    expect(v.canUndo()).toBe(true)
    v.createNote({ title: 'B' }) // not a user action: untracked
    v.undo()
    expect(v.listNotes().map((x) => x.title)).toEqual(['B'])
    expect(v.canUndo()).toBe(false)
    expect(v.canRedo()).toBe(true)
    v.redo()
    expect(v.listNotes().map((x) => x.title).sort()).toEqual(['A', 'B'])
    expect(v.getNote(n.id)?.title).toBe('A')
  })

  it('undoes trash/restore, rename and move as separate steps, LIFO', async () => {
    const v = await open()
    const n = v.asUserAction(() => v.createNote({ title: 'orig' }))
    v.asUserAction(() => v.renameNote(n.id, 'renamed'))
    v.asUserAction(() => v.trashNote(n.id))
    expect(v.getNote(n.id)?.deletedAt).not.toBeNull()
    v.undo() // undo trash
    expect(v.getNote(n.id)?.deletedAt).toBeNull()
    expect(v.getNote(n.id)?.title).toBe('renamed')
    v.undo() // undo rename
    expect(v.getNote(n.id)?.title).toBe('orig')
    v.undo() // undo create
    expect(v.getNote(n.id)).toBeUndefined()
    expect(v.canUndo()).toBe(false)
  })

  it('undoes folder creation and move', async () => {
    const v = await open()
    const a = v.asUserAction(() => v.createFolder({ name: 'a', parentId: null }))
    const b = v.asUserAction(() => v.createFolder({ name: 'b', parentId: null }))
    v.asUserAction(() => v.moveFolder(b.id, { parentId: a.id, index: 0 }))
    expect(v.listFolders().find((f) => f.id === b.id)?.parentId).toBe(a.id)
    v.undo() // undo move
    expect(v.listFolders().find((f) => f.id === b.id)?.parentId).toBeNull()
    v.undo() // undo create b
    expect(v.listFolders().map((f) => f.id)).toEqual([a.id])
    v.undo() // undo create a
    expect(v.listFolders()).toEqual([])
  })

  it('an action outside asUserAction (e.g. import) does not join the undo stack', async () => {
    const v = await open()
    v.createNote({ id: 'imported', title: 'imported' }) // plain call, as import-apply.ts does
    expect(v.canUndo()).toBe(false)
  })

  it('onUndoChange fires on push and on undo', async () => {
    const v = await open()
    const seen = vi.fn()
    const off = v.onUndoChange(seen)
    v.asUserAction(() => v.createNote({ title: 'A' }))
    expect(seen).toHaveBeenCalledTimes(1)
    const before = seen.mock.calls.length
    v.undo() // pops the undo stack and pushes the inverse onto the redo stack: at least one more event
    expect(seen.mock.calls.length).toBeGreaterThan(before)
    off()
  })
})
