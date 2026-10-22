// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import { bootstrap, INDEX_VERSION, type AppServices } from './bootstrap'
import { Indexer } from '@/core/indexer/indexer'
import { LocalSearch } from '@/core/search/search-service'
import { createDb } from '@/adapters/storage/db'
import { DexieStorage } from '@/adapters/storage/dexie-storage'
import { Vault } from '@/core/vault/vault'
import * as guide from '@/features/guide/guide'

vi.mock('@/features/guide/guide', async (orig) => {
  const m = await orig<typeof import('@/features/guide/guide')>()
  return { ...m, addGuide: vi.fn(m.addGuide) }
})

let n = 0
const name = () => `boot-${Date.now()}-${n++}`
const channelFactory = () =>
  ({ postMessage() {}, close() {}, onmessage: null, addEventListener() {}, removeEventListener() {} }) as unknown as BroadcastChannel
const stubSearch = () => ({ search: async () => [], searchTags: async () => [], mentions: async () => [], dispose() {} })
const boot = (dbName: string, extra: Parameters<typeof bootstrap>[0] = {}) =>
  bootstrap({ dbName, channelFactory, createSearch: stubSearch, seedGuide: false, ...extra })

async function until(fn: () => Promise<boolean>) {
  for (let i = 0; i < 100; i++) {
    if (await fn()) return
    await new Promise((r) => setTimeout(r, 20))
  }
  throw new Error('timeout')
}

describe('bootstrap: built-in guide', () => {
  it('seeds the 功能導覽 folder on a fresh vault and opens 歡迎使用 from it', async () => {
    const s = await boot(name(), { seedGuide: true })
    const folder = s.vault.listFolders().find((f) => f.name === '功能導覽')
    expect(folder).toBeDefined()
    const inFolder = s.vault.listNotes().filter((n) => n.folderId === folder!.id)
    expect(inFolder.length).toBeGreaterThanOrEqual(8)
    expect(s.vault.listNotes()).toHaveLength(inFolder.length) // no separate empty welcome note
    const opened = s.vault.getNote(s.initialNoteId!)
    expect(opened?.title).toBe('歡迎使用')
    expect(opened?.folderId).toBe(folder!.id)
    expect((await s.db.meta.get('guideSeeded'))?.value).toBeTruthy()
    expect((await s.storage.loadDoc(s.initialNoteId!)).length).toBeGreaterThan(0)
  })

  it('does not reseed on the next start, even after the guide was deleted', async () => {
    const dbName = name()
    const a = await boot(dbName, { seedGuide: true })
    const count = a.vault.listNotes().length
    const b = await boot(dbName, { seedGuide: true })
    expect(b.vault.listNotes()).toHaveLength(count)
    for (const n of b.vault.listNotes()) b.vault.purgeNote(n.id)
    for (const f of b.vault.listFolders()) b.vault.purgeFolder(f.id)
    await b.vault.flushWrites()
    const c = await boot(dbName, { seedGuide: true })
    expect(c.vault.listFolders()).toHaveLength(0)
    expect(c.vault.listNotes().map((n) => n.title)).toEqual(['歡迎使用']) // the plain empty welcome note
  })

  it('writes guideSeeded only after the guide was added; a failure falls back to the plain welcome note', async () => {
    vi.mocked(guide.addGuide).mockRejectedValueOnce(new Error('boom'))
    const s = await boot(name(), { seedGuide: true })
    expect((await s.db.meta.get('guideSeeded'))?.value).toBeUndefined()
    expect(s.vault.listNotes().map((n) => n.title)).toEqual(['歡迎使用'])
  })

  it('seeds inside the notes-v2-seed lock and re-checks the vault there (another tab won the race)', async () => {
    const dbName = name()
    const nav = globalThis.navigator as Navigator & { locks?: unknown }
    const had = Object.getOwnPropertyDescriptor(nav, 'locks')
    const request = vi.fn(async (_lock: string, cb: () => Promise<unknown>) => {
      // while this tab waited for the lock, another tab created a note and stored it
      const other = await Vault.open(new DexieStorage(createDb(dbName)), 'default-vault', { channelFactory })
      other.createNote({ title: '別的分頁' })
      await other.flushWrites()
      other.close()
      return cb()
    })
    Object.defineProperty(nav, 'locks', { value: { request }, configurable: true })
    try {
      const s = await boot(dbName, { seedGuide: true })
      expect(request).toHaveBeenCalledWith('notes-v2-seed', expect.any(Function))
      expect(s.vault.listFolders()).toHaveLength(0) // not seeded
      expect(s.vault.listNotes().map((n) => n.title)).toEqual(['別的分頁']) // and no extra welcome note
      expect(s.vault.getNote(s.initialNoteId!)?.title).toBe('別的分頁')
    } finally {
      if (had) Object.defineProperty(nav, 'locks', had)
      else delete (nav as { locks?: unknown }).locks
    }
  })

  it('does not seed a vault that already has notes', async () => {
    const dbName = name()
    const a = await boot(dbName) // seedGuide: false → plain welcome note
    await a.vault.flushWrites()
    const b = await boot(dbName, { seedGuide: true })
    expect(b.vault.listFolders()).toHaveLength(0)
    expect(b.vault.listNotes()).toHaveLength(1)
  })
})

