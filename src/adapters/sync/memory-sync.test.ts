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
})
