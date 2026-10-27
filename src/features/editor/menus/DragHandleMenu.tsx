import { useEffect, useRef, useState } from 'react'
import type { Editor } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { TextSelection } from '@tiptap/pm/state'
import { DragHandle } from '@tiptap/extension-drag-handle-react'
import { Menu } from '@/ui/components/Menu'
import { Grip, Link, Swap, Trash } from '@/ui/icons'
import { copyBlockLink } from '../links/block-link-clipboard'
import { CONVERT_ENTRIES } from './ConvertMenu'
import { useTyping } from '../typing'

type Target = { node: PMNode; pos: number }

/** The top-level block holding the selection (fallback when no block was hovered). */
function selectionBlock(editor: Editor): Target | null {
  const { $from } = editor.state.selection
  if ($from.depth < 1) return null
  const pos = $from.before(1)
  const node = editor.state.doc.nodeAt(pos)
  return node ? { node, pos } : null
}

const COPIED_MS = 700

export function DragHandleMenu({ editor, noteId }: { editor: Editor | null; noteId: string }) {
  const hovered = useRef<Target | null>(null)
  const gripRef = useRef<HTMLButtonElement>(null)
  const target = useRef<Target | null>(null)
  const [open, setOpen] = useState(false)
  const openRef = useRef(false)
  useEffect(() => {
    openRef.current = open
  }, [open])
  const [targetBlockId, setTargetBlockId] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(closeTimer.current), [])

  // Hide the grip while an IME composition is in progress, and whenever typing mode starts (title included).
  useEffect(() => {
    if (!editor || editor.isDestroyed) return
    const dom = editor.view.dom
    const hide = () => {
      if (!editor.isDestroyed) editor.view.dispatch(editor.state.tr.setMeta('hideDragHandle', true).setMeta('addToHistory', false))
    }
    dom.addEventListener('compositionstart', hide)
    const off = useTyping.subscribe((s, prev) => {
      if (s.typing && !prev.typing && !openRef.current) hide()
    })
    return () => {
      dom.removeEventListener('compositionstart', hide)
      off()
    }
  }, [editor])

  if (!editor) return null

  const onOpenChange = (next: boolean) => {
    clearTimeout(closeTimer.current)
    if (next) {
      target.current = hovered.current ?? selectionBlock(editor)
      setTargetBlockId((target.current?.node.attrs.id as string | null | undefined) ?? null)
      setCopied(false)
    }
    setOpen(next)
    // keep the handle visible while its menu is open
    if (!editor.isDestroyed) editor.view.dispatch(editor.state.tr.setMeta('lockDragHandle', next).setMeta('addToHistory', false))
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

  const copyLink = (e: Event) => {
    e.preventDefault() // keep the menu open to show 已複製
    const id = current()?.node.attrs.id as string | null | undefined
    if (!id) return
    void copyBlockLink(noteId, id).then(
      () => {
        setCopied(true)
        closeTimer.current = setTimeout(() => onOpenChange(false), COPIED_MS)
      },
      () => setCopied(false),
    )
  }

  return (
    <DragHandle
      editor={editor}
      className="note-drag-handle"
      onNodeChange={({ node, pos }) => {
        // Dividers have nothing to grab: no grip (CSS hides the handle; the plugin re-shows it after this call).
        const noGrip = node?.type.name === 'horizontalRule'
        hovered.current = node && pos >= 0 && !noGrip ? { node, pos } : null
        gripRef.current?.closest('.note-drag-handle')?.toggleAttribute('data-no-grip', noGrip)
      }}
    >
      <Menu
        align="start"
        open={open}
        onOpenChange={onOpenChange}
        onCloseAutoFocus={(e) => e.preventDefault()}
        trigger={
          <button
            ref={gripRef}
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
        <Menu.Item disabled={!targetBlockId} onSelect={copyLink} aria-label="複製區塊連結">
          <Link size={16} />
          {copied ? '已複製' : '複製區塊連結'}
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
