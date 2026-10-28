import type { MarkdownIt, StateBlock } from 'markdown-it'

/** v1's `:::quote` … `:::` container → blockquote. */
function quoteContainer(state: StateBlock, startLine: number, endLine: number, silent: boolean): boolean {
  const lineText = (l: number) => state.src.slice(state.bMarks[l] + state.tShift[l], state.eMarks[l]).trim()
  if (!/^:::\s*quote$/i.test(lineText(startLine))) return false
  let end = startLine + 1
  while (end < endLine && lineText(end) !== ':::') end++
  if (end >= endLine) return false
  if (silent) return true
  const oldParent = state.parentType
  const oldMax = state.lineMax
  state.parentType = 'blockquote' as typeof state.parentType
  state.push('blockquote_open', 'blockquote', 1).map = [startLine, end + 1]
  state.lineMax = end
  state.md.block.tokenize(state, startLine + 1, end)
  state.push('blockquote_close', 'blockquote', -1)
  state.lineMax = oldMax
  state.parentType = oldParent
  state.line = end + 1
  return true
}

export function v1Dialect(md: MarkdownIt): void {
  md.block.ruler.before('fence', 'v1_quote', quoteContainer, { alt: ['paragraph', 'reference', 'blockquote', 'list'] })
}
