// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import { bootstrap, type AppServices } from './bootstrap'
import { Indexer } from '@/core/indexer/indexer'
import { LocalSearch } from '@/core/search/search-service'

let n = 0
const name = () => `boot-${Date.now()}-${n++}`
const channelFactory = () =>
  ({ postMessage() {}, close() {}, onmessage: null, addEventListener() {}, removeEventListener() {} }) as unknown as BroadcastChannel
const stubSearch = () => ({ search: async () => [], mentions: async () => [], dispose() {} })
const boot = (dbName: string, extra: Parameters<typeof bootstrap>[0] = {}) =>
  bootstrap({ dbName, channelFactory, createSearch: stubSearch, ...extra })

async function until(fn: () => Promise<boolean>) {
  for (let i = 0; i < 100; i++) {
    if (await fn()) return
    await new Promise((r) => setTimeout(r, 20))
  }
  throw new Error('timeout')
}

describe('bootstrap', () => {
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
    expect((await a.db.meta.get('indexVersion'))?.value).toBe(2)
    await until(async () => (await a.storage.listDocs()).length > 0)
    const spy = vi.spyOn(Indexer.prototype, 'rebuildAll')
    await boot(dbName)
    expect(spy).not.toHaveBeenCalled()
    await a.db.meta.put({ key: 'indexVersion', value: 1 })
    const c = await boot(dbName)
    expect(spy).toHaveBeenCalledTimes(1)
    expect((await c.db.meta.get('indexVersion'))?.value).toBe(2)
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
})
