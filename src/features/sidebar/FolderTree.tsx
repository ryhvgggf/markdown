import { useMemo, useRef, useState } from 'react'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragMoveEvent,
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

// Prefer a row over the list background when the pointer is over both.
const collision: CollisionDetection = (args) => {
  const hits = pointerWithin(args)
  const rows = hits.filter((h) => h.id !== ROOT)
  return rows.length > 0 ? [rows[0]!] : hits
}

type Drop = { overId: string; zone: Zone }

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
  const [drop, setDrop] = useState<Drop | null>(null)
  const [dragging, setDragging] = useState<Ref | null>(null)
  const startY = useRef(0)
  const root = useDroppable({ id: ROOT })
  const tabbableId = rows.find((r) => r.node.kind === 'note' && r.node.note.id === openNoteId) ? openNoteId : rows[0] && nodeRef(rows[0].node).id

  const resolve = (e: DragMoveEvent | DragEndEvent): Drop | null => {
    const over = e.over
    if (!over) return null
    if (over.id === ROOT) return { overId: ROOT, zone: 'into' }
    const kind = (over.data.current as Ref | undefined)?.kind
    if (!kind) return null
    return { overId: String(over.id), zone: dropZone(kind, startY.current + e.delta.y, over.rect) }
  }

  const onDragEnd = (e: DragEndEvent) => {
    const target = resolve(e)
    setDrop(null)
    setDragging(null)
    const drag = e.active.data.current as Ref | undefined
    if (!target || !drag) return
    const over = target.overId === ROOT ? ROOT : (e.over?.data.current as Ref)
    const move = computeMove(tree, drag, over, target.zone)
    if (move) actions.move(drag, move)
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collision}
      onDragStart={(e) => {
        startY.current = (e.activatorEvent as PointerEvent).clientY
        setDragging(e.active.data.current as Ref)
      }}
      onDragMove={(e) => setDrop(resolve(e))}
      onDragEnd={onDragEnd}
      onDragCancel={() => (setDrop(null), setDragging(null))}
    >
      <div
        ref={(el) => root.setNodeRef(el)}
        role="tree"
        aria-label="筆記樹狀清單"
        className={`min-h-full px-2 pb-2 ${drop?.overId === ROOT ? 'bg-accent/5' : ''}`}
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
              drop={drop?.overId === ref.id ? drop.zone : null}
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
      <DragOverlay dropAnimation={null}>
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
