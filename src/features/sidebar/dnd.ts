import type { TreeNode } from '@/core/vault/tree'

export type Kind = 'note' | 'folder'
export type Ref = { kind: Kind; id: string }
export type Zone = 'before' | 'into' | 'after'
export type Move = { parentId: string | null; index: number }

export const ROOT = 'root'

export const nodeRef = (n: TreeNode): Ref =>
  n.kind === 'folder' ? { kind: 'folder', id: n.folder.id } : { kind: 'note', id: n.note.id }

/**
 * Where inside a row the pointer is. The tree sorts itself, so a drop never picks a position: a folder row is
 * always "into"; a note row only says "beside this note" (the item joins that note's folder).
 */
export function dropZone(kind: Kind, pointerY: number, rect: { top: number; height: number }): Zone {
  if (kind === 'folder') return 'into'
  const r = rect.height > 0 ? (pointerY - rect.top) / rect.height : 0.5
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

/**
 * Destination folder for a drop, or null when nothing changes. `index` only matters to the vault's stored
 * order, which the automatic sort ignores, so the item is simply appended.
 */
export function computeMove(tree: TreeNode[], drag: Ref, over: Ref | typeof ROOT, zone: Zone): Move | null {
  const from = locate(tree, null, drag)?.parentId
  let parentId: string | null
  if (over === ROOT) parentId = null
  else if (over.id === drag.id) return null
  else if (zone === 'into' && over.kind === 'folder') parentId = over.id
  else {
    const loc = locate(tree, null, over)
    if (!loc) return null
    parentId = loc.parentId
  }
  if (from === parentId) return null
  return { parentId, index: Number.MAX_SAFE_INTEGER }
}
