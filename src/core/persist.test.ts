import { describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import { MemoryStorage } from '@/adapters/storage/memory-storage'
import { StorageError, type StorageAdapter } from '@/adapters/storage/types'
import { bindPersistence, PERSIST_ORIGIN } from './persist'

const text = (d: Y.Doc) => d.getText('t').toString()

describe('bindPersistence', () => {
  it('restores content into a fresh doc', async () => {
    const storage = new MemoryStorage()
    const a = new Y.Doc()
    const pa = await bindPersistence(a, 'n1', storage)
    a.getText('t').insert(0, 'hello')
    a.getText('t').insert(5, ' world')
    pa.destroy()
    await pa.flush()
    const b = new Y.Doc()
    await bindPersistence(b, 'n1', storage)
    expect(text(b)).toBe('hello world')
  })

  it('compacts after 200 updates and survives 500 writes', async () => {
    const storage = new MemoryStorage()
    const a = new Y.Doc()
    const pa = await bindPersistence(a, 'n1', storage, { compactAfter: 200 })
    for (let i = 0; i < 500; i++) a.getText('t').insert(i, 'x')
    pa.destroy()
    await pa.flush()
    expect((await storage.loadDoc('n1')).length).toBeLessThan(200)
    const b = new Y.Doc()
    await bindPersistence(b, 'n1', storage)
    expect(text(b)).toBe('x'.repeat(500))
  })

  it('skips updates whose origin is ignored', async () => {
    const storage = new MemoryStorage()
    const a = new Y.Doc()
    const spy = vi.spyOn(storage, 'appendUpdate')
    const remote = Symbol('remote')
    const pa = await bindPersistence(a, 'n1', storage, { ignoreOrigins: [remote] })
    a.transact(() => a.getText('t').insert(0, 'r'), remote)
    await pa.flush()
    expect(spy).not.toHaveBeenCalled()
    a.getText('t').insert(1, 'l')
    await pa.flush()
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('does not write back updates applied while loading', async () => {
    const storage = new MemoryStorage()
    const a = new Y.Doc()
    const pa = await bindPersistence(a, 'n1', storage)
    a.getText('t').insert(0, 'abc')
    pa.destroy()
    await pa.flush()
    const spy = vi.spyOn(storage, 'appendUpdate')
    const b = new Y.Doc()
    await bindPersistence(b, 'n1', storage)
    expect(text(b)).toBe('abc')
    expect(spy).not.toHaveBeenCalled()
    expect(PERSIST_ORIGIN).toBeTypeOf('symbol')
  })

  it('reports failures and retries queued updates on the next success', async () => {
    const mem = new MemoryStorage()
    let fail = true
    const storage: StorageAdapter = {
      loadDoc: (id) => mem.loadDoc(id),
      appendUpdate: (id, u) =>
        fail ? Promise.reject(new StorageError('quota', 'full')) : mem.appendUpdate(id, u),
      compact: (id, s) => mem.compact(id, s),
      deleteDoc: (id) => mem.deleteDoc(id),
      listDocs: () => mem.listDocs(),
      putBlob: (id, b) => mem.putBlob(id, b),
      getBlob: (id) => mem.getBlob(id),
      deleteBlob: (id) => mem.deleteBlob(id),
    }
    const onError = vi.fn()
    const a = new Y.Doc()
    const pa = await bindPersistence(a, 'n1', storage, { onError })
    a.getText('t').insert(0, 'a')
    await vi.waitFor(() => expect(onError).toHaveBeenCalled())
    expect(onError.mock.calls[0][0].kind).toBe('quota')
    fail = false
    a.getText('t').insert(1, 'b')
    await vi.waitFor(async () => expect((await mem.loadDoc('n1')).length).toBeGreaterThan(0))
    pa.destroy()
    await pa.flush()
    const b = new Y.Doc()
    await bindPersistence(b, 'n1', mem)
    expect(text(b)).toBe('ab')
  })
})
