import { beforeEach, describe, expect, it } from 'vitest'
import { MemorySync } from './memory-sync'

const b = (s: string) => new TextEncoder().encode(s)

let sync: MemorySync
beforeEach(() => {
  sync = new MemorySync()
})

describe('MemorySync', () => {
  it('pulls pushed updates in order', async () => {
    await sync.pushUpdate('v1', 'n1', b('a'), 'dev1')
    await sync.pushUpdate('v1', 'n1', b('b'), 'dev1')
    const pulled = await sync.pullDoc('v1', 'n1')
    expect(pulled.map((u) => new TextDecoder().decode(u))).toEqual(['a', 'b'])
  })

  it('assigns increasing seq numbers', async () => {
    const seq1 = await sync.pushUpdate('v1', 'n1', b('a'), 'dev1')
    const seq2 = await sync.pushUpdate('v1', 'n1', b('b'), 'dev1')
    expect(seq2).toBe(seq1 + 1)
  })

  it('keeps docs in different vaults separate even with the same docId', async () => {
    await sync.pushUpdate('v1', 'n1', b('a'), 'dev1')
    await sync.pushUpdate('v2', 'n1', b('z'), 'dev1')
    expect((await sync.pullDoc('v1', 'n1')).map((u) => new TextDecoder().decode(u))).toEqual(['a'])
    expect((await sync.pullDoc('v2', 'n1')).map((u) => new TextDecoder().decode(u))).toEqual(['z'])
  })

  it('pushSnapshot replaces prior updates up to upToSeq and pullDoc returns snapshot then later updates', async () => {
    await sync.pushUpdate('v1', 'n1', b('a'), 'dev1')
    const seq2 = await sync.pushUpdate('v1', 'n1', b('b'), 'dev1')
    await sync.pushSnapshot('v1', 'n1', b('ab-snapshot'), seq2)
    await sync.pushUpdate('v1', 'n1', b('c'), 'dev1')
    const pulled = await sync.pullDoc('v1', 'n1')
    expect(pulled.map((u) => new TextDecoder().decode(u))).toEqual(['ab-snapshot', 'c'])
  })

  it('deleteDoc removes both snapshot and updates (design doc §3.1: turning off sync for a note)', async () => {
    await sync.pushUpdate('v1', 'n1', b('a'), 'dev1')
    await sync.pushSnapshot('v1', 'n1', b('snap'), 1)
    await sync.deleteDoc('v1', 'n1')
    expect(await sync.pullDoc('v1', 'n1')).toEqual([])
    expect(await sync.listDocs('v1')).toEqual([])
  })

  it('listDocs returns only docs with content, scoped to the vault', async () => {
    await sync.pushUpdate('v1', 'n1', b('a'), 'dev1')
    await sync.pushUpdate('v1', 'n2', b('b'), 'dev1')
    await sync.pushUpdate('v2', 'n3', b('c'), 'dev1')
    expect(new Set(await sync.listDocs('v1'))).toEqual(new Set(['n1', 'n2']))
  })

  describe('subscribe', () => {
    it('notifies on pushUpdate with the docId and deviceId', async () => {
      const seen: Array<{ docId: string; deviceId: string }> = []
      sync.subscribe('v1', (c) => seen.push(c))
      await sync.pushUpdate('v1', 'n1', b('a'), 'dev1')
      expect(seen).toEqual([{ docId: 'n1', deviceId: 'dev1' }])
    })

    it('notifies on pushSnapshot with an empty deviceId', async () => {
      const seen: Array<{ docId: string; deviceId: string }> = []
      sync.subscribe('v1', (c) => seen.push(c))
      await sync.pushSnapshot('v1', 'n1', b('snap'), 0)
      expect(seen).toEqual([{ docId: 'n1', deviceId: '' }])
    })

    it('only notifies subscribers of the same vault', async () => {
      const seen: string[] = []
      sync.subscribe('v1', (c) => seen.push(c.docId))
      await sync.pushUpdate('v2', 'n1', b('a'), 'dev1')
      expect(seen).toEqual([])
    })

    it('the returned unsubscribe function stops further notifications', async () => {
      const seen: string[] = []
      const unsubscribe = sync.subscribe('v1', (c) => seen.push(c.docId))
      await sync.pushUpdate('v1', 'n1', b('a'), 'dev1')
      unsubscribe()
      await sync.pushUpdate('v1', 'n2', b('b'), 'dev1')
      expect(seen).toEqual(['n1'])
    })

    it('supports several subscribers on the same vault', async () => {
      const a: string[] = []
      const b2: string[] = []
      sync.subscribe('v1', (c) => a.push(c.docId))
      sync.subscribe('v1', (c) => b2.push(c.docId))
      await sync.pushUpdate('v1', 'n1', b('a'), 'dev1')
      expect(a).toEqual(['n1'])
      expect(b2).toEqual(['n1'])
    })
  })
})
