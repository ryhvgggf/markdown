import { useCallback, useSyncExternalStore } from 'react'
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

function NoteLinkView({ node, extension }: ReactNodeViewProps) {
  const ctx = (extension.options as NoteLinkOptions).ctx
  const target: LinkTarget = { noteId: node.attrs.noteId as string, blockId: (node.attrs.blockId as string | null) ?? null }
  useNoteSnapshot(ctx?.vault, target.noteId)
  const blockText = useBlockText(ctx?.db, target.noteId, target.blockId, ctx?.peekNoteDoc)
  const label = ctx?.vault ? noteLinkLabel(ctx.vault, target, blockText) : { text: '已刪除的筆記', state: 'deleted-note' as const }
  const ok = label.state === 'ok'
  return (
    <NodeViewWrapper as="span" className="note-link-wrapper">
      <span
        contentEditable={false}
        role={ok ? 'link' : undefined}
        aria-label={ok ? `前往 ${label.text}` : undefined}
        aria-disabled={ok ? undefined : true}
        data-note-link=""
        data-note-id={target.noteId}
        data-target-block={target.blockId ?? undefined}
        data-state={label.state}
        className={
          ok
            ? 'note-link cursor-pointer text-accent decoration-accent/40 underline-offset-2 hover:underline'
            : 'note-link text-fg-tertiary line-through'
        }
        onClick={(e) => {
          if (!ok) return
          e.preventDefault()
          ctx?.openNote(target.noteId, target.blockId ?? undefined)
        }}
      >
        {label.text}
      </span>
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
