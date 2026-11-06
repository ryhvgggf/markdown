import { describe, expect, it } from 'vitest'
import {
  buildFormulaGraph,
  buildNoteGraph,
  formulaNodeId,
  isFormulaNodeId,
  limitGraph,
  localGraph,
  notesUsingFormula,
  viewGraph,
  type GraphSource,
} from './graph-data'

const note = (id: string, formulas: string[] = [], folderId: string | null = null) => ({ id, title: id.toUpperCase(), folderId, formulas })
const ids = (g: { nodes: { id: string }[] }) => g.nodes.map((n) => n.id).sort()
const edges = (g: { edges: { source: string; target: string }[] }) => g.edges.map((e) => `${e.source}-${e.target}`).sort()

describe('buildNoteGraph', () => {
  it('one undirected edge per pair; drops self links and links to trashed or gone notes', () => {
    const src: GraphSource = {
      notes: [note('a', [], 'f1'), note('b'), note('c')],
      links: [
        { source: 'a', target: 'b' },
        { source: 'a', target: 'b' }, // a block link to b
        { source: 'b', target: 'a' },
        { source: 'a', target: 'a' },
        { source: 'a', target: 'trashed' },
        { source: 'gone', target: 'c' },
      ],
    }
    const g = buildNoteGraph(src)
    expect(edges(g)).toEqual(['a-b'])
    expect(g.nodes).toEqual([
      { id: 'a', kind: 'note', label: 'A', folderId: 'f1', degree: 1 },
      { id: 'b', kind: 'note', label: 'B', folderId: null, degree: 1 },
      { id: 'c', kind: 'note', label: 'C', folderId: null, degree: 0 },
    ])
  })
})

describe('buildFormulaGraph', () => {
  it('only formulas shared by 2+ notes, compared as written; notes using none are left out', () => {
    const src: GraphSource = {
      notes: [note('a', ['1+1', 'x']), note('b', ['1+1']), note('c', ['1 + 1', 'x']), note('d')],
      links: [{ source: 'a', target: 'd' }],
    }
    const g = buildFormulaGraph(src)
    expect(ids(g)).toEqual(['a', 'b', 'c', formulaNodeId('1+1'), formulaNodeId('x')].sort())
    expect(edges(g)).toEqual([`a-${formulaNodeId('1+1')}`, `a-${formulaNodeId('x')}`, `b-${formulaNodeId('1+1')}`, `c-${formulaNodeId('x')}`].sort())
    const f = g.nodes.find((n) => n.id === formulaNodeId('1+1'))!
    expect(f).toMatchObject({ kind: 'formula', label: '1+1', folderId: null, degree: 2 })
    expect(isFormulaNodeId(f.id)).toBe(true)
    expect(isFormulaNodeId('a')).toBe(false)
  })

  it('notesUsingFormula lists the notes with exactly that formula', () => {
    const src: GraphSource = { notes: [note('a', ['1+1']), note('b', ['1 + 1']), note('c', ['1+1'])], links: [] }
    expect(notesUsingFormula(src, '1+1').map((n) => n.id)).toEqual(['a', 'c'])
  })
})

describe('localGraph / limitGraph', () => {
  // a - b - c - d, and e alone
  const src: GraphSource = {
    notes: ['a', 'b', 'c', 'd', 'e'].map((i) => note(i)),
    links: [
      { source: 'a', target: 'b' },
      { source: 'b', target: 'c' },
      { source: 'c', target: 'd' },
    ],
  }
  const g = buildNoteGraph(src)

  it('keeps nodes within depth steps, with the edges among them', () => {
    expect(ids(localGraph(g, 'b', 1))).toEqual(['a', 'b', 'c'])
    expect(edges(localGraph(g, 'b', 1))).toEqual(['a-b', 'b-c'])
    expect(ids(localGraph(g, 'a', 2))).toEqual(['a', 'b', 'c'])
    expect(ids(localGraph(g, 'e', 1))).toEqual(['e'])
    expect(localGraph(g, 'missing', 1)).toEqual({ nodes: [], edges: [] })
  })

  it('limits to the best connected nodes, stable on ties, and records the original count', () => {
    const out = limitGraph(g, 2)
    expect(ids(out)).toEqual(['b', 'c'])
    expect(edges(out)).toEqual(['b-c'])
    expect(out.truncatedFrom).toBe(5)
    expect(limitGraph(g, 5)).toBe(g)
    expect(ids(limitGraph(g, 3))).toEqual(['a', 'b', 'c']) // a (1) beats d (1) by title
  })

  it('a pinned node is always kept', () => {
    expect(ids(limitGraph(g, 2, 'e'))).toEqual(['b', 'e'])
  })
})

describe('viewGraph', () => {
  const src: GraphSource = {
    notes: [note('a', ['1+1']), note('b', ['1+1', 'y']), note('c', ['y']), note('d')],
    links: [
      { source: 'a', target: 'd' },
      { source: 'b', target: 'c' },
    ],
  }

  it('local: around the open note (none open = empty); all: the whole vault', () => {
    expect(ids(viewGraph(src, { scope: 'local', centerId: 'a' }))).toEqual(['a', 'd'])
    expect(viewGraph(src, { scope: 'local', centerId: null }).nodes).toEqual([])
    expect(ids(viewGraph(src, { scope: 'all', centerId: 'a' }))).toEqual(['a', 'b', 'c', 'd'])
  })

  it('formula view: one step is note → formula → note', () => {
    expect(ids(viewGraph(src, { scope: 'local', centerId: 'a', formulas: true }))).toEqual(['a', 'b', formulaNodeId('1+1')].sort())
    expect(ids(viewGraph(src, { scope: 'local', centerId: 'a', depth: 2, formulas: true }))).toEqual(
      ['a', 'b', 'c', formulaNodeId('1+1'), formulaNodeId('y')].sort(),
    )
    expect(viewGraph(src, { scope: 'local', centerId: 'd', formulas: true }).nodes).toEqual([])
    expect(ids(viewGraph(src, { scope: 'all', centerId: null, formulas: true }))).toEqual(
      ['a', 'b', 'c', formulaNodeId('1+1'), formulaNodeId('y')].sort(),
    )
  })

  it('applies the limit and keeps the open note', () => {
    const g = viewGraph(src, { scope: 'all', centerId: null, limit: 2 })
    expect(g.nodes).toHaveLength(2)
    expect(g.truncatedFrom).toBe(4)
    expect(ids(viewGraph(src, { scope: 'local', centerId: 'a', limit: 1 }))).toEqual(['a'])
  })
})
