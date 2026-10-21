import { useEffect, useRef } from 'react'
import type { Editor } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { TextSelection } from '@tiptap/pm/state'
import { DragHandle } from '@tiptap/extension-drag-handle-react'
import { Menu } from '@/ui/components/Menu'
import { Grip, Link, Swap, Trash } from '@/ui/icons'
import { CONVERT_ENTRIES } from './ConvertMenu'

type Target = { node: PMNode; pos: number }

/** The top-level block holding the selection (fallback when no block was hovered). */
function selectionBlock(editor: Editor): Target | null {
  const { $from } = editor.state.selection
  if ($from.depth < 1) return null
  const pos = $from.before(1)
  const node = editor.state.doc.nodeAt(pos)
  return node ? { node, pos } : null
}

export function DragHandleMenu({ editor }: { editor: Editor | null }) {
  const hovered = useRef<Target | null>(null)
  const target = useRef<Target | null>(null)

  // Hide the grip while an IME composition is in progress.
  useEffect(() => {
    if (!editor || editor.isDestroyed) return
    const dom = editor.view.dom
    const hide = () => editor.view.dispatch(editor.state.tr.setMeta('hideDragHandle', true).setMeta('addToHistory', false))
    dom.addEventListener('compositionstart', hide)
    return () => dom.removeEventListener('compositionstart', hide)
  }, [editor])

  if (!editor) return null

  const onOpenChange = (open: boolean) => {
    if (open) target.current = hovered.current ?? selectionBlock(editor)
    // keep the handle visible while its menu is open
    editor.view.dispatch(editor.state.tr.setMeta('lockDragHandle', open).setMeta('addToHistory', false))
  }

  const current = (): Target | null => {
    const t = target.current
    if (!t) return null
    const node = editor.state.doc.nodeAt(t.pos)
    // Unresolvable target: do nothing rather than act on a different block.
    return node && node.type === t.node.type ? { node, pos: t.pos } : null
  }

  const convert = (run: (e: Editor) => boolean) => {
    const t = current()
    if (!t) return
    // pos + 1 is not a text position inside containers (lists, callout, table): find the first one.
    const { state } = editor
    editor.view.dispatch(state.tr.setSelection(TextSelection.near(state.doc.resolve(t.pos + 1))))
    run(editor)
  }

  const remove = () => {
    const t = current()
    if (!t) return
    editor.chain().focus().deleteRange({ from: t.pos, to: t.pos + t.node.nodeSize }).run()
  }

  return (
    <DragHandle
      editor={editor}
      className="note-drag-handle"
      onNodeChange={({ node, pos }) => {
        hovered.current = node && pos >= 0 ? { node, pos } : null
      }}
    >
      <Menu
        align="start"
        onOpenChange={onOpenChange}
        onCloseAutoFocus={(e) => e.preventDefault()}
        trigger={
          <button
            type="button"
            aria-label="拖曳以移動，點擊開啟選單"
            className="inline-flex h-6 w-5 cursor-grab items-center justify-center rounded-control text-fg-tertiary hover:bg-fill hover:text-fg active:cursor-grabbing"
          >
            <Grip size={16} />
          </button>
        }
      >
        <Menu.Sub
          label={
            <>
              <Swap size={16} />
              轉換類型
            </>
          }
        >
          {CONVERT_ENTRIES.map((en) => (
            <Menu.Item key={en.label} onSelect={() => convert(en.run)}>
              {en.label}
            </Menu.Item>
          ))}
        </Menu.Sub>
        <Menu.Item disabled aria-label="複製區塊連結">
          <Link size={16} />
          複製區塊連結
          <span className="ml-auto text-xs text-fg-tertiary">即將推出</span>
        </Menu.Item>
        <Menu.Separator />
        <Menu.Item onSelect={remove} aria-label="刪除">
          <Trash size={16} />
          刪除
        </Menu.Item>
      </Menu>
    </DragHandle>
  )
}
