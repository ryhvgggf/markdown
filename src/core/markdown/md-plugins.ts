import type { MarkdownIt, StateBlock, StateCore, StateInline } from 'markdown-it'

/** markdown-it plugins for the syntax v2 reads and writes (spec 5 / 6). No DOM. */

const TAG_RE = /^#((?=[\p{N}_-]*\p{L})[\p{L}\p{N}\p{M}][\p{L}\p{N}\p{M}_-]*)/u
const NOT_BEFORE_TAG = /[A-Za-z0-9_/:#&.\\]/
const CJK = /[\u2e80-\u2fff\u3000-\u303f\u3040-\u30ff\u3100-\u31ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\ufe30-\ufe4f\uff00-\uffef]/

export type WikiMeta = { target: string; heading: string | null; anchor: string | null; alias: string | null; width: number | null; raw: string }

export function parseWikiTarget(inner: string, raw: string, embed: boolean): WikiMeta {
  const bar = inner.indexOf('|')
  const left = bar >= 0 ? inner.slice(0, bar) : inner
  let alias: string | null = bar >= 0 ? inner.slice(bar + 1).trim() : null
  let width: number | null = null
  if (embed && alias !== null && /^\d+(x\d+)?$/.test(alias)) {
    width = parseInt(alias, 10)
    alias = null
  }
  const hash = left.indexOf('#')
  const target = (hash >= 0 ? left.slice(0, hash) : left).trim()
  const frag = hash >= 0 ? left.slice(hash + 1).trim() : null
  const anchor = frag?.startsWith('^') ? frag.slice(1) : null
  const heading = frag !== null && anchor === null ? frag : null
  return { target, heading, anchor, alias: alias || null, width, raw }
}

/** `[[…]]` → wikiref, `![[…]]` → wikiembed. */
function wikiRule(state: StateInline, silent: boolean): boolean {
  const src = state.src
  let pos = state.pos
  const embed = src.charCodeAt(pos) === 0x21 /* ! */
  if (embed) pos++
  if (!src.startsWith('[[', pos)) return false
  const end = src.indexOf(']]', pos + 2)
  if (end < 0) return false
  const inner = src.slice(pos + 2, end)
  if (!inner.trim() || inner.includes('\n') || inner.includes('[[')) return false
  if (!silent) {
    const tok = state.push(embed ? 'wikiembed' : 'wikiref', '', 0)
    tok.meta = parseWikiTarget(inner, src.slice(state.pos, end + 2), embed)
  }
  state.pos = end + 2
  return true
}

/** `==text==` → highlight (inner content parsed as inline). */
function highlightRule(state: StateInline, silent: boolean): boolean {
  const src = state.src
  const start = state.pos
  if (!src.startsWith('==', start) || src.charCodeAt(start + 2) === 0x3d || /\s/.test(src[start + 2] ?? ' ')) return false
  let i = start + 2
  while (i < state.posMax) {
    if (src.charCodeAt(i) === 0x5c /* \ */) {
      i += 2
      continue
    }
    if (src.startsWith('==', i) && !/\s/.test(src[i - 1])) break
    i++
  }
  if (i >= state.posMax || !src.startsWith('==', i)) return false
  if (!silent) {
    const max = state.posMax
    state.push('highlight_open', 'mark', 1)
    state.pos = start + 2
    state.posMax = i
    state.md.inline.tokenize(state)
    state.posMax = max
    state.push('highlight_close', 'mark', -1)
  }
  state.pos = i + 2
  return true
}

/** The only HTML read back: `<u>`, `</u>`, `<br>`. */
function htmlBitsRule(state: StateInline, silent: boolean): boolean {
  const m = /^(<u>|<\/u>|<br\s*\/?>)/i.exec(state.src.slice(state.pos, state.pos + 6))
  if (!m) return false
  if (!silent) {
    const s = m[1].toLowerCase()
    if (s === '<u>') state.push('underline_open', 'u', 1)
    else if (s === '</u>') state.push('underline_close', 'u', -1)
    else state.push('hardbreak', 'br', 0)
  }
  state.pos += m[1].length
  return true
}

function tagRule(state: StateInline, silent: boolean): boolean {
  if (state.src.charCodeAt(state.pos) !== 0x23 /* # */) return false
  const prev = state.pos > 0 ? state.src[state.pos - 1] : ''
  if (prev && NOT_BEFORE_TAG.test(prev)) return false
  const m = TAG_RE.exec(state.src.slice(state.pos))
  if (!m) return false
  if (!silent) state.push('tag', '', 0).meta = { name: m[1] }
  state.pos += m[0].length
  return true
}

/** `$x$` / `$$x$$` inline → code (shown as code until phase 5). Not `$5 and $6`. */
function mathInlineRule(state: StateInline, silent: boolean): boolean {
  const src = state.src
  const start = state.pos
  if (src.charCodeAt(start) !== 0x24) return false
  const fence = src.startsWith('$$', start) ? '$$' : '$'
  const from = start + fence.length
  if (/\s/.test(src[from] ?? ' ')) return false
  let i = from
  while (i < state.posMax) {
    if (src.charCodeAt(i) === 0x5c) {
      i += 2
      continue
    }
    if (src.startsWith(fence, i)) {
      if (!/\s/.test(src[i - 1]) && !/\d/.test(src[i + fence.length] ?? '')) break
    }
    i++
  }
  if (i >= state.posMax || i === from) return false
  if (!silent) state.push('code_inline', 'code', 0).content = src.slice(from, i)
  state.pos = i + fence.length
  return true
}

/** `$$` … `$$` block → fence with language `math`. */
function mathBlockRule(state: StateBlock, startLine: number, endLine: number, silent: boolean): boolean {
  const pos = state.bMarks[startLine] + state.tShift[startLine]
  const max = state.eMarks[startLine]
  const first = state.src.slice(pos, max)
  if (!first.startsWith('$$')) return false
  if (silent) return true
  let content: string
  let next = startLine
  const rest = first.slice(2)
  if (rest.trimEnd().endsWith('$$') && rest.trim().length > 2) {
    content = rest.trimEnd().slice(0, -2)
  } else {
    const lines = rest.trim() ? [rest] : []
    let found = false
    while (++next < endLine) {
      const l = state.src.slice(state.bMarks[next] + state.tShift[next], state.eMarks[next])
      if (l.trimEnd().endsWith('$$')) {
        const before = l.trimEnd().slice(0, -2)
        if (before) lines.push(before)
        found = true
        break
      }
      lines.push(state.src.slice(state.bMarks[next], state.eMarks[next]))
    }
    if (!found) return false
    content = lines.join('\n')
  }
  const tok = state.push('fence', 'code', 0)
  tok.info = 'math'
  tok.content = content + '\n'
  tok.map = [startLine, next + 1]
  state.line = next + 1
  return true
}

/** `[^1]: text` definitions (no footnote support): collected, kept as text at the end. */
function footnoteDefRule(state: StateBlock, startLine: number, _end: number, silent: boolean): boolean {
  const pos = state.bMarks[startLine] + state.tShift[startLine]
  const line = state.src.slice(pos, state.eMarks[startLine])
  if (!/^\[\^[^\]\s]+\]:/.test(line)) return false
  if (silent) return true
  const tok = state.push('footnote_def', '', 0)
  tok.content = line
  tok.map = [startLine, startLine + 1]
  state.line = startLine + 1
  return true
}

