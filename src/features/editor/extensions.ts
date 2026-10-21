import * as Y from 'yjs'
import { Extension, type AnyExtension } from '@tiptap/core'
import { Plugin } from '@tiptap/pm/state'
import Blockquote from '@tiptap/extension-blockquote'
import Collaboration from '@tiptap/extension-collaboration'
import Document from '@tiptap/extension-document'
import HardBreak from '@tiptap/extension-hard-break'
import Heading from '@tiptap/extension-heading'
import HorizontalRule from '@tiptap/extension-horizontal-rule'
import Paragraph from '@tiptap/extension-paragraph'
import Text from '@tiptap/extension-text'
import { Dropcursor, Gapcursor, Placeholder } from '@tiptap/extensions'
import type { NotesDb, BlockRow } from '@/adapters/storage/db'
import type { StorageAdapter } from '@/adapters/storage/types'
import type { Vault } from '@/core/vault/vault'
import { BLOCK_TYPES, BlockId } from './blocks/block-id'
import { focusTitleEnd } from './focus-bridge'
import { isComposingEvent } from './ime'

export { BLOCK_TYPES }

export type EditorContext = {
  vault: Vault
  noteId: string
  openNote(id: string, blockId?: string): void
  searchBlocks(noteId: string, q: string): Promise<BlockRow[]>
  db: NotesDb
  storage: StorageAdapter
}

export const EMPTY_PLACEHOLDER = '輸入 / 插入區塊，或直接開始寫作'

/** ArrowUp at the start of the first block moves focus to the title. */
function titleNavigation(noteId: string) {
  return Extension.create({
    name: 'titleNavigation',
    addProseMirrorPlugins() {
      return [
        new Plugin({
          props: {
            handleKeyDown(view, event) {
              if (event.key !== 'ArrowUp' || event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) return false
              if (isComposingEvent(event, view)) return false
              const { selection } = view.state
              if (!selection.empty || selection.$from.index(0) !== 0) return false
              let onFirstLine = selection.$from.parentOffset === 0
              if (!onFirstLine) {
                try {
                  onFirstLine = view.endOfTextblock('up')
                } catch {
                  onFirstLine = false
                }
              }
              if (!onFirstLine) return false
              event.preventDefault()
              focusTitleEnd(noteId)
              return true
            },
          },
        }),
      ]
    },
  })
}

/** Later tasks extend the editor by adding to this list. */
export function createExtensions(doc: Y.Doc, ctx: EditorContext): AnyExtension[] {
  return [
    Document,
    Paragraph,
    Text,
    Heading.configure({ levels: [1, 2, 3] }),
    Blockquote,
    HorizontalRule,
    HardBreak,
    Dropcursor.configure({ width: 2 }),
    Gapcursor,
    Placeholder.configure({ placeholder: ({ editor }) => (editor.isEmpty ? EMPTY_PLACEHOLDER : '') }),
    BlockId,
    Collaboration.configure({ document: doc, field: 'content' }),
    titleNavigation(ctx.noteId),
  ]
}
