import type { Editor } from '@tiptap/core'
import type { Match } from './find-match'

export interface ApplyOptions {
  /** New text for each match. Omit to leave the matched text itself untouched. */
  text?: string
  /** Text color (hex) to apply to each match (the replacement text, when `text` is also given). Omit to leave formatting untouched. */
  color?: string
}

/**
 * Applies `opts` to every match in one go — one transaction, one undo step (TableMenu's bulk row/column
 * operations use the same `editor.chain()` pattern). Processes matches from the end of the document
 * backwards so replacing one match's text never shifts the positions of matches still to be processed.
 */
export function applyToAllMatches(editor: Editor, matches: readonly Match[], opts: ApplyOptions): void {
  if (!matches.length || (opts.text === undefined && opts.color === undefined)) return
  const sorted = [...matches].sort((a, b) => b.from - a.from)
  let chain = editor.chain().focus()
  for (const m of sorted) {
    if (opts.text !== undefined) chain = chain.insertContentAt({ from: m.from, to: m.to }, opts.text)
    if (opts.color !== undefined) {
      const to = opts.text !== undefined ? m.from + opts.text.length : m.to
      chain = chain.setTextSelection({ from: m.from, to }).setColor(opts.color)
    }
  }
  chain.run()
}
