import type { TreeNode } from '@/core/vault/tree'

export type Kind = 'note' | 'folder'
export type Ref = { kind: Kind; id: string }
export type Zone = 'before' | 'into' | 'after'
export type Move = { parentId: string | null; index: number }

export const ROOT = 'root'

export const nodeRef = (n: TreeNode): Ref =>
  n.kind === 'folder' ? { kind: 'folder', id: n.folder.id } : { kind: 'note', id: n.note.id }

/** Where inside a row the pointer is: folders have a middle "into" band, notes split in halves. */
export function dropZone(kind: Kind, pointerY: number, rect: { top: number; height: number }): Zone {
  const r = rect.height > 0 ? (pointerY - rect.top) / rect.height : 0.5
  if (kind === 'folder') return r < 0.25 ? 'before' : r > 0.75 ? 'after' : 'into'
  return r < 0.5 ? 'before' : 'after'
}

function locate(nodes: TreeNode[], parentId: string | null, ref: Ref): { parentId: string | null; siblings: TreeNode[] } | null {
  for (const n of nodes) {
    if (nodeRef(n).id === ref.id) return { parentId, siblings: nodes }
    if (n.kind === 'folder') {
      const hit = locate(n.children, n.folder.id, ref)
      if (hit) return hit
    }
  }
  return null
}

const sameKind = (nodes: TreeNode[], drag: Ref) => nodes.filter((n) => n.kind === drag.kind && nodeRef(n).id !== drag.id)

/** Destination parent and index (among same-kind siblings, dragged item excluded) for a drop. */
export function computeMove(tree: TreeNode[], drag: Ref, over: Ref | typeof ROOT, zone: Zone): Move | null {
  if (over === ROOT) return { parentId: null, index: sameKind(tree, drag).length }
  if (over.id === drag.id) return null
  if (zone === 'into' && over.kind === 'folder') {
    const folder = locate(tree, null, over)?.siblings.find((n) => nodeRef(n).id === over.id)
    if (folder?.kind !== 'folder') return null
    return { parentId: over.id, index: sameKind(folder.children, drag).length }
  }
  const loc = locate(tree, null, over)
  if (!loc) return null
  const sibs = sameKind(loc.siblings, drag)
  if (over.kind !== drag.kind) return { parentId: loc.parentId, index: drag.kind === 'note' ? 0 : sibs.length }
  const at = sibs.findIndex((n) => nodeRef(n).id === over.id)
  return { parentId: loc.parentId, index: at + (zone === 'after' ? 1 : 0) }
}
