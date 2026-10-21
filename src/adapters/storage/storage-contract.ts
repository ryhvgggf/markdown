import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import type { StorageAdapter } from './types'

const bytes = (...n: number[]) => new Uint8Array(n)

/** A real Yjs update inserting `s` into text 't' of a fresh doc. */
function upd(s: string): Uint8Array {
  const d = new Y.Doc()
  d.getText('t').insert(0, s)
  return Y.encodeStateAsUpdate(d)
}

function contentOf(updates: Uint8Array[]): string {
  const d = new Y.Doc()
  for (const u of updates) Y.applyUpdate(d, u)
  return d.getText('t').toString()
}

const has = (content: string, ...parts: string[]) => parts.forEach((p) => expect(content).toContain(p))

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
      const u1 = upd('a')
      await s.appendUpdate('d', u1)
      await s.appendUpdate('d', upd('b'))
      await s.compact('d', u1)
      expect(await s.loadDoc('d')).toHaveLength(1)
      const u3 = upd('c')
      expect(await s.appendUpdate('d', u3)).toBe(1)
      expect(await s.loadDoc('d')).toHaveLength(2)
    })

    it('compact is lossless for updates the caller state does not contain', async () => {
      const s = await factory()
      const mine = new Y.Doc()
      mine.getText('t').insert(0, 'mine')
      await s.appendUpdate('d', Y.encodeStateAsUpdate(mine))
      // another tab persists an update this doc has not seen
      await s.appendUpdate('d', upd('other'))
      await s.compact('d', Y.encodeStateAsUpdate(mine))
      const loaded = await s.loadDoc('d')
      expect(loaded).toHaveLength(1)
      has(contentOf(loaded), 'mine', 'other')
      // a second compaction keeps the previous snapshot too
      await s.compact('d', upd('third'))
      has(contentOf(await s.loadDoc('d')), 'mine', 'other', 'third')
    })

    it('deleteDoc removes it from listDocs and loadDoc', async () => {
      const s = await factory()
      await s.appendUpdate('a', bytes(1))
      await s.appendUpdate('b', bytes(1))
      await s.compact('c', upd('c'))
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
