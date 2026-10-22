import { describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import { MemoryStorage } from '@/adapters/storage/memory-storage'
import { StorageError } from '@/adapters/storage/types'
import { NoteDocCache, NoteDocError } from './cache'

const mk = (max?: number) => {
  const storage = new MemoryStorage()
  return { storage, cache: new NoteDocCache(storage, { max, channelFactory: undefined }) }
}

describe('NoteDocCache', () => {
  it('returns the same doc for sequential and concurrent acquires', async () => {
    const { cache } = mk()
    const [a, b] = await Promise.all([cache.acquire('n1'), cache.acquire('n1')])
    expect(a).toBe(b)
    expect(await cache.acquire('n1')).toBe(a)
    expect(cache.peek('n1')).toBe(a)
  })

  it('initialises meta.schemaVersion and content fragment', async () => {
    const { cache } = mk()
    const d = await cache.acquire('n1')
    expect(d.getMap('meta').get('schemaVersion')).toBe(1)
    expect(d.getXmlFragment('content')).toBeInstanceOf(Y.XmlFragment)
  })

  it('persists and restores content', async () => {
    const { cache, storage } = mk()
    const d = await cache.acquire('n1')
    d.getMap('meta').set('x', 'hello')
    await new Promise((r) => setTimeout(r, 10))
    const c2 = new NoteDocCache(storage)
    expect((await c2.acquire('n1')).getMap('meta').get('x')).toBe('hello')
  })

  it('evicts least-recently-used unreferenced docs beyond max', async () => {
    const { cache } = mk(20)
    for (let i = 0; i < 20; i++) {
      await cache.acquire(`n${i}`)
      if (i !== 1) cache.release(`n${i}`)
    }
    await cache.acquire('n20')
    expect(cache.peek('n0')).toBeUndefined()
    expect(cache.peek('n1')).toBeDefined() // still referenced
    expect(cache.peek('n2')).toBeDefined()
    expect(cache.peek('n20')).toBeDefined()
  })

  it('throws corrupted without touching stored data', async () => {
    const { cache, storage } = mk()
    await storage.appendUpdate('bad', new Uint8Array([255, 255, 255, 255]))
    await expect(cache.acquire('bad')).rejects.toMatchObject({ code: 'corrupted' })
    await expect(cache.acquire('bad')).rejects.toBeInstanceOf(NoteDocError)
    expect(cache.peek('bad')).toBeUndefined()
    expect(await storage.loadDoc('bad')).toHaveLength(1)
  })

  it('onChange fires for local updates, not initial load; unsubscribe works', async () => {
    const { cache } = mk()
    const cb = vi.fn()
    const off = cache.onChange(cb)
    const d = await cache.acquire('n1')
    expect(cb).not.toHaveBeenCalled()
    d.getMap('meta').set('k', 1)
    expect(cb).toHaveBeenCalledWith('n1', d)
    off()
    d.getMap('meta').set('k', 2)
    expect(cb).toHaveBeenCalledTimes(1)
  })

  it('remove deletes stored data and drops the doc', async () => {
    const { cache, storage } = mk()
    const d = await cache.acquire('n1')
    d.getMap('meta').set('k', 1)
    await new Promise((r) => setTimeout(r, 10))
    await cache.remove('n1')
    expect(cache.peek('n1')).toBeUndefined()
    expect(await storage.loadDoc('n1')).toHaveLength(0)
  })

  describe('unsaved writes (I2, M3)', () => {
    function flaky() {
      const mem = new MemoryStorage()
      const state = { fail: false, gate: null as Promise<void> | null }
      const storage = new Proxy(mem, {
        get(t, k) {
          if (k === 'appendUpdate')
            return async (id: string, u: Uint8Array) => {
              if (state.gate) await state.gate
              if (state.fail) throw new StorageError('quota', 'full')
              return t.appendUpdate(id, u)
            }
          const v = (t as never)[k as never] as unknown
          return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(t) : v
        },
      }) as MemoryStorage
      return { mem, storage, state }
    }

    it('never evicts a doc whose updates are not stored yet', async () => {
      const { mem, storage, state } = flaky()
      const cache = new NoteDocCache(storage, { max: 1, onStorageError: () => {} })
      const d = await cache.acquire('a')
      state.fail = true
      d.getText('t').insert(0, 'unsaved')
      cache.release('a')
      await new Promise((r) => setTimeout(r, 10))
      await cache.acquire('b')
      expect(cache.peek('a')).toBe(d)
      expect(cache.hasUnsaved()).toBe(true)
      state.fail = false
      cache.retryAll()
      await cache.flushAll()
      expect(cache.hasUnsaved()).toBe(false)
      cache.release('b')
      await cache.acquire('c')
      expect(cache.peek('a')).toBeUndefined()
      const again = await new NoteDocCache(mem).acquire('a')
      expect(again.getText('t').toString()).toBe('unsaved')
    })

    it('remove waits for the in-flight write before deleting stored data', async () => {
      const { mem, storage, state } = flaky()
      const cache = new NoteDocCache(storage)
      const d = await cache.acquire('n1')
      let open!: () => void
      state.gate = new Promise<void>((r) => (open = r))
      d.getText('t').insert(0, 'late')
      await new Promise((r) => setTimeout(r, 0))
      const p = cache.remove('n1')
      setTimeout(() => {
        state.gate = null
        open()
      }, 10)
      await p
      await new Promise((r) => setTimeout(r, 10))
      expect(await mem.loadDoc('n1')).toHaveLength(0)
    })
  })

  it('remove drops the unload stash of the deleted doc; isInUse follows refs', async () => {
    const storage = new MemoryStorage()
    const cleared: string[] = []
    const cache = new NoteDocCache(storage, { clearStash: (id) => cleared.push(id) })
    await cache.acquire('n1')
    expect(cache.isInUse('n1')).toBe(true)
    cache.release('n1')
    expect(cache.isInUse('n1')).toBe(false)
    await cache.remove('n1')
    expect(cleared).toEqual(['n1'])
  })
})
