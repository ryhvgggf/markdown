import type { Graph, GraphNode } from './graph-data'

/** Pure helpers for the graph view (hover highlight, the text list, title search, colours). */

const byLabel = (a: GraphNode, b: GraphNode) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id)

function adjacency(g: Graph): Map<string, Set<string>> {
  const m = new Map<string, Set<string>>()
  for (const n of g.nodes) m.set(n.id, new Set())
  for (const e of g.edges) {
    m.get(e.source)?.add(e.target)
    m.get(e.target)?.add(e.source)
  }
  return m
}

/** The node and its direct neighbours (what stays bright while hovering it). */
export function neighborIds(g: Graph, id: string): Set<string> {
  const out = new Set<string>([id])
  for (const e of g.edges) {
    if (e.source === id) out.add(e.target)
    else if (e.target === id) out.add(e.source)
  }
  return out
}

export interface NeighborRow {
  node: GraphNode
  neighbors: GraphNode[]
}

/** Every node with the nodes it is linked to, both sorted by label (the keyboard / touch list). */
export function neighborList(g: Graph): NeighborRow[] {
  const adj = adjacency(g)
  const byId = new Map(g.nodes.map((n) => [n.id, n]))
  return [...g.nodes].sort(byLabel).map((node) => ({
    node,
    neighbors: [...(adj.get(node.id) ?? [])].map((id) => byId.get(id)).filter((n): n is GraphNode => !!n).sort(byLabel),
  }))
}

/** Nodes whose label contains the query (case-insensitive); labels starting with it come first. */
export function findNodes(g: Graph, query: string, limit = 8): GraphNode[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const hits = g.nodes.filter((n) => n.label.toLowerCase().includes(q))
  const starts = (n: GraphNode) => (n.label.toLowerCase().startsWith(q) ? 0 : 1)
  return hits.sort((a, b) => starts(a) - starts(b) || byLabel(a, b)).slice(0, limit)
}

/** A formula on one line, cut to `max` characters (hover label). */
export function shortFormula(latex: string, max = 40): string {
  const one = latex.replace(/\s+/g, ' ').trim()
  return one.length <= max ? one : one.slice(0, max - 1) + '…'
}

/** Stable colour per folder; notes at the top level are grey. */
export function folderColor(folderId: string | null): string {
  if (!folderId) return '#8e8e93'
  let h = 0
  for (let i = 0; i < folderId.length; i++) h = (h * 31 + folderId.charCodeAt(i)) >>> 0
  return `hsl(${h % 360} 55% 50%)`
}
