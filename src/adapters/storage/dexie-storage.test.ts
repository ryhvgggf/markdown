// @vitest-environment node
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
      ['blobs', 'blocks', 'links', 'meta', 'noteText', 'snapshots', 'tags', 'updates'],
    )
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
