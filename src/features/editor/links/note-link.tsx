import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { computePosition, flip, offset, shift } from '@floating-ui/dom'
import { Node, mergeAttributes } from '@tiptap/core'
import { NodeSelection } from '@tiptap/pm/state'
import { NodeViewWrapper, ReactNodeViewRenderer, type ReactNodeViewProps } from '@tiptap/react'
import type { Vault } from '@/core/vault/vault'
import { displayTitle } from '@/core/vault/titles'
import type { EditorContext } from '../extensions'
import { formatBlockLink, type LinkTarget } from './block-link-clipboard'
import { useBlockText, type BlockTextResult } from './block-status'

export type LinkState = 'ok' | 'deleted-note' | 'deleted-block'

const BLOCK_SNIPPET = 20

/**
 * `blockText`: the block's text; `null` = unknown (not indexed yet) → title only, state ok;
 * `undefined` (or omitted) = the block is known to be gone → 已刪除的區塊.
 */
export function noteLinkLabel(vault: Vault, target: LinkTarget, blockText?: BlockTextResult): { text: string; state: LinkState } {
  const note = vault.getNote(target.noteId)
  if (!note || note.deletedAt !== null) return { text: '已刪除的筆記', state: 'deleted-note' }
  const title = displayTitle(note.title)
  if (target.blockId === null) return { text: title, state: 'ok' }
  if (blockText === undefined) return { text: '已刪除的區塊', state: 'deleted-block' }
  if (blockText === null) return { text: title, state: 'ok' }
  const chars = Array.from(blockText.trim())
  if (chars.length === 0) return { text: title, state: 'ok' }
  const snippet = chars.length > BLOCK_SNIPPET ? `${chars.slice(0, BLOCK_SNIPPET).join('')}…` : chars.join('')
  return { text: `${title} › ${snippet}`, state: 'ok' }
}

const noop = () => () => {}

function useNoteSnapshot(vault: Vault | undefined, noteId: string): string {
  const subscribe = useCallback((cb: () => void) => (vault ? vault.observe(cb) : noop()), [vault])
  return useSyncExternalStore(subscribe, () => {
    const n = vault?.getNote(noteId)
    return n ? `${n.deletedAt ?? ''}\u0000${n.title}` : ''
  })
}

export const RENAME_EVENT = 'note-link-rename'
const MAX_LABEL = 100

/** Keeps a name that survives `[[title|name]]`: no brackets, bars or line breaks. */
export const cleanLabel = (v: string): string | null => v.replace(/[[\]|\r\n]+/g, ' ').trim().slice(0, MAX_LABEL).trim() || null

function RenameBox({ anchor, initial, placeholder, onDone }: { anchor: HTMLElement; initial: string; placeholder: string; onDone: (value: string | null) => void }) {
  const box = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const [value, setValue] = useState(initial)
  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    void computePosition(anchor, el, { strategy: 'fixed', placement: 'bottom-start', middleware: [offset(6), flip({ padding: 8 }), shift({ padding: 8 })] }).then(({ x, y }) => {
      el.style.left = `${x}px`
      el.style.top = `${y}px`
    })
    // The editor takes focus back when the right-click is released; focus the box after that.
    const focus = () => {
      input.current?.focus()
      input.current?.select()
    }
    focus()
    const t = window.setTimeout(focus, 60)
    return () => window.clearTimeout(t)
  }, [anchor])
  useEffect(() => {
    // A press anywhere else closes it without changing the name (a blur would also fire on window switches).
    const away = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as globalThis.Node)) onDone(null)
    }
    document.addEventListener('pointerdown', away, true)
    return () => document.removeEventListener('pointerdown', away, true)
  }, [onDone])
  return createPortal(
    <div ref={box} style={{ position: 'fixed', left: 0, top: 0, zIndex: 60 }} className="glass-float popup-pop p-2">
      <input
        ref={input}
        aria-label="連結名稱"
        placeholder={placeholder}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.nativeEvent.isComposing || e.keyCode === 229) return
          if (e.key === 'Escape') {
            e.preventDefault()
            onDone(null)
          } else if (e.key === 'Enter') {
            e.preventDefault()
            onDone(cleanLabel(value) ?? '')
          }
        }}
        className="h-7 w-60 rounded-control bg-fill px-2 text-sm text-fg outline-none placeholder:text-fg-tertiary focus-visible:ring-2 focus-visible:ring-accent"
      />
      <div className="px-0.5 pt-1 text-xs text-fg-secondary">Enter 套用，留空則顯示筆記標題</div>
    </div>,
    document.body,
  )
}

