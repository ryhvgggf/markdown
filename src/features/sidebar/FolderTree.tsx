import { useEffect, useMemo, useRef, useState } from 'react'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import { useUi } from '@/app/ui-store'
import type { TreeNode } from '@/core/vault/tree'
import { displayTitle } from '@/core/vault/titles'
import { computeMove, dropZone, nodeRef, ROOT, type Ref, type Zone } from './dnd'
import { TreeItem } from './TreeItem'
import type { useActions } from './use-actions'

type Row = { node: TreeNode; level: number }

function flatten(nodes: TreeNode[], expanded: ReadonlySet<string>, level = 1): Row[] {
  return nodes.flatMap((node): Row[] => [
    { node, level },
    ...(node.kind === 'folder' && expanded.has(node.folder.id) ? flatten(node.children, expanded, level + 1) : []),
  ])
}

type Target = { over: Ref | typeof ROOT; zone: Zone }

function targetAt(x: number, y: number): Target | null {
  const el = document.elementFromPoint(x, y)
  const row = el?.closest<HTMLElement>('[role="treeitem"]')
  if (row) {
    const over: Ref = { kind: row.dataset.kind as Ref['kind'], id: row.dataset.nodeId! }
    return { over, zone: dropZone(over.kind, y, row.getBoundingClientRect()) }
  }
  return el?.closest('[role="tree"]') ? { over: ROOT, zone: 'into' } : null
}

export interface FolderTreeProps {
  tree: TreeNode[]
  expanded: ReadonlySet<string>
  actions: ReturnType<typeof useActions>
  toggle(id: string): void
  renamingId: string | null
  setRenamingId(id: string | null): void
}

export function FolderTree({ tree, expanded, actions, toggle, renamingId, setRenamingId }: FolderTreeProps) {
  const openNoteId = useUi((s) => s.openNoteId)
  const rows = useMemo(() => flatten(tree, expanded), [tree, expanded])
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))
  const [drop, setDrop] = useState<Target | null>(null)
  const [dragging, setDragging] = useState<Ref | null>(null)
  const tabbableId = rows.find((r) => r.node.kind === 'note' && r.node.note.id === openNoteId) ? openNoteId : rows[0] && nodeRef(rows[0].node).id

  // The drop target is hit-tested from the real pointer position, tracked with native events. dnd-kit's own
  // `over` is computed after a React render and can lag the final pointermove when the browser is busy,
  // which made a quick release land on a row the pointer had only passed over.
  const final = useRef<Target | null>(null)
  useEffect(() => {
    if (!dragging) return
    const track = (e: PointerEvent) => {
      final.current = targetAt(e.clientX, e.clientY)
      if (e.type === 'pointermove') setDrop(final.current)
    }
    window.addEventListener('pointermove', track, true)
    window.addEventListener('pointerup', track, true)
    return () => {
      window.removeEventListener('pointermove', track, true)
      window.removeEventListener('pointerup', track, true)
    }
  }, [dragging])

  const onDragEnd = (e: DragEndEvent) => {
    const t = final.current
    final.current = null
    setDrop(null)
    setDragging(null)
    const drag = e.active.data.current as Ref | undefined
    if (!t || !drag) return
    const move = computeMove(tree, drag, t.over, t.zone)
    if (move) actions.move(drag, move)
  }

  return (
    <DndContext
      sensors={sensors}
      onDragStart={(e) => setDragging(e.active.data.current as Ref)}
      onDragEnd={onDragEnd}
      onDragCancel={() => ((final.current = null), setDrop(null), setDragging(null))}
    >
      <div
        role="tree"
        aria-label="筆記樹狀清單"
        className={`min-h-full px-2 pb-2 ${drop?.over === ROOT ? 'bg-accent/5' : ''}`}
      >
        {rows.map(({ node, level }) => {
          const ref = nodeRef(node)
          const folderOpen = node.kind === 'folder' && expanded.has(node.folder.id)
          return (
            <TreeItem
              key={ref.id}
              node={node}
              level={level}
              expanded={folderOpen}
              current={node.kind === 'note' && node.note.id === openNoteId}
              tabbable={ref.id === tabbableId}
              drop={drop && drop.over !== ROOT && drop.over.id === ref.id ? drop.zone : null}
              renaming={renamingId === ref.id}
              menu={{
                rename: () => setRenamingId(ref.id),
                newNote: () => actions.createNote(ref.id),
                newSubfolder: () => setRenamingId(actions.createFolder(ref.id)),
                trash: () => actions.trash(node),
              }}
              onActivate={() => (node.kind === 'folder' ? toggle(ref.id) : actions.openNote(ref.id))}
              onExpand={(open) => open !== folderOpen && toggle(ref.id)}
              onRename={(v) => actions.rename(ref, v)}
              onRenameDone={() => setRenamingId(null)}
            />
          )
        })}
      </div>
      <DragOverlay dropAnimation={null} style={{ pointerEvents: 'none' }}>
        {dragging && (
          <div className="glass-float w-max max-w-56 truncate px-3 py-1 text-[13.5px] text-fg">
            {labelOf(tree, dragging)}
          </div>
        )}
      </DragOverlay>
    </DndContext>
  )
}

function labelOf(nodes: TreeNode[], ref: Ref): string {
  for (const n of nodes) {
    if (n.kind === 'note' && n.note.id === ref.id) return displayTitle(n.note.title)
    if (n.kind === 'folder') {
      if (n.folder.id === ref.id) return n.folder.name
      const hit = labelOf(n.children, ref)
      if (hit) return hit
    }
  }
  return ''
}
