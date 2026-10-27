import * as Y from 'yjs'
import { Extension, type AnyExtension } from '@tiptap/core'
import { Plugin } from '@tiptap/pm/state'
import BaseBlockquote from '@tiptap/extension-blockquote'
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
import { BulletList, ListItem as BaseListItem, ListKeymap, TaskList } from '@tiptap/extension-list'
import { BLOCK_TYPES, BlockId } from './blocks/block-id'
import { ListMoves } from './blocks/list-moves'
import { OrderedList } from './blocks/ordered-list'
import { TaskItem } from './blocks/task-item'
import { Callout } from './blocks/callout'
import { CodeBlock, CodeTab } from './blocks/code-block'
import { Table, TableCell, TableHeader, TableRow, TableTab } from './blocks/table'
import { formattingExtensions } from './marks/formatting'
import { MarkdownPaste } from './paste/markdown-paste'
import { focusTitleEnd } from './focus-bridge'
import { isComposingEvent } from './ime'
import { isTyping, isTypingKey, markTyping } from './typing'
import { SlashCommand } from './menus/SlashMenu'
import { SuggestionKeys } from './menus/suggestion-popup'
import { BlockLinkPaste } from './links/block-link-clipboard'
import { BlockHighlight } from './links/block-highlight'
import { createLinkSuggestion } from './links/link-suggestion'
import { NoteLink } from './links/note-link'
import { Tag } from './links/tag'
import { Media } from './blocks/media'

export { BLOCK_TYPES }

export type EditorContext = {
  vault: Vault
  noteId: string
  openNote(id: string, blockId?: string): void
  searchBlocks(noteId: string, q: string): Promise<BlockRow[]>
  db: NotesDb
  storage: StorageAdapter
  /** Tag pill clicked (filtering arrives with the sidebar/search tasks). */
  onTagClick?(name: string): void
  /** The note's Y.Doc when it is loaded in the NoteDoc cache (confirms deleted block links). */
  peekNoteDoc?(noteId: string): Y.Doc | undefined
  /** Shown as a short inline banner when an image / video cannot be added. */
  onMediaError?(message: string): void
}

/**
 * Mod-Shift-b must reach Blockquote before Bold: Bold also binds `Mod-B` (Caps Lock), and ProseMirror's
 * keymap retries a shifted letter without Shift, so Bold's keymap (which runs first) would take Ctrl+Shift+B.
 */
const Blockquote = BaseBlockquote.extend({ priority: 110 })

/** Tab / Shift-Tab are owned by ListMoves (composition-guarded); drop the built-in bindings. */
const ListItem = BaseListItem.extend({
  addKeyboardShortcuts() {
    return { Enter: () => this.editor.commands.splitListItem(this.name) }
  },
})

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

/**
 * Typing mode (see ./typing): any typing key, IME composition included, enters it — the handler only
 * observes and never consumes a key. While typing, mouse moves are not passed on to the drag-handle
 * plugin, so it neither shows the grip nor measures layout until the pointer really moves (> 2 px).
 */
export const TypingGate = Extension.create({
  name: 'typingGate',
  priority: 10001,
  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          handleDOMEvents: {
            keydown: (_view, event) => {
              if (isTypingKey(event)) markTyping()
              return false
            },
            mousemove: () => isTyping(),
          },
        },
      }),
    ]
  },
})

/** Later tasks extend the editor by adding to this list. */
export function createExtensions(doc: Y.Doc, ctx: EditorContext): AnyExtension[] {
  return [
    TypingGate,
    Document,
    Paragraph,
    Text,
    Heading.configure({ levels: [1, 2, 3] }),
    Blockquote,
    HorizontalRule,
    HardBreak,
    Callout,
    CodeBlock,
    CodeTab,
    Table,
    TableRow,
    TableHeader,
    TableCell,
    TableTab,
    BulletList,
    OrderedList,
    ListItem,
    TaskList,
    TaskItem,
    ListKeymap,
    ListMoves,
    Dropcursor.configure({ width: 2 }),
    Gapcursor,
    Placeholder.configure({ placeholder: ({ editor }) => (editor.isEmpty ? EMPTY_PLACEHOLDER : '') }),
    ...formattingExtensions(),
    MarkdownPaste,
    SlashCommand,
    SuggestionKeys,
    NoteLink.configure({ ctx }),
    Tag.configure({ ctx }),
    createLinkSuggestion(ctx),
    BlockLinkPaste.configure({ ctx }),
    BlockHighlight,
    Media.configure({ ctx }),
    BlockId,
    Collaboration.configure({ document: doc, field: 'content' }),
    titleNavigation(ctx.noteId),
  ]
}