function NoteLinkView({ node, extension, editor, updateAttributes }: ReactNodeViewProps) {
  const ctx = (extension.options as NoteLinkOptions).ctx
  const target: LinkTarget = { noteId: node.attrs.noteId as string, blockId: (node.attrs.blockId as string | null) ?? null }
  useNoteSnapshot(ctx?.vault, target.noteId)
  const blockText = useBlockText(ctx?.db, target.noteId, target.blockId, ctx?.peekNoteDoc)
  const label = ctx?.vault ? noteLinkLabel(ctx.vault, target, blockText) : { text: '已刪除的筆記', state: 'deleted-note' as const }
  const ok = label.state === 'ok'
  const own = (node.attrs.label as string | null) || null
  const shown = ok && own ? own : label.text
  const [anchor, setAnchor] = useState<HTMLSpanElement | null>(null)
  const [renaming, setRenaming] = useState(false)
  useEffect(() => {
    if (!anchor || !ok) return
    const open = () => setRenaming(true)
    anchor.addEventListener(RENAME_EVENT, open)
    return () => anchor.removeEventListener(RENAME_EVENT, open)
  }, [anchor, ok])
  return (
    <NodeViewWrapper as="span" className="note-link-wrapper">
      <span
        ref={setAnchor}
        contentEditable={false}
        role={ok ? 'link' : undefined}
        aria-label={ok ? `前往 ${shown}` : undefined}
        aria-disabled={ok ? undefined : true}
        data-note-link=""
        data-note-id={target.noteId}
        data-target-block={target.blockId ?? undefined}
        data-state={label.state}
        className={
          ok
            ? 'note-link cursor-pointer underline-offset-2 hover:underline'
            : 'note-link text-fg-tertiary line-through'
        }
        onClick={(e) => {
          if (!ok) return
          e.preventDefault()
          ctx?.openNote(target.noteId, target.blockId ?? undefined)
        }}
        onContextMenu={(e) => {
          if (!ok) return
          e.preventDefault()
          setRenaming(true)
        }}
      >
        {shown}
      </span>
      {renaming && anchor && (
        <RenameBox
          anchor={anchor}
          initial={own ?? ''}
          placeholder={label.text}
          onDone={(v) => {
            setRenaming(false)
            if (v !== null) updateAttributes({ label: v || null })
            editor.commands.focus()
          }}
        />
      )}
    </NodeViewWrapper>
  )
}

export type NoteLinkOptions = { ctx: EditorContext | null }

export const NoteLink = Node.create<NoteLinkOptions>({
  name: 'noteLink',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,

  addOptions() {
    return { ctx: null }
  },

  addAttributes() {
    return {
      noteId: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-note-id') ?? '',
        renderHTML: (a) => ({ 'data-note-id': a.noteId as string }),
      },
      blockId: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-target-block') || null,
        renderHTML: (a) => (a.blockId ? { 'data-target-block': a.blockId as string } : {}),
      },
      /** Name shown instead of the note's title (null = the title). */
      label: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-label') || null,
        renderHTML: (a) => (a.label ? { 'data-label': a.label as string } : {}),
      },
    }
  },

  parseHTML() {
    const ctx = this.options.ctx
    return [
      {
        tag: 'span[data-note-link]',
        // Links can never point at a note that does not exist (e.g. foreign HTML).
        getAttrs: (el) => {
          const id = (el as HTMLElement).getAttribute('data-note-id')
          if (!id) return false
          return ctx?.vault && !ctx.vault.getNote(id) ? false : null
        },
      },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes({ 'data-note-link': '' }, HTMLAttributes)]
  },

  renderText({ node }) {
    return formatBlockLink(node.attrs.noteId as string, (node.attrs.blockId as string | null) ?? null)
  },

  addKeyboardShortcuts() {
    return {
      // The link that is selected, or right next to the caret.
      F2: ({ editor }) => {
        const sel = editor.state.selection
        let pos = -1
        if (sel instanceof NodeSelection && sel.node.type.name === this.name) pos = sel.from
        else if (sel.empty) {
          const { nodeBefore, nodeAfter, pos: at } = sel.$from
          if (nodeBefore?.type.name === this.name) pos = at - nodeBefore.nodeSize
          else if (nodeAfter?.type.name === this.name) pos = at
        }
        if (pos < 0) return false
        const dom = editor.view.nodeDOM(pos) as HTMLElement | null
        dom?.querySelector('[data-note-link]')?.dispatchEvent(new CustomEvent(RENAME_EVENT))
        return true
      },
      Enter: ({ editor }) => {
        const sel = editor.state.selection
        if (!(sel instanceof NodeSelection) || sel.node.type.name !== this.name) return false
        const { noteId, blockId } = sel.node.attrs as { noteId: string; blockId: string | null }
        // The node view knows the live state (including deleted blocks); deleted links do nothing.
        const dom = editor.view.nodeDOM(sel.from) as HTMLElement | null
        if (dom?.querySelector('[data-state]')?.getAttribute('data-state') !== 'ok') return true
        this.options.ctx?.openNote(noteId, blockId ?? undefined)
        return true
      },
    }
  },

  addNodeView() {
    return ReactNodeViewRenderer(NoteLinkView)
  },
})