describe('bootstrap', () => {
  it('index version 3: link snippets carry block ids, so older indexes are rebuilt once', () => {
    expect(INDEX_VERSION).toBe(3)
  })

  it('creates a welcome note on first run and records lastNoteId', async () => {
    const s = await boot(name())
    const notes = s.vault.listNotes()
    expect(notes).toHaveLength(1)
    expect(notes[0].title).toBe('歡迎使用')
    expect((await s.db.meta.get('lastNoteId'))?.value).toBe(notes[0].id)
    expect(s.storageMode).toBe('persistent')
  })

  it('does not duplicate the welcome note on second run', async () => {
    const dbName = name()
    const a = await boot(dbName)
    const id = a.vault.listNotes()[0].id
    await until(async () => (await a.storage.listDocs()).length > 0)
    const b = await boot(dbName)
    expect(b.vault.listNotes()).toHaveLength(1)
    expect((await b.db.meta.get('lastNoteId'))?.value).toBe(id)
  })

  it('rebuilds the index once when the stored index version differs', async () => {
    const dbName = name()
    const a = await boot(dbName)
    await a.maintenance.runStartup()
    expect((await a.db.meta.get('indexVersion'))?.value).toBe(INDEX_VERSION)
    await until(async () => (await a.storage.listDocs()).length > 0)
    const spy = vi.spyOn(Indexer.prototype, 'rebuildAll')
    await (await boot(dbName)).maintenance.runStartup()
    expect(spy).not.toHaveBeenCalled()
    await a.db.meta.put({ key: 'indexVersion', value: 1 })
    const c = await boot(dbName)
    expect(spy).not.toHaveBeenCalled() // not on the critical path
    await c.maintenance.runStartup()
    expect(spy).toHaveBeenCalledTimes(1)
    expect((await c.db.meta.get('indexVersion'))?.value).toBe(INDEX_VERSION)
    spy.mockRestore()
  })

  it('falls back to memory mode and still allows creating notes', async () => {
    const s = await boot(name(), { forceMemory: true })
    expect(s.storageMode).toBe('memory')
    expect(s.persistence).toBe('unsupported')
    const note = s.vault.createNote({ title: 'x' })
    expect(s.vault.getNote(note.id)).toBeDefined()
    await s.notes.acquire(note.id)
  })

  it('uses LocalSearch by default in memory mode', async () => {
    const s = await bootstrap({ dbName: name(), channelFactory, forceMemory: true })
    expect(s.search).toBeInstanceOf(LocalSearch)
  })

  it('purges notes trashed more than 30 days ago', async () => {
    const dbName = name()
    const a = await boot(dbName)
    const old = a.vault.createNote({ title: 'old' })
    const doc = await a.notes.acquire(old.id)
    doc.getMap('x').set('k', 'v')
    a.vault.trashNote(old.id)
    ;(a.vault.doc.getMap('notes').get(old.id) as Y.Map<unknown>).set('deletedAt', Date.now() - 31 * 86400000)
    await until(async () => (await a.storage.listDocs()).includes(old.id))
    // let vault changes flush
    await new Promise((r) => setTimeout(r, 100))
    const b: AppServices = await boot(dbName)
    await b.maintenance.runStartup()
    expect(b.vault.getNote(old.id)).toBeUndefined()
    expect(await b.storage.listDocs()).not.toContain(old.id)
  })

  it('falls back to most recent live note when lastNoteId is missing', async () => {
    const dbName = name()
    const a = await boot(dbName)
    await a.db.meta.put({ key: 'lastNoteId', value: 'gone' })
    await until(async () => (await a.storage.listDocs()).length > 0)
    const b = await boot(dbName)
    expect(b.initialNoteId).toBe(a.vault.listNotes()[0].id)
  })

  it('opens even with a corrupt note, an old attachment and a pending index rebuild (C1)', async () => {
    const dbName = name()
    const a = await boot(dbName)
    const img = a.vault.addAttachment({ filename: 'a.png', mimeType: 'image/png', size: 1 })
    ;(a.vault.doc.getMap('attachments').get(img.id) as Y.Map<unknown>).set('createdAt', Date.now() - 31 * 86400000)
    const victim = a.vault.createNote({ title: 'Victim' })
    await a.storage.appendUpdate(victim.id, new Uint8Array([255, 255, 255, 255]))
    await a.db.meta.put({ key: 'indexVersion', value: 1 })
    await new Promise((r) => setTimeout(r, 100))
    const b = await boot(dbName)
    expect(b.vault.getNote(victim.id)).toBeDefined()
    const report = await b.maintenance.runStartup()
    expect(report.unreadable).toContain(victim.id)
    expect(b.vault.getAttachment(img.id)).toBeDefined()
    expect((await b.db.meta.get('indexVersion'))?.value).toBe(INDEX_VERSION)
  })

  it('stashes unsaved updates synchronously and recovers them on the next start (I2)', async () => {
    const mem = new Map<string, string>()
    const ls = {
      get length() { return mem.size },
      key: (i: number) => [...mem.keys()][i] ?? null,
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => void mem.set(k, v),
      removeItem: (k: string) => void mem.delete(k),
      clear: () => mem.clear(),
    }
    vi.stubGlobal('localStorage', ls)
    try {
      const dbName = name()
      const a = await boot(dbName)
      const n = a.vault.createNote({ title: 'Fast' })
      await new Promise((r) => setTimeout(r, 50))
      const doc = await a.notes.acquire(n.id)
      const put = vi.spyOn(a.storage, 'appendUpdate').mockImplementation(() => new Promise(() => {})) // cut off
      doc.getText('t').insert(0, 'typed just before reload')
      a.stashUnsaved()
      expect(mem.size).toBe(1)
      put.mockRestore()
      const b = await boot(dbName)
      expect(mem.size).toBe(0)
      const d2 = await b.notes.acquire(n.id)
      expect(d2.getText('t').toString()).toBe('typed just before reload')
      expect(await b.db.meta.get('dirty:' + n.id)).toBeDefined()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('drops stashes of permanently deleted notes, keeps trashed ones, and finishes pending purges at boot', async () => {
    const mem = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      get length() { return mem.size },
      key: (i: number) => [...mem.keys()][i] ?? null,
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => void mem.set(k, v),
      removeItem: (k: string) => void mem.delete(k),
      clear: () => mem.clear(),
    })
    try {
      const dbName = name()
      const a = await boot(dbName)
      const trashed = a.vault.createNote({ title: 'Trashed' })
      a.vault.trashNote(trashed.id)
      const half = a.vault.createNote({ title: 'Half purged' })
      a.vault.trashNote(half.id)
      await a.storage.appendUpdate(half.id, new Uint8Array([0, 0]))
      await a.db.meta.put({ key: 'pendingPurge', value: [half.id] })
      await new Promise((r) => setTimeout(r, 100))
      const d = new Y.Doc()
      d.getText('t').insert(0, 'x')
      const u = btoa(String.fromCharCode(...Y.encodeStateAsUpdate(d)))
      mem.set('notes-v2.unsaved:t1:' + trashed.id, u)
      mem.set('notes-v2.unsaved:t1:deleted-note', u)
      const b = await boot(dbName)
      expect(mem.size).toBe(0)
      expect(await b.storage.loadDoc('deleted-note')).toHaveLength(0)
      expect(await b.storage.loadDoc(trashed.id)).toHaveLength(1)
      expect(b.vault.getNote(half.id)).toBeUndefined() // vault entry removed before the UI shows
      await b.maintenance.idle() // doc data is deleted in the background
      expect(await b.storage.loadDoc(half.id)).toHaveLength(0)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
