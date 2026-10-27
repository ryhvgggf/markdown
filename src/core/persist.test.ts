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

  it('writes edits in idle time, not in the edit\'s own task; flush() writes now', async () => {
    const storage = new MemoryStorage()
    const a = new Y.Doc()
    const spy = vi.spyOn(storage, 'appendUpdate')
    await bindPersistence(a, 'n1', storage)
    a.getText('t').insert(0, 'k')
    await Promise.resolve()
    await Promise.resolve()
    expect(spy).not.toHaveBeenCalled()
    await vi.waitFor(() => expect(spy).toHaveBeenCalledTimes(1))
    const b = new Y.Doc()
    const spyB = vi.spyOn(storage, 'appendUpdate')
    spyB.mockClear()
    const pb = await bindPersistence(b, 'n2', storage)
    b.getText('t').insert(0, 'now')
    await pb.flush()
    expect(spyB).toHaveBeenCalledTimes(1)
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

  it('reports failures and writes queued updates on retry', async () => {
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
    pa.retry() // (the backoff timer would also retry on its own)
    await vi.waitFor(async () => expect((await mem.loadDoc('n1')).length).toBeGreaterThan(0))
    pa.destroy()
    await pa.flush()
    const b = new Y.Doc()
    await bindPersistence(b, 'n1', mem)
    expect(text(b)).toBe('ab')
  })

  describe('write batching and retry (I2, M2)', () => {
    function gated() {
      const mem = new MemoryStorage()
      let fail = false
      let gate: Promise<void> | null = null
      const calls: Uint8Array[] = []
      const storage: StorageAdapter = {
        loadDoc: (id) => mem.loadDoc(id),
        appendUpdate: async (id, u) => {
          calls.push(u)
          if (gate) await gate
          if (fail) throw new StorageError('quota', 'full')
          return mem.appendUpdate(id, u)
        },
        compact: (id, st) => mem.compact(id, st),
        deleteDoc: (id) => mem.deleteDoc(id),
        listDocs: () => mem.listDocs(),
        putBlob: (id, b) => mem.putBlob(id, b),
        getBlob: (id) => mem.getBlob(id),
        deleteBlob: (id) => mem.deleteBlob(id),
      }
      return {
        mem,
        storage,
        calls,
        setFail: (f: boolean) => (fail = f),
        hold() {
          let open!: () => void
          gate = new Promise<void>((r) => (open = r))
          return () => {
            gate = null
            open()
          }
        },
      }
    }
    const restore = async (mem: MemoryStorage) => {
      const b = new Y.Doc()
      await bindPersistence(b, 'n1', mem)
      return text(b)
    }

    it('coalesces updates queued while a write is in flight into one transaction', async () => {
      const g = gated()
      const a = new Y.Doc()
      const pa = await bindPersistence(a, 'n1', g.storage)
      const open = g.hold()
      a.getText('t').insert(0, 'a')
      await new Promise((r) => setTimeout(r, 0)) // first write is now in flight
      for (const ch of 'bcdefghijklmnop') a.getText('t').insert(a.getText('t').length, ch)
      expect(pa.hasPending()).toBe(true)
      open()
      await pa.flush()
      expect(g.calls.length).toBe(2)
      expect(pa.hasPending()).toBe(false)
      expect(await restore(g.mem)).toBe('abcdefghijklmnop')
    })

    it('retries failed writes with backoff without waiting for a new edit', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      try {
        const g = gated()
        g.setFail(true)
        const onError = vi.fn()
        const a = new Y.Doc()
        const pa = await bindPersistence(a, 'n1', g.storage, { onError })
        a.getText('t').insert(0, 'kept')
        await vi.waitFor(() => expect(onError).toHaveBeenCalledTimes(1))
        expect(pa.hasPending()).toBe(true)
        await vi.advanceTimersByTimeAsync(2000)
        expect(onError).toHaveBeenCalledTimes(2) // retried once, failed again
        g.setFail(false)
        await vi.advanceTimersByTimeAsync(5000)
        await pa.flush()
        expect(pa.hasPending()).toBe(false)
        expect(await restore(g.mem)).toBe('kept')
      } finally {
        vi.useRealTimers()
      }
    })

    it('close waits for the in-flight write and stops writing', async () => {
      const g = gated()
      const a = new Y.Doc()
      const pa = await bindPersistence(a, 'n1', g.storage)
      const open = g.hold()
      a.getText('t').insert(0, 'x')
      await new Promise((r) => setTimeout(r, 0)) // write in flight
      let closed = false
      const p = pa.close().then(() => (closed = true))
      await new Promise((r) => setTimeout(r, 10))
      expect(closed).toBe(false)
      open()
      await p
      a.getText('t').insert(1, 'y')
      await new Promise((r) => setTimeout(r, 10))
      expect(g.calls.length).toBe(1)
    })
  })
})
