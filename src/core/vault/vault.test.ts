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
    expect(v.purgeExpired(now).attachmentIds).toEqual([])
    const r = v.purgeExpired(now, new Set([oldRef.id]))
    expect(r.attachmentIds).toEqual([oldUnref.id])
    const att = v.doc.getMap('attachments')
    expect(att.has(oldUnref.id)).toBe(false)
    expect(att.has(fresh.id)).toBe(true)
    expect(att.has(oldRef.id)).toBe(true)
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
})
