import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
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
import { TreeItem, type RowApi } from './TreeItem'
import type { useActions } from './use-actions'

type Row = { node: TreeNode; level: number }

// Stable identity: new sensor options re-create dnd-kit's context, which re-renders every draggable row.
const POINTER_OPTIONS = { activationConstraint: { distance: 6 } }

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
  const sensors = useSensors(useSensor(PointerSensor, POINTER_OPTIONS))
  const [drop, setDrop] = useState<Target | null>(null)
  const [dragging, setDragging] = useState<Ref | null>(null)
  // Latest closures behind one stable object (rows are memoised and must not see a new prop per render).
  const byId = new Map(rows.map((r) => [nodeRef(r.node).id, r]))
  const latest = useRef<RowApi | null>(null)
  const fresh: RowApi = {
    menu: (id) => {
      const node = byId.get(id)?.node
      return {
        rename: () => setRenamingId(id),
        newNote: () => actions.createNote(id),
        newSubfolder: () => setRenamingId(actions.createFolder(id)),
        trash: () => node && actions.trash(node),
      }
    },
    activate: (id) => {
      const node = byId.get(id)?.node
      if (!node) return
      if (node.kind === 'folder') toggle(id)
      else actions.openNote(id)
    },
    expand: (id, open) => {
      if (open !== expanded.has(id)) toggle(id)
    },
    rename: (id, v) => {
      const node = byId.get(id)?.node
      return node ? actions.rename(nodeRef(node), v) : 'ok'
    },
    renameDone: () => setRenamingId(null),
  }
  useLayoutEffect(() => {
    latest.current = fresh
  })
  const api = useMemo<RowApi>(
    () => ({
      menu: (id) => {
        const m = () => latest.current!.menu(id)
        return { rename: () => m().rename(), newNote: () => m().newNote?.(), newSubfolder: () => m().newSubfolder?.(), trash: () => m().trash() }
      },
      activate: (id) => latest.current!.activate(id),
      expand: (id, open) => latest.current!.expand(id, open),
      rename: (id, v) => latest.current!.rename(id, v),
      renameDone: () => latest.current!.renameDone(),
    }),
    [],
  )
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

  const renderNodes = (nodes: TreeNode[], level: number): ReactNode =>
    nodes.map((node) => {
      const ref = nodeRef(node)
      const folderOpen = node.kind === 'folder' && expanded.has(node.folder.id)
      const item = (
        <TreeItem
          key={ref.id}
          node={node}
          level={level}
          expanded={folderOpen}
          current={node.kind === 'note' && node.note.id === openNoteId}
          tabbable={ref.id === tabbableId}
          drop={drop && drop.over !== ROOT && drop.over.id === ref.id ? drop.zone : null}
          renaming={renamingId === ref.id}
          api={api}
        />
      )
      if (node.kind !== 'folder' || node.children.length === 0) return item
      return (
        <Fragment key={ref.id}>
          {item}
          <FolderKids open={folderOpen}>{() => renderNodes(node.children, level + 1)}</FolderKids>
        </Fragment>
      )
    })

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
        {renderNodes(tree, 1)}
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

/** A folder's rows; expanding and collapsing animate the row height (grid-template-rows). */
function FolderKids({ open, children }: { open: boolean; children: () => ReactNode }) {
  const [mounted, setMounted] = useState(open)
  const [shown, setShown] = useState(open)
  if (open && !mounted) setMounted(true)
  if (!open && shown) setShown(false) // collapse from the open height; a reopen starts again from 0fr
  useEffect(() => {
    if (open) {
      const f = requestAnimationFrame(() => setShown(true)) // start from 0fr so the expansion animates
      return () => cancelAnimationFrame(f)
    }
    const ms = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--d3')) || 340
    const t = setTimeout(() => setMounted(false), ms + 40)
    return () => clearTimeout(t)
  }, [open])
  if (!mounted) return null
  const closing = !open
  return (
    <div role="group" className="tree-kids" data-open={shown && open ? 'true' : 'false'} aria-hidden={closing || undefined} inert={closing || undefined}>
      <div>{children()}</div>
    </div>
  )
}
