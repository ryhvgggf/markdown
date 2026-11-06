/**
 * Knowledge graph data (phase 5): pure functions over what the index already holds.
 * Notes are linked when either links to the other (any number of note or block links count as one edge,
 * no direction). The formula view links notes to the formulas they share (2+ notes, compared as written).
 */

export interface GraphSourceNote {
  id: string
  title: string
  folderId: string | null
  formulas: string[]
}
/** Every live (not trashed) note, plus raw link rows (source → target note; may point at trashed or gone notes). */
export interface GraphSource {
  notes: GraphSourceNote[]
  links: { source: string; target: string }[]
}

export type GraphNodeKind = 'note' | 'formula'
export interface GraphNode {
  id: string
  kind: GraphNodeKind
  /** Note title, or the formula as written. */
  label: string
  /** Notes only (null = top level); formulas are always null. */
  folderId: string | null
  /** Number of edges in the whole (untrimmed) graph of this view. */
  degree: number
}
export interface GraphEdge {
  source: string
  target: string
}
export interface Graph {
  nodes: GraphNode[]
  edges: GraphEdge[]
  /** Set when `limitGraph` dropped nodes: how many there were before. */
  truncatedFrom?: number
}

export const LOCAL_DEPTH_DEFAULT = 1
export const FULL_GRAPH_LIMIT = 300
/** Note ids are nanoids (no ':'), so this prefix never collides with one. */
const FORMULA_PREFIX = 'formula:'
export const formulaNodeId = (latex: string) => FORMULA_PREFIX + latex
export const isFormulaNodeId = (id: string) => id.startsWith(FORMULA_PREFIX)

const pairKey = (a: string, b: string) => (a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`)

function withDegrees(nodes: Omit<GraphNode, 'degree'>[], edges: GraphEdge[]): Graph {
  const deg = new Map<string, number>()
  for (const e of edges) {
    deg.set(e.source, (deg.get(e.source) ?? 0) + 1)
    deg.set(e.target, (deg.get(e.target) ?? 0) + 1)
  }
  return { nodes: nodes.map((n) => ({ ...n, degree: deg.get(n.id) ?? 0 })), edges }
}

/** All live notes; one undirected edge per linked pair; self links and links to trashed or gone notes are dropped. */
export function buildNoteGraph(src: GraphSource): Graph {
  const live = new Set(src.notes.map((n) => n.id))
  const seen = new Set<string>()
  const edges: GraphEdge[] = []
  for (const { source, target } of src.links) {
    if (source === target || !live.has(source) || !live.has(target)) continue
    const k = pairKey(source, target)
    if (seen.has(k)) continue
    seen.add(k)
    edges.push(source < target ? { source, target } : { source: target, target: source })
  }
  const nodes = src.notes.map((n) => ({ id: n.id, kind: 'note' as const, label: n.title, folderId: n.folderId }))
  return withDegrees(nodes, edges)
}

/** Formulas used by 2+ live notes, and those notes; an edge joins a note to each shared formula it uses. */
export function buildFormulaGraph(src: GraphSource): Graph {
  const users = new Map<string, string[]>()
  for (const n of src.notes) {
    for (const f of new Set(n.formulas)) {
      const list = users.get(f)
      if (list) list.push(n.id)
      else users.set(f, [n.id])
    }
  }
  const byId = new Map(src.notes.map((n) => [n.id, n]))
  const nodes: Omit<GraphNode, 'degree'>[] = []
  const edges: GraphEdge[] = []
  const inGraph = new Set<string>()
  for (const [latex, ids] of users) {
    if (ids.length < 2) continue
    const fid = formulaNodeId(latex)
    nodes.push({ id: fid, kind: 'formula', label: latex, folderId: null })
    for (const id of ids) {
      edges.push({ source: id, target: fid })
      if (!inGraph.has(id)) {
        inGraph.add(id)
        const n = byId.get(id)!
        nodes.push({ id, kind: 'note', label: n.title, folderId: n.folderId })
      }
    }
  }
  return withDegrees(nodes, edges)
}

/** Nodes within `depth` steps of `centerId` (and the edges among them); empty when the center is not in the graph. */
export function localGraph(g: Graph, centerId: string, depth: number): Graph {
  if (!g.nodes.some((n) => n.id === centerId)) return { nodes: [], edges: [] }
  const adj = new Map<string, string[]>()
  for (const e of g.edges) {
    ;(adj.get(e.source) ?? adj.set(e.source, []).get(e.source)!).push(e.target)
    ;(adj.get(e.target) ?? adj.set(e.target, []).get(e.target)!).push(e.source)
  }
  const keep = new Set([centerId])
  let frontier = [centerId]
  for (let d = 0; d < depth && frontier.length; d++) {
    const next: string[] = []
    for (const id of frontier)
      for (const m of adj.get(id) ?? [])
        if (!keep.has(m)) {
          keep.add(m)
          next.push(m)
        }
    frontier = next
  }
  return subgraph(g, keep)
}

/**
 * At most `max` nodes: the best connected ones (ties: title, then id, so the choice is stable).
 * `pinId` (the open note) is always kept. Degrees stay those of the whole graph; `truncatedFrom` records the original count.
 */
export function limitGraph(g: Graph, max: number, pinId?: string): Graph {
  if (g.nodes.length <= max) return g
  const ranked = [...g.nodes].sort(
    (a, b) => Number(b.id === pinId) - Number(a.id === pinId) || b.degree - a.degree || a.label.localeCompare(b.label) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  )
  const out = subgraph(g, new Set(ranked.slice(0, max).map((n) => n.id)))
  return { ...out, truncatedFrom: g.nodes.length }
}

function subgraph(g: Graph, keep: Set<string>): Graph {
  return {
    nodes: g.nodes.filter((n) => keep.has(n.id)),
    edges: g.edges.filter((e) => keep.has(e.source) && keep.has(e.target)),
  }
}

export interface GraphQuery {
  /** Whole vault, or around the open note. */
  scope: 'local' | 'all'
  /** The open note (local scope); null = none open, which gives an empty local graph. */
  centerId: string | null
  /** Local scope: steps from the open note. In the formula view one step is note → formula → note. */
  depth?: number
  formulas?: boolean
  limit?: number
}

/** The graph the view shows for these settings. */
export function viewGraph(src: GraphSource, q: GraphQuery): Graph {
  const g = q.formulas ? buildFormulaGraph(src) : buildNoteGraph(src)
  if (q.scope === 'local') {
    if (!q.centerId) return { nodes: [], edges: [] }
    const depth = q.depth ?? LOCAL_DEPTH_DEFAULT
    return limitGraph(localGraph(g, q.centerId, q.formulas ? depth * 2 : depth), q.limit ?? FULL_GRAPH_LIMIT, q.centerId)
  }
  return limitGraph(g, q.limit ?? FULL_GRAPH_LIMIT)
}

/** Live notes using this formula (exact match), in source order. */
export function notesUsingFormula(src: GraphSource, latex: string): GraphSourceNote[] {
  return src.notes.filter((n) => n.formulas.includes(latex))
}
