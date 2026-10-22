import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { useDraggable } from '@dnd-kit/core'
import type { TreeNode } from '@/core/vault/tree'
import { displayTitle } from '@/core/vault/titles'
import { isComposingEvent } from '@/features/editor/ime'
import { ChevronRight } from '@/ui/icons'
import { nodeRef, type Zone } from './dnd'
import { RowMenu, type RowMenuActions } from './RowMenu'
import type { RenameResult } from './use-actions'

export const INDENT = 20

export interface TreeItemProps {
  node: TreeNode
  level: number
  expanded: boolean
  current: boolean
  tabbable: boolean
  drop: Zone | null
  renaming: boolean
  menu: RowMenuActions
  onActivate(): void
  onExpand(open: boolean): void
  onRename(value: string): RenameResult
  onRenameDone(): void
}

export function TreeItem(p: TreeItemProps) {
  const ref = nodeRef(p.node)
  const label = p.node.kind === 'folder' ? p.node.folder.name || '未命名資料夾' : displayTitle(p.node.note.title)
  const [menuOpen, setMenuOpen] = useState(false)
  const drag = useDraggable({ id: ref.id, data: ref, disabled: p.renaming })

  // React events bubble out of the menu portal into this row; ignore those.
  const inside = (e: { currentTarget: Element; target: EventTarget }) => e.currentTarget.contains(e.target as Node)

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return
    const isFolder = p.node.kind === 'folder'
    if (e.key === 'Enter' || e.key === ' ') p.onActivate()
    else if (e.key === 'F2') p.menu.rename()
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
      aria-label={label}
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
        setMenuOpen(true)
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
      {p.renaming ? (
        <RenameInput initial={p.node.kind === 'folder' ? p.node.folder.name : p.node.note.title} onCommit={p.onRename} onDone={p.onRenameDone} />
      ) : (
        <span className="min-w-0 flex-1 truncate">{label}</span>
      )}
      {!p.renaming && <RowMenu kind={ref.kind} open={menuOpen} onOpenChange={setMenuOpen} actions={p.menu} />}
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
