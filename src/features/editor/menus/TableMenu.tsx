import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Editor } from '@tiptap/core'
import { useEditorState } from '@tiptap/react'
import { autoUpdate } from '@floating-ui/dom'
import { IconButton } from '@/ui/components/IconButton'
import { Menu } from '@/ui/components/Menu'
import { More } from '@/ui/icons'
import { isComposingEvent } from '../ime'
import { endTyping, isTyping, useTyping } from '../typing'

type Action = { label: string; run: (e: Editor) => boolean; can: (e: Editor) => boolean; danger?: boolean }

const chain = (e: Editor) => e.chain().focus()
export const TABLE_ACTIONS: Array<Action | 'separator'> = [
  { label: '上方插入列', run: (e) => chain(e).addRowBefore().run(), can: (e) => e.can().addRowBefore() },
  { label: '下方插入列', run: (e) => chain(e).addRowAfter().run(), can: (e) => e.can().addRowAfter() },
  { label: '左側插入欄', run: (e) => chain(e).addColumnBefore().run(), can: (e) => e.can().addColumnBefore() },
  { label: '右側插入欄', run: (e) => chain(e).addColumnAfter().run(), can: (e) => e.can().addColumnAfter() },
  'separator',
  { label: '刪除列', run: (e) => chain(e).deleteRow().run(), can: (e) => e.can().deleteRow() },
  { label: '刪除欄', run: (e) => chain(e).deleteColumn().run(), can: (e) => e.can().deleteColumn() },
  { label: '刪除表格', run: (e) => chain(e).deleteTable().run(), can: (e) => e.can().deleteTable(), danger: true },
]

/** Position of the table cell holding the selection, or -1. */
function cellPos(e: Editor): number {
  const { $from } = e.state.selection
  for (let d = $from.depth; d > 0; d--) {
    const name = $from.node(d).type.name
    if (name === 'tableCell' || name === 'tableHeader') return $from.before(d)
  }
  return -1
}

/**
 * A ⋯ button in the top-right corner of the cell holding the caret; it opens the table actions. The
 * button keeps the editor's selection (no focus on mousedown) and stays mounted while its menu is open,
 * so the menu stays anchored next to it (see FormatToolbar). Commands are ordinary ProseMirror
 * transactions, so they persist and sync through Yjs like any edit.
 */
export function TableMenu({ editor }: { editor: Editor | null }) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => (e ? { pos: cellPos(e), focused: e.isFocused, editable: e.isEditable } : null),
  })
  const visible = !!editor && !!s && s.editable && s.pos >= 0 && (s.focused || open)
  const pos = s?.pos ?? -1

  // Keyboard: Shift+F10 or the context-menu key with the caret in a cell opens the menu.
  useEffect(() => {
    if (!editor || editor.isDestroyed) return
    const dom = editor.view?.dom as HTMLElement | undefined
    if (!dom) return
    let openedAt = 0
    const onKey = (e: KeyboardEvent) => {
      const shortcut = e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey)
      if (!shortcut || isComposingEvent(e, editor.view) || !editor.isEditable || cellPos(editor) < 0) return
      e.preventDefault()
      openedAt = Date.now()
      endTyping()
      setOpen(true)
    }
    // The context-menu key also fires a `contextmenu` event: keep the browser's own menu away.
    const onContext = (e: MouseEvent) => {
      if (Date.now() - openedAt < 500) e.preventDefault()
    }
    dom.addEventListener('keydown', onKey)
    dom.addEventListener('contextmenu', onContext)
    return () => {
      dom.removeEventListener('keydown', onKey)
      dom.removeEventListener('contextmenu', onContext)
    }
  }, [editor])

  useLayoutEffect(() => {
    const el = box.current
    if (!visible || !editor || !el) return
    const place = () => {
      if (editor.isDestroyed) return
      const at = cellPos(editor)
      const cell = (at >= 0 ? editor.view.nodeDOM(at) : null) as HTMLElement | null
      if (!cell?.getBoundingClientRect) return
      const r = cell.getBoundingClientRect()
      // A wide table scrolls inside .tableWrapper: keep the button within its visible part.
      const w = cell.closest('.tableWrapper')?.getBoundingClientRect()
      const right = w ? Math.min(r.right, w.right) : r.right
      const left = w ? Math.max(r.left, w.left) : r.left
      el.style.left = `${Math.max(left + 4, right - 30)}px` // 8 px clear of the column-resize zone at the edge
      el.style.top = `${r.top + 4}px`
    }
    // Typing mode: no layout reads per keystroke transaction. Typing inside a cell does not move the cell's
    // top-right corner (fixed table layout); the cell's own resizes still reach autoUpdate's ResizeObserver.
    const onTransaction = () => {
      if (!isTyping()) place()
    }
    const cell = editor.view.nodeDOM(pos) as HTMLElement | null
    const stop = cell instanceof Element ? autoUpdate(cell, el, place) : undefined
    editor.on('transaction', onTransaction)
    const offTyping = useTyping.subscribe((t, prev) => {
      if (prev.typing && !t.typing) place()
    })
    place()
    return () => {
      stop?.()
      editor.off('transaction', onTransaction)
      offTyping()
    }
  }, [visible, editor, pos])

  if (!editor || !visible) return null
  return (
    <div ref={box} data-table-menu style={{ position: 'fixed', left: 0, top: 0, zIndex: 30 }}>
      <Menu
        align="start"
        open={open}
        onOpenChange={setOpen}
        onCloseAutoFocus={(e) => {
          e.preventDefault()
          if (!editor.isDestroyed) editor.commands.focus()
        }}
        trigger={
          <IconButton
            label="表格操作"
            className="glass-float !size-[22px] !rounded-[6px] text-fg-secondary"
            onMouseDown={(e) => e.preventDefault()}
          >
            <More size={14} />
          </IconButton>
        }
      >
        {TABLE_ACTIONS.map((a, i) =>
          a === 'separator' ? (
            <Menu.Separator key={i} />
          ) : (
            <Menu.Item key={a.label} disabled={!a.can(editor)} onSelect={() => a.run(editor)} className={a.danger ? 'text-[#C62828]' : ''}>
              {a.label}
            </Menu.Item>
          ),
        )}
      </Menu>
    </div>
  )
}
