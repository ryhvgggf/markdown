import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { Node, mergeAttributes } from '@tiptap/core'
import { NodeSelection } from '@tiptap/pm/state'
import { NodeViewWrapper, ReactNodeViewRenderer, type ReactNodeViewProps } from '@tiptap/react'
import { liveQuery } from 'dexie'
import type { NotesDb } from '@/adapters/storage/db'
import type { Vault } from '@/core/vault/vault'
import { displayTitle } from '@/core/vault/titles'
import type { EditorContext } from '../extensions'
import { formatBlockLink, type LinkTarget } from './block-link-clipboard'

export type LinkState = 'ok' | 'deleted-note' | 'deleted-block'

const BLOCK_SNIPPET = 20

export function noteLinkLabel(vault: Vault, target: LinkTarget, blockText?: string): { text: string; state: LinkState } {
  const note = vault.getNote(target.noteId)
  if (!note || note.deletedAt !== null) return { text: '已刪除的筆記', state: 'deleted-note' }
  const title = displayTitle(note.title)
  if (target.blockId === null) return { text: title, state: 'ok' }
  if (blockText === undefined) return { text: '已刪除的區塊', state: 'deleted-block' }
  const chars = Array.from(blockText.trim())
  if (chars.length === 0) return { text: title, state: 'ok' }
  const snippet = chars.length > BLOCK_SNIPPET ? `${chars.slice(0, BLOCK_SNIPPET).join('')}…` : chars.join('')
  return { text: `${title} › ${snippet}`, state: 'ok' }
}

type BlockText = { key: string; text: string | undefined }

/** Live text of an indexed block; `loading` until the first query result for this target. */
function useBlockText(db: NotesDb | undefined, noteId: string, blockId: string | null) {
  const key = `${noteId}#${blockId ?? ''}`
  const [result, setResult] = useState<BlockText | null>(null)
  useEffect(() => {
    if (!db || !blockId) return
    const sub = liveQuery(() => db.blocks.get([noteId, blockId])).subscribe({
      next: (row) => setResult({ key, text: row?.text }),
      error: () => setResult({ key, text: undefined }),
    })
    return () => sub.unsubscribe()
  }, [db, noteId, blockId, key])
  const current = result?.key === key ? result : null
  return { loading: Boolean(blockId && db) && !current, text: current?.text }
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
  const block = useBlockText(ctx?.db, target.noteId, target.blockId)
  const label = ctx?.vault
    ? block.loading
      ? noteLinkLabel(ctx.vault, { ...target, blockId: null })
      : noteLinkLabel(ctx.vault, target, block.text)
    : { text: '已刪除的筆記', state: 'deleted-note' as const }
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
    return [{ tag: 'span[data-note-link]' }]
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
