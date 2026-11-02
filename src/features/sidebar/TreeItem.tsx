import { memo, useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { useDraggable } from '@dnd-kit/core'
import type { TreeNode } from '@/core/vault/tree'
import { displayTitle } from '@/core/vault/titles'
import { isComposingEvent } from '@/features/editor/ime'
import { ChevronRight, Cloud } from '@/ui/icons'
import { nodeRef, type Zone } from './dnd'
import { RowMenu, type RowMenuActions } from './RowMenu'
import type { RenameResult } from './use-actions'

export const INDENT = 20

/** Row callbacks keyed by row id; one stable object for the whole tree, so rows can be memoised. */
export interface RowApi {
  menu(id: string): RowMenuActions
  activate(id: string): void
  expand(id: string, open: boolean): void
  rename(id: string, value: string): RenameResult
  renameDone(): void
}

export interface TreeItemProps {
  node: TreeNode
  level: number
  expanded: boolean
  current: boolean
  tabbable: boolean
  drop: Zone | null
  renaming: boolean
  /** Signed in, so notes can be synced (shows the cloud mark). */
  syncable: boolean
  /** 同步到雲端 selection: note rows show a checkbox and a click ticks it. */
  selecting: boolean
  /** The checkbox, while selecting. */
  checked: boolean
  api: RowApi
}

/** Test hook: counts row renders. */
export const rowRenders = { count: 0 }

const label = (n: TreeNode) => (n.kind === 'folder' ? n.folder.name || '未命名資料夾' : displayTitle(n.note.title))

const synced = (n: TreeNode) => (n.kind === 'note' && n.note.synced) || (n.kind === 'folder' && n.folder.synced === true)

// A row shows only its own name; a new tree snapshot (e.g. one note's updatedAt) must not re-render every row.
const same = (a: TreeItemProps, b: TreeItemProps) =>
  a.level === b.level &&
  a.expanded === b.expanded &&
  a.current === b.current &&
  a.tabbable === b.tabbable &&
  a.drop === b.drop &&
  a.renaming === b.renaming &&
  a.syncable === b.syncable &&
  a.selecting === b.selecting &&
  a.checked === b.checked &&
  synced(a.node) === synced(b.node) &&
  a.api === b.api &&
  a.node.kind === b.node.kind &&
  nodeRef(a.node).id === nodeRef(b.node).id &&
  label(a.node) === label(b.node)

export const TreeItem = memo(TreeItemRow, same)

/** Which menu items a row shows: notes have no 重新命名 (the title is the name); 同步到雲端 needs sign-in. */
function rowMenu(m: RowMenuActions, isNote: boolean, syncable: boolean, folderSynced: boolean): RowMenuActions {
  return {
    ...m,
    rename: isNote ? undefined : m.rename,
    syncSelect: isNote && syncable ? m.syncSelect : undefined,
    syncFolder: !isNote && syncable ? m.syncFolder : undefined,
    folderSynced,
  }
}

function TreeItemRow(props: TreeItemProps) {
  useEffect(() => {
    rowRenders.count++ // after every render
  })
  const { api } = props
  const ref = nodeRef(props.node)
  const isNote = props.node.kind === 'note'
  const cloudMark = props.syncable && synced(props.node) && !props.selecting
  const p = {
    ...props,
    menu: rowMenu(api.menu(ref.id), isNote, props.syncable, props.node.kind === 'folder' && props.node.folder.synced === true),
    onActivate: () => api.activate(ref.id),
    onExpand: (open: boolean) => api.expand(ref.id, open),
    onRename: (v: string) => api.rename(ref.id, v),
    onRenameDone: () => api.renameDone(),
  }
  const name = label(p.node)
  const [menuOpen, setMenuOpen] = useState(false)
  const drag = useDraggable({ id: ref.id, data: ref, disabled: p.renaming || p.selecting })

  // React events bubble out of the menu portal into this row; ignore those.
  const inside = (e: { currentTarget: Element; target: EventTarget }) => e.currentTarget.contains(e.target as Node)

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return
    const isFolder = p.node.kind === 'folder'
    if (e.key === 'Enter' || e.key === ' ') p.onActivate()
    else if (e.key === 'F2') p.menu.rename?.()
    else if (e.key === 'ArrowRight' && isFolder) p.onExpand(true)
    else if (e.key === 'ArrowLeft' && isFolder) p.onExpand(false)
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const items = [...(e.currentTarget.closest('[role="tree"]')?.querySelectorAll<HTMLElement>('[role="treeitem"]') ?? [])]
      items[items.indexOf(e.currentTarget) + (e.key === 'ArrowDown' ? 1 : -1)]?.focus()
    } else return
    e.preventDefault()
  }

  const tone = p.current
    ? 'bg-white font-medium text-accent shadow-[0_1px_2px_rgba(0,0,0,0.1)]'
    : 'text-fg hover:bg-fill'
  return (
    <div
      ref={(el) => drag.setNodeRef(el)}
      data-node-id={ref.id}
      data-kind={ref.kind}
      role="treeitem"
      aria-label={name}
      aria-level={p.level}
      aria-expanded={p.node.kind === 'folder' ? p.expanded : undefined}
      aria-current={p.current ? 'page' : undefined}
      tabIndex={p.tabbable ? 0 : -1}
      data-drop={p.drop === 'into' ? 'into' : undefined}
      className={`group relative flex h-[30px] cursor-default items-center gap-1 rounded-[8px] pr-1 text-[13.5px] outline-none select-none focus-visible:ring-2 focus-visible:ring-accent ${tone} ${
        p.drop === 'into' ? 'bg-accent/15 ring-2 ring-accent/40' : ''
      } ${drag.isDragging ? 'opacity-40' : ''}`}
      style={{ paddingLeft: 8 + (p.level - 1) * INDENT }}
      onClick={(e) => inside(e) && p.onActivate()}
      onContextMenu={(e) => {
        if (!inside(e)) return
        e.preventDefault()
        if (!p.selecting) setMenuOpen(true)
      }}
      onKeyDown={onKeyDown}
      onPointerDown={(e) => inside(e) && !p.renaming && drag.listeners?.onPointerDown?.(e)}
    >
      {p.drop === 'before' && <span className="pointer-events-none absolute inset-x-2 -top-px h-0.5 rounded bg-accent" />}
      {p.drop === 'after' && <span className="pointer-events-none absolute inset-x-2 -bottom-px h-0.5 rounded bg-accent" />}
      <span className="grid size-4 shrink-0 place-items-center text-fg-tertiary">
        {p.node.kind === 'folder' && (
          <ChevronRight
            size={14}
            style={{ transform: p.expanded ? 'rotate(90deg)' : 'none', transition: 'transform 160ms var(--ease-spring)' }}
          />
        )}
      </span>
      {p.selecting && isNote && (
        <span
          role="checkbox"
          aria-checked={p.checked}
          aria-label={name}
          className={`grid size-4 shrink-0 place-items-center rounded-[4px] text-[11px] leading-none text-white ${
            p.checked ? 'bg-accent' : 'shadow-[inset_0_0_0_1.5px_rgba(0,0,0,0.25)]'
          }`}
        >
          {p.checked ? '✓' : ''}
        </span>
      )}
      {p.renaming ? (
        <RenameInput initial={p.node.kind === 'folder' ? p.node.folder.name : p.node.note.title} onCommit={p.onRename} onDone={p.onRenameDone} />
      ) : (
        <span className="min-w-0 flex-1 truncate">{name}</span>
      )}
      {cloudMark && !p.renaming && (
        <Cloud size={13} aria-hidden={false} role="img" aria-label={isNote ? '已同步到雲端' : '資料夾已同步到雲端'} className="shrink-0 text-fg-tertiary" />
      )}
      {!p.renaming && !p.selecting && <RowMenu kind={ref.kind} open={menuOpen} onOpenChange={setMenuOpen} actions={p.menu} />}
    </div>
  )
}

