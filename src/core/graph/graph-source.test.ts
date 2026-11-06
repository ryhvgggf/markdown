// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { MemoryStorage } from '@/adapters/storage/memory-storage'
import { createDb, type NotesDb } from '@/adapters/storage/db'
import { Vault } from '../vault/vault'
import { NoteDocCache } from '../note-doc/cache'
import { Indexer } from '../indexer/indexer'
import { loadGraphSource } from './graph-source'

const fakeChannel = () =>
  ({ postMessage() {}, close() {}, onmessage: null, addEventListener() {}, removeEventListener() {} }) as unknown as BroadcastChannel

function para(id: string, parts: Y.XmlElement[]) {
  const p = new Y.XmlElement('paragraph')
  p.setAttribute('id', id)
  p.insert(0, parts)
  return p
}
const math = (latex: string) => {
  const e = new Y.XmlElement('mathInline')
  e.setAttribute('latex', latex)
  return e
}
const link = (noteId: string) => {
  const e = new Y.XmlElement('noteLink')
  e.setAttribute('noteId', noteId)
  return e
}

let db: NotesDb
let vault: Vault
let cache: NoteDocCache
let indexer: Indexer

beforeEach(async () => {
  db = createDb('test-' + Math.random().toString(36).slice(2))
  const storage = new MemoryStorage()
  vault = await Vault.open(storage, 'v1', { channelFactory: fakeChannel })
  cache = new NoteDocCache(storage, { channelFactory: fakeChannel })
  indexer = new Indexer(db, vault, cache, storage)
})
afterEach(() => {
  vault.close()
  db.close()
})

async function write(noteId: string, nodes: Y.XmlElement[]) {
  const doc = await cache.acquire(noteId)
  doc.getXmlFragment('content').insert(0, nodes)
  await indexer.indexNote(noteId)
}

describe('loadGraphSource', () => {
  it('indexer stores formulas ([] when none)', async () => {
    const a = vault.createNote({ title: 'A' })
    const b = vault.createNote({ title: 'B' })
    await write(a.id, [para('p1', [math('1+1'), math('x')])])
    await write(b.id, [para('p1', [])])
    expect((await db.noteText.get(a.id))?.formulas).toEqual(['1+1', 'x'])
    expect((await db.noteText.get(b.id))?.formulas).toEqual([])
  })

  it('live notes with folders, titles and formulas; raw links; trashed notes left out', async () => {
    const f = vault.createFolder({ name: 'F', parentId: null })
    const a = vault.createNote({ title: 'A', folderId: f.id })
    const b = vault.createNote({ title: 'B' })
    const t = vault.createNote({ title: 'T' })
    await write(a.id, [para('p1', [math('1+1'), link(b.id), link(t.id)])])
    await write(b.id, [para('p1', [math('1+1')])])
    await write(t.id, [para('p1', [math('1+1')])])
    vault.trashNote(t.id)
    const src = await loadGraphSource(db, vault, indexer)
    expect(src.notes).toEqual([
      { id: a.id, title: 'A', folderId: f.id, formulas: ['1+1'] },
      { id: b.id, title: 'B', folderId: null, formulas: ['1+1'] },
    ])
    expect(src.links).toEqual([
      { source: a.id, target: b.id },
      { source: a.id, target: t.id },
    ])
  })

  it('re-extracts a row without formulas (written by an older version, or not indexed yet)', async () => {
    const a = vault.createNote({ title: 'A' })
    const n = vault.createNote({ title: 'New' })
    await write(a.id, [para('p1', [math('y')])])
    await db.noteText.update(a.id, { formulas: undefined })
    const doc = await cache.acquire(n.id)
    doc.getXmlFragment('content').insert(0, [para('p1', [math('z')])])
    const src = await loadGraphSource(db, vault, indexer)
    expect(src.notes.map((x) => x.formulas)).toEqual([['y'], ['z']])
    expect((await db.noteText.get(a.id))?.formulas).toEqual(['y'])
  })
})
