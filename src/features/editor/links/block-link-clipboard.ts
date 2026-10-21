import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import type { EditorContext } from '../extensions'

export type LinkTarget = { noteId: string; blockId: string | null }

const ID = '[A-Za-z0-9_-]+'
const TOKEN = new RegExp(`^\\[\\[note:(${ID})(?:#(${ID}))?\\]\\]$`)

/** `[[note:<noteId>#<blockId>]]`; the `#…` part is omitted when blockId is null. */
export function formatBlockLink(noteId: string, blockId: string | null): string {
  return blockId ? `[[note:${noteId}#${blockId}]]` : `[[note:${noteId}]]`
}

/** Parses text that is exactly one block-link token (surrounding whitespace allowed). */
export function parseBlockLink(text: string): LinkTarget | null {
  const m = TOKEN.exec(text.trim())
  return m ? { noteId: m[1], blockId: m[2] ?? null } : null
}

export function copyBlockLink(noteId: string, blockId: string): Promise<void> {
  return navigator.clipboard.writeText(formatBlockLink(noteId, blockId))
}

/**
 * Pasting a lone block-link token inserts a noteLink. Runs before the Markdown paste plugin
 * (higher priority) and stays out of code blocks and IME composition. Tokens for notes that do not
 * exist or are in the trash paste as plain text.
 */
export const BlockLinkPaste = Extension.create<{ ctx: EditorContext | null }>({
  name: 'blockLinkPaste',
  priority: 200,
  addOptions() {
    return { ctx: null }
  },
  addProseMirrorPlugins() {
    const editor = this.editor
    const ctx = this.options.ctx
    return [
      new Plugin({
        key: new PluginKey('blockLinkPaste'),
        props: {
          handlePaste(view, event) {
            if (view.composing || view.state.selection.$from.parent.type.spec.code) return false
            const target = parseBlockLink(event.clipboardData?.getData('text/plain') ?? '')
            if (!target) return false
            const note = ctx?.vault?.getNote(target.noteId)
            if (!note || note.deletedAt !== null) return false
            event.preventDefault()
            return editor.commands.insertContent({ type: 'noteLink', attrs: target })
          },
        },
      }),
    ]
  },
})
