// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import { MemoryStorage } from '@/adapters/storage/memory-storage'
import { createDb, type NotesDb } from '@/adapters/storage/db'
import { Vault } from '../vault/vault'
import { NoteDocCache } from '../note-doc/cache'
import { Indexer } from './indexer'

const fakeChannel = () =>
  ({ postMessage() {}, close() {}, onmessage: null, addEventListener() {}, removeEventListener() {} }) as unknown as BroadcastChannel

function para(id: string, parts: Array<string | Y.XmlElement>) {
  const p = new Y.XmlElement('paragraph')
  p.setAttribute('id', id)
  p.insert(0, parts.map((x) => (typeof x === 'string' ? new Y.XmlText(x) : x)))
  return p
}
function noteLink(noteId: string, blockId?: string) {
  const e = new Y.XmlElement('noteLink')
  e.setAttribute('noteId', noteId)
  if (blockId) e.setAttribute('blockId', blockId)
  return e
}
function media(id: string) {
  const e = new Y.XmlElement('media')
  e.setAttribute('attachmentId', id)
  return e
}

let db: NotesDb
let storage: MemoryStorage
let vault: Vault
let cache: NoteDocCache
let indexer: Indexer
let stop: (() => void) | undefined

beforeEach(async () => {
  db = createDb('test-' + Math.random().toString(36).slice(2))
  storage = new MemoryStorage()
  vault = await Vault.open(storage, 'v1', { channelFactory: fakeChannel })
  cache = new NoteDocCache(storage, { channelFactory: fakeChannel })
  indexer = new Indexer(db, vault, cache, storage)
})
afterEach(async () => {
  stop?.()
  stop = undefined
  vi.useRealTimers()
  vault.close()
  db.close()
})

async function writeNote(noteId: string, nodes: Y.XmlElement[]) {
  const doc = await cache.acquire(noteId)
  doc.getXmlFragment('content').insert(0, nodes)
}

describe('Indexer', () => {
  it('debounces edits by 1000 ms', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const n = vault.createNote({ title: 'A' })
    stop = indexer.start()
    await writeNote(n.id, [para('b1', ['hello world'])])
    await vi.advanceTimersByTimeAsync(999)
    expect(await db.noteText.get(n.id)).toBeUndefined()
    await vi.advanceTimersByTimeAsync(1)
    await vi.advanceTimersByTimeAsync(50)
    const row = await db.noteText.get(n.id)
    expect(row).toMatchObject({ noteId: n.id, title: 'A', text: 'hello world' })
    expect(await db.blocks.get([n.id, 'b1'])).toMatchObject({ type: 'paragraph', text: 'hello world' })
  })

  it('updates noteText.title on rename', async () => {
    const n = vault.createNote({ title: 'A' })
    await writeNote(n.id, [para('b1', ['x'])])
    await indexer.indexNote(n.id)
    stop = indexer.start()
    vault.renameNote(n.id, 'B')
    await vi.waitFor(async () => expect((await db.noteText.get(n.id))?.title).toBe('B'))
  })

  it('stores links queryable by target and replaces rows on reindex', async () => {
    const a = vault.createNote({ title: 'A' })
    const b = vault.createNote({ title: 'B' })
    await writeNote(a.id, [para('b1', ['see ', noteLink(b.id, 'x9')]), para('b2', [noteLink(b.id)])])
    await indexer.indexNote(a.id)
    const rows = await db.links.where('targetNoteId').equals(b.id).toArray()
    expect(rows.map((r) => r.sourceNoteId)).toEqual([a.id, a.id])
    expect(await db.links.where('[targetNoteId+targetBlockId]').equals([b.id, 'x9']).count()).toBe(1)
    await indexer.indexNote(a.id)
    expect(await db.links.where('sourceNoteId').equals(a.id).count()).toBe(2)
  })

  it('keeps rows for trashed notes and removes them after purge', async () => {
    const n = vault.createNote({ title: 'A' })
    await writeNote(n.id, [para('b1', ['hi'])])
    await indexer.indexNote(n.id)
    stop = indexer.start()
    vault.trashNote(n.id)
    await new Promise((r) => setTimeout(r, 30))
    expect(await db.noteText.get(n.id)).toBeDefined()
    vault.purgeNote(n.id)
    await vi.waitFor(async () => expect(await db.noteText.get(n.id)).toBeUndefined())
    expect(await db.blocks.where('noteId').equals(n.id).count()).toBe(0)
  })

  it('rebuildAll restores corrupted derived rows from storage', async () => {
    const a = vault.createNote({ title: 'A' })
    const doc = new Y.Doc()
    doc.getXmlFragment('content').insert(0, [para('b1', ['real text ', noteLink('zzz')])])
    await storage.appendUpdate(a.id, Y.encodeStateAsUpdate(doc))
    await db.noteText.put({ noteId: a.id, title: 'junk', text: 'junk', updatedAt: 0 })
    await db.tags.put({ noteId: a.id, tag: 'bogus' })
    await indexer.rebuildAll()
    expect(await db.noteText.get(a.id)).toMatchObject({ title: 'A', text: 'real text ', updatedAt: a.updatedAt })
    expect(await db.tags.count()).toBe(0)
    expect(await db.links.count()).toBe(1)
  })

  it('referencedAttachmentIds includes trashed notes', async () => {
    const a = vault.createNote({ title: 'A' })
    const b = vault.createNote({ title: 'B' })
    for (const [n, att] of [[a, 'att1'], [b, 'att2']] as const) {
      const d = new Y.Doc()
      d.getXmlFragment('content').insert(0, [para('p', ['x', media(att)])])
      await storage.appendUpdate(n.id, Y.encodeStateAsUpdate(d))
    }
    vault.trashNote(b.id)
    expect(await indexer.referencedAttachmentIds()).toEqual(new Set(['att1', 'att2']))
  })

  it('creates a title-only row for untouched notes and follows renames', async () => {
    const n = vault.createNote({ title: 'Fresh' })
    stop = indexer.start()
    vault.touchNote(n.id)
    await vi.waitFor(async () => expect(await db.noteText.get(n.id)).toMatchObject({ title: 'Fresh', text: '' }))
    vault.renameNote(n.id, 'Renamed')
    await vi.waitFor(async () => expect((await db.noteText.get(n.id))?.title).toBe('Renamed'))
  })

  it('does not recreate rows when the note is purged during indexing', async () => {
    const n = vault.createNote({ title: 'A' })
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const slow = new Proxy(storage, {
      get: (t, k) =>
        k === 'loadDoc' ? async (id: string) => (await gate, t.loadDoc(id)) : (t as never)[k as never],
    }) as MemoryStorage
    const ix = new Indexer(db, vault, cache, slow)
    const p = ix.indexNote(n.id)
    vault.purgeNote(n.id)
    await ix.removeNote(n.id)
    release()
    await p
    expect(await db.noteText.get(n.id)).toBeUndefined()
    expect(await db.blocks.where('noteId').equals(n.id).count()).toBe(0)
  })
})