/** `- [ ] ` / `- [x] ` at the start of a list item → marks the item (meta.task) and strips the box. */
function taskCoreRule(state: StateCore): void {
  const t = state.tokens
  for (let i = 0; i < t.length; i++) {
    if (t[i].type !== 'list_item_open' || t[i + 1]?.type !== 'paragraph_open' || t[i + 2]?.type !== 'inline') continue
    const inline = t[i + 2]
    const m = /^\[([ xX])\][ \t]+/.exec(inline.content)
    const first = inline.children?.[0]
    if (!m || first?.type !== 'text' || !first.content.startsWith(m[0].trimEnd())) continue
    first.content = first.content.slice(m[0].length > first.content.length ? first.content.length : m[0].length).replace(/^[ \t]+/, '')
    inline.content = inline.content.slice(m[0].length)
    t[i].meta = { ...t[i].meta, task: m[1] !== ' ' }
  }
}

/** CommonMark's flanking rules fail next to CJK punctuation (`文**「粗」**文`): relax them for `*` and `~` around CJK. */
function cjkFriendly(md: MarkdownIt): void {
  const Base = md.inline.State
  class State extends Base {
    scanDelims(start: number, canSplitWord: boolean) {
      const r = super.scanDelims(start, canSplitWord)
      const src = (this as unknown as StateInline).src
      const marker = src.charCodeAt(start)
      if (marker !== 0x2a && marker !== 0x7e) return r
      const before = start > 0 ? src[start - 1] : ' '
      const after = src[start + r.length] ?? ' '
      if (!r.can_open && !/\s/.test(after) && (CJK.test(before) || CJK.test(after))) r.can_open = true
      if (!r.can_close && !/\s/.test(before) && (CJK.test(before) || CJK.test(after))) r.can_close = true
      return r
    }
  }
  md.inline.State = State
}

export function v2Syntax(md: MarkdownIt): void {
  cjkFriendly(md)
  md.inline.ruler.before('link', 'wiki', wikiRule)
  md.inline.ruler.before('emphasis', 'highlight', highlightRule)
  md.inline.ruler.before('html_inline', 'html_bits', htmlBitsRule)
  md.inline.ruler.before('emphasis', 'tag', tagRule)
  md.inline.ruler.before('escape', 'math_inline', mathInlineRule)
  md.block.ruler.before('fence', 'math_block', mathBlockRule, { alt: ['paragraph', 'reference', 'blockquote', 'list'] })
  md.block.ruler.before('reference', 'footnote_def', footnoteDefRule, { alt: ['paragraph', 'reference'] })
  md.core.ruler.after('text_join', 'task', taskCoreRule)
}
