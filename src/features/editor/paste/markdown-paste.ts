import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { parseMarkdown } from '@/core/markdown/parse'
import type { PMNode } from '@/core/markdown/types'
import { resolveRefs } from '@/core/transfer/resolve'
import { normalizeTitle } from '@/core/vault/titles'
import type { EditorContext } from '../extensions'
const SIGNALS: RegExp[] = [
  /^ {0,3}#{1,6}[ \t]+\S/m,
  /^ {0,3}[-*+][ \t]+\S/m,
  /^ {0,3}\d+[.)][ \t]+\S/m,
  /^ {0,3}```/m,
  /^ {0,3}>[ \t]?\S/m,
  /^ *\|?[ \t]*:?-{3,}:?[ \t]*(\|[ \t]*:?-{3,}:?[ \t]*)+\|?[ \t]*$/m,
  /\[[^\]\n]+\]\((https?:\/\/|mailto:)[^)\s]+\)/,
  /\*\*[^*\n]+\*\*/,
  /(^|[^\w`])`[^`\n]+`/,
  /~~[^~\n]+~~/,
  /\[\[(?!note:)[^\]\n]+\]\]/,
  /==[^=\n]+==/,
]

/** Heuristic: does this plain text contain Markdown block / inline syntax worth converting? */
export function looksLikeMarkdown(text: string): boolean {
  if (!text.trim()) return false
  return SIGNALS.some((re) => re.test(text))
}

/**
 * Pasted Markdown → blocks, with the same parser as import. `[[標題]]` becomes a link when that note
 * exists (otherwise it stays as text); files cannot come from the clipboard, so embeds stay as text.
 */
export function markdownToContent(src: string, ctx: Pick<EditorContext, 'vault'> | null): PMNode[] {
  const titles = new Map((ctx?.vault?.listNotes() ?? []).map((n) => [normalizeTitle(n.title), n.id]))
  const { doc } = resolveRefs(parseMarkdown(src).doc, {
    note: (t) => titles.get(normalizeTitle(t)) ?? null,
    heading: () => null,
    block: () => null,
    attachment: () => null,
  })
  return doc.content ?? []
}

export const MarkdownPaste = Extension.create<{ ctx: EditorContext | null }>({
  name: 'markdownPaste',
  addOptions() {
    return { ctx: null }
  },
  addProseMirrorPlugins() {
    const editor = this.editor
    const ctx = this.options.ctx
    return [
      new Plugin({
        key: new PluginKey('markdownPaste'),
        props: {
          handlePaste(view, event) {
            if (view.composing || view.state.selection.$from.parent.type.spec.code) return false
            const data = event.clipboardData
            if (!data || data.getData('text/html')) return false // Tiptap + schema filter HTML
            if (data.files?.length) return false
            const text = data.getData('text/plain')
            if (!looksLikeMarkdown(text)) return false
            const content = markdownToContent(text, ctx)
            if (!content.length) return false
            event.preventDefault()
            return editor.commands.insertContent(content)
          },
        },
      }),
    ]
  },
})
