// @vitest-environment node
import Dexie from 'dexie'
import { describe, expect, it } from 'vitest'
import { createDb } from './db'
import { DexieStorage } from './dexie-storage'
import { MemoryStorage } from './memory-storage'
import { describeStorageContract } from './storage-contract'
import { StorageError } from './types'

let n = 0
const freshDexie = () => new DexieStorage(createDb(`test-${n++}-${Math.random()}`))

describeStorageContract('DexieStorage', freshDexie)
describeStorageContract('MemoryStorage', () => new MemoryStorage())

describe('DexieStorage legacy blob rows', () => {
  it('reads a legacy { id, blob } row as-is and stores new rows as bytes', async () => {
    const db = createDb(`test-legacy-${Math.random()}`)
    const s = new DexieStorage(db)
    const legacy = new Blob(['old'], { type: 'image/png' })
    await db.blobs.put({ id: 'legacy', blob: legacy })
    const got = await s.getBlob('legacy')
    expect(got?.size).toBe(3)
    await s.putBlob('new', new Blob(['hello'], { type: 'image/gif' }))
    const row = await db.blobs.get('new')
    expect(row?.data).toBeInstanceOf(ArrayBuffer)
    expect(row?.blob).toBeUndefined()
    const back = await s.getBlob('new')
    expect(back?.type).toBe('image/gif')
    expect(await back?.text()).toBe('hello')
    db.close()
  })
})

describe('DexieStorage errors', () => {
  it('uses the notes-v2 database by default', () => {
    const db = createDb()
    expect(db.name).toBe('notes-v2')
    expect(db.tables.map((t) => t.name).sort()).toEqual(
      ['attachmentRefs', 'blobs', 'blocks', 'links', 'meta', 'noteText', 'snapshots', 'tags', 'updates'],
    )
    db.close()
  })

  it('upgrades a version-1 database in place: stored data survives, attachmentRefs is added', async () => {
    const name = `test-upgrade-${Math.random()}`
    const old = new Dexie(name)
    old.version(1).stores({
      updates: '++seq, docId',
      snapshots: 'docId',
      blobs: 'id',
      noteText: 'noteId',
      links: '++id, sourceNoteId, targetNoteId, [targetNoteId+targetBlockId]',
      blocks: '[noteId+blockId], noteId',
      tags: '[noteId+tag], tag',
      meta: 'key',
    })
    await old.table('updates').add({ docId: 'n1', update: new Uint8Array([1, 2, 3]) })
    await old.table('meta').put({ key: 'indexVersion', value: 3 })
    old.close()
    const db = createDb(name)
    expect((await db.updates.toArray()).map((r) => r.docId)).toEqual(['n1'])
    expect((await db.meta.get('indexVersion'))?.value).toBe(3)
    await db.attachmentRefs.put({ noteId: 'n1', attachmentId: 'a1' })
    expect(await db.attachmentRefs.where('attachmentId').equals('a1').count()).toBe(1)
    db.close()
  })

  it('maps QuotaExceededError to StorageError kind quota', async () => {
    const db = createDb(`test-quota-${Math.random()}`)
    const s = new DexieStorage(db)
    db.updates.add = () => {
      throw new DOMException('full', 'QuotaExceededError')
    }
    const err = await s.appendUpdate('d', new Uint8Array([1])).catch((e) => e)
    expect(err).toBeInstanceOf(StorageError)
    expect(err.kind).toBe('quota')
  })
})
