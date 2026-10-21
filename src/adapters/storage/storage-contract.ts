import { describe, expect, it } from 'vitest'
import type { StorageAdapter } from './types'

const bytes = (...n: number[]) => new Uint8Array(n)

export function describeStorageContract(name: string, factory: () => Promise<StorageAdapter> | StorageAdapter) {
  describe(`${name} storage contract`, () => {
    it('loadDoc returns appended updates in order', async () => {
      const s = await factory()
      expect(await s.appendUpdate('d', bytes(1))).toBe(1)
      expect(await s.appendUpdate('d', bytes(2))).toBe(2)
      expect(await s.loadDoc('d')).toEqual([bytes(1), bytes(2)])
    })

    it('keeps documents separate', async () => {
      const s = await factory()
      await s.appendUpdate('a', bytes(1))
      await s.appendUpdate('b', bytes(2))
      expect(await s.loadDoc('a')).toEqual([bytes(1)])
    })

    it('compact leaves only the snapshot and resets the count', async () => {
      const s = await factory()
      await s.appendUpdate('d', bytes(1))
      await s.appendUpdate('d', bytes(2))
      await s.compact('d', bytes(9))
      expect(await s.loadDoc('d')).toEqual([bytes(9)])
      expect(await s.appendUpdate('d', bytes(3))).toBe(1)
      expect(await s.loadDoc('d')).toEqual([bytes(9), bytes(3)])
    })

    it('deleteDoc removes it from listDocs and loadDoc', async () => {
      const s = await factory()
      await s.appendUpdate('a', bytes(1))
      await s.appendUpdate('b', bytes(1))
      await s.compact('c', bytes(1))
      expect((await s.listDocs()).sort()).toEqual(['a', 'b', 'c'])
      await s.deleteDoc('a')
      await s.deleteDoc('c')
      expect(await s.listDocs()).toEqual(['b'])
      expect(await s.loadDoc('a')).toEqual([])
    })

    it('round-trips blobs and deletes them', async () => {
      const s = await factory()
      const blob = new Blob([new Uint8Array([1, 2, 3, 4, 5])], { type: 'image/png' })
      await s.putBlob('x', blob)
      const got = await s.getBlob('x')
      expect(got?.size).toBe(blob.size)
      await s.deleteBlob('x')
      expect(await s.getBlob('x')).toBeUndefined()
    })
  })
}