function RenameInput({
  initial,
  onCommit,
  onDone,
}: {
  initial: string
  onCommit(value: string): RenameResult
  onDone(): void
}) {
  const [value, setValue] = useState(initial)
  const [error, setError] = useState(false)
  const finished = useRef(false)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    // After the menu has released focus.
    const frame = requestAnimationFrame(() => {
      input.current?.focus()
      input.current?.select()
    })
    return () => cancelAnimationFrame(frame)
  }, [])
  const finish = () => {
    finished.current = true
    onDone()
  }
  const commit = () => {
    if (onCommit(value) === 'duplicate') return setError(true)
    finish()
  }
  return (
    <span className="relative min-w-0 flex-1" onClick={(e) => e.stopPropagation()}>
      <input
        aria-label="重新命名"
        value={value}
        ref={input}
        onChange={(e) => {
          setValue(e.target.value)
          setError(false)
        }}
        onBlur={() => !finished.current && (error ? finish() : commit())}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (isComposingEvent(e.nativeEvent)) return
          if (e.key === 'Enter') {
            e.preventDefault()
            commit()
          } else if (e.key === 'Escape') {
            e.preventDefault()
            finish()
          }
        }}
        className="h-6 w-full rounded-[6px] bg-white px-1.5 text-[13.5px] text-fg shadow-[inset_0_0_0_1px_var(--accent)] outline-none"
      />
      {error && (
        <span role="status" className="absolute top-full left-0 z-10 mt-0.5 rounded bg-white px-1.5 py-0.5 text-xs text-fg-secondary shadow-card">
          已有同名筆記
        </span>
      )}
    </span>
  )
}
