import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createDb, type NotesDb } from '@/adapters/storage/db'
import { MemoryStorage } from '@/adapters/storage/memory-storage'
import { DIRTY_PREFIX } from '@/core/indexer/indexer'
import { NoteDocCache } from '@/core/note-doc/cache'
import { doc, p, h, b } from '@/core/markdown/pm-build'
import { stripIds } from '@/core/markdown/__fixtures__/strip-ids'
import { createDocIO, normalizeDoc } from './doc-io'

let storage: MemoryStorage
let db: NotesDb
let notes: NoteDocCache
beforeEach(() => {
  storage = new MemoryStorage()
  db = createDb('docio-' + Math.random().toString(36).slice(2))
  notes = new NoteDocCache(storage)
})
afterEach(() => db.close())

const A = doc(h(1, '標題'), p('一般', b('粗')))
const B = doc(p('新內容'))

describe('DocIO', () => {
  it('write stores a document the note cache opens, and marks it for indexing', async () => {
    const io = createDocIO({ storage, db, notes })
    await io.write('n1', A)
    await notes.acquire('n1')
    expect((await db.meta.get(DIRTY_PREFIX + 'n1'))?.value).toBe(1)
    expect(stripIds(await io.read('n1'))).toEqual(stripIds(normalizeDoc(A)))
  })

  it('a note with no stored content reads as one empty paragraph', async () => {
    expect(await createDocIO({ storage, db, notes }).read('never-written')).toEqual({ type: 'doc', content: [{ type: 'paragraph' }] })
  })

  it('refuses a document the editor cannot open', async () => {
    const io = createDocIO({ storage, db, notes })
    await expect(io.write('n1', { type: 'doc', content: [{ type: 'nope' }] })).rejects.toThrow()
    expect(await storage.loadDoc('n1')).toEqual([])
  })

  it('replace updates a note that is open, in place', async () => {
    const io = createDocIO({ storage, db, notes })
    await io.write('n1', A)
    const open = await notes.acquire('n1')
    await io.replace('n1', B)
    expect(open.getXmlFragment('content').toString()).toContain('新內容')
    expect(stripIds(await io.read('n1'))).toEqual(stripIds(normalizeDoc(B)))
    notes.release('n1')
  })
})
