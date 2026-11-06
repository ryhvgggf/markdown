import { describe, expect, it } from 'vitest'
import type { Graph, GraphSource } from './graph-data'
import { buildFormulaGraph, buildNoteGraph } from './graph-data'
import { findNodes, folderColor, neighborIds, neighborList, shortFormula } from './graph-view'

const note = (id: string, title: string, formulas: string[] = [], folderId: string | null = null) => ({ id, title, folderId, formulas })
const src: GraphSource = {
  notes: [note('a', 'Alpha', ['x^2']), note('b', 'beta', ['x^2']), note('c', 'Gamma'), note('d', 'alphabet')],
  links: [
    { source: 'a', target: 'b' },
    { source: 'a', target: 'c' },
  ],
}

describe('neighborIds', () => {
  it('returns the node itself and its direct neighbours', () => {
    const g = buildNoteGraph(src)
    expect([...neighborIds(g, 'a')].sort()).toEqual(['a', 'b', 'c'])
    expect([...neighborIds(g, 'd')]).toEqual(['d'])
  })
})

describe('neighborList', () => {
  it('lists every node by label with its neighbours, both sorted by label', () => {
    const rows = neighborList(buildNoteGraph(src))
    expect(rows.map((r) => r.node.id)).toEqual(['a', 'd', 'b', 'c'].sort((x, y) => labelOf(x).localeCompare(labelOf(y))))
    const a = rows.find((r) => r.node.id === 'a')!
    expect(a.neighbors.map((n) => n.id)).toEqual(['b', 'c'])
    expect(rows.find((r) => r.node.id === 'd')!.neighbors).toEqual([])
  })
  it('in the formula view formula nodes list their notes', () => {
    const rows = neighborList(buildFormulaGraph(src))
    const f = rows.find((r) => r.node.kind === 'formula')!
    expect(f.neighbors.map((n) => n.id).sort()).toEqual(['a', 'b'])
  })
})
const labelOf = (id: string) => ({ a: 'Alpha', b: 'beta', c: 'Gamma', d: 'alphabet' })[id]!

describe('findNodes', () => {
  const g: Graph = buildNoteGraph(src)
  it('matches titles case-insensitively, prefix matches first', () => {
    expect(findNodes(g, 'alpha').map((n) => n.id)).toEqual(['a', 'd'])
    expect(findNodes(g, 'ET').map((n) => n.id)).toEqual(['d', 'b'])
  })
  it('blank query finds nothing; limit applies', () => {
    expect(findNodes(g, '  ')).toEqual([])
    expect(findNodes(g, 'a', 2)).toHaveLength(2)
  })
})

describe('shortFormula', () => {
  it('keeps short formulas and cuts long ones on one line', () => {
    expect(shortFormula('x^2')).toBe('x^2')
    expect(shortFormula('a\n  b')).toBe('a b')
    const cut = shortFormula('x'.repeat(100), 20)
    expect(cut).toHaveLength(20)
    expect(cut.endsWith('…')).toBe(true)
  })
})

describe('folderColor', () => {
  it('is stable per folder, differs between folders, and is grey for top level', () => {
    expect(folderColor('f1')).toBe(folderColor('f1'))
    expect(folderColor('f1')).not.toBe(folderColor('f2'))
    expect(folderColor(null)).toMatch(/^#|^hsl/)
    expect(folderColor(null)).not.toBe(folderColor('f1'))
  })
})
