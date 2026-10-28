import { blockAnchor } from './paths'
import type { PMMark, PMNode } from './types'

/** What the inline serializer needs from the outside world. */
export type InlineContext = {
  noteTitle(noteId: string): string | null
  headingText(noteId: string, blockId: string): string | null
}

/** Outer → inner. Marks not listed (textStyle colour…) are not written. */
const ORDER = ['link', 'bold', 'italic', 'strike', 'underline', 'highlight', 'code'] as const
const OPEN: Record<string, string> = { bold: '**', italic: '*', strike: '~~', underline: '<u>', highlight: '==' }
const CLOSE: Record<string, string> = { bold: '**', italic: '*', strike: '~~', underline: '</u>', highlight: '==' }

const URL_RE = /(?:https?:\/\/|mailto:)[^\s<>]+/g
const ENTITY_RE = /^&(?:#\d+|#x[0-9a-f]+|[a-z][a-z0-9]*);/i
const TAG_START = /[\p{L}\p{N}\p{M}_-]/u
const NOT_BEFORE_TAG = /[A-Za-z0-9_/:&.]/

const markKey = (m: PMMark) => (m.type === 'link' ? `link:${String(m.attrs?.href ?? '')}` : m.type)
const known = (marks: PMMark[] | undefined) =>
  (marks ?? []).filter((m) => (ORDER as readonly string[]).includes(m.type)).sort((a, b) => ORDER.indexOf(a.type as never) - ORDER.indexOf(b.type as never))

export function encodeHref(href: string): string {
  return href.replace(/[ ()<>]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase())
}

/** Backslash-escapes plain text so the parser reads it back as the same text. URLs are left as they are. */
export function escapeText(text: string, o: { lineStart: boolean; prev: string; inTable: boolean }): string {
  let out = ''
  let last = 0
  for (const m of text.matchAll(URL_RE)) {
    out += escapePlain(text.slice(last, m.index), { ...o, lineStart: o.lineStart && m.index === 0 && out === '', prev: out.at(-1) ?? o.prev })
    out += m[0]
    last = m.index + m[0].length
  }
  out += escapePlain(text.slice(last), { ...o, lineStart: o.lineStart && last === 0, prev: out.at(-1) ?? o.prev })
  return out
}

function escapePlain(s: string, o: { lineStart: boolean; prev: string; inTable: boolean }): string {
  let out = ''
  const chars = Array.from(s)
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i]
    const next = chars[i + 1] ?? ''
    const prev = i === 0 ? o.prev : chars[i - 1]
    const atStart = o.lineStart && i === 0 && !o.inTable
    if ('\\*_`[]<~$^|'.includes(c)) out += '\\' + c
    else if (c === '=' && (next === '=' || atStart) && prev !== '=') out += '\\='
    else if (c === '&' && ENTITY_RE.test(chars.slice(i).join(''))) out += '\\&'
    else if (c === '#' && (atStart || !NOT_BEFORE_TAG.test(prev ?? '')) && (atStart || TAG_START.test(next) || next === '' || next === ' ' || next === '#'))
      out += '\\#'
    else if (atStart && (c === '-' || c === '>' || (c === '+' && (next === ' ' || next === '')))) out += '\\' + c
    else out += c
  }
  if (o.lineStart && !o.inTable) {
    // `1. x` / `1) x` at the start of a line would become a list.
    out = out.replace(/^(\d{1,9})([.)])(?=\s|$)/, '$1\\$2')
    // Leading spaces would be dropped (or start a code block).
    out = out.replace(/^ /, '&#32;')
  }
  return out
}

function codeSpan(text: string): string {
  const longest = Math.max(0, ...Array.from(text.matchAll(/`+/g), (m) => m[0].length))
  const fence = '`'.repeat(longest + 1)
  const pad = text.startsWith('`') || text.endsWith('`') ? ' ' : ''
  return fence + pad + text + pad + fence
}

function atomText(n: PMNode, ctx: InlineContext): string {
  if (n.type === 'noteLink') {
    const noteId = String(n.attrs?.noteId ?? '')
    const blockId = (n.attrs?.blockId as string | null) ?? null
    const title = ctx.noteTitle(noteId)
    if (title === null) return '（已刪除的筆記）'
    const label = typeof n.attrs?.label === 'string' && n.attrs.label.trim() ? `|${n.attrs.label.replace(/[[\]|\r\n]+/g, ' ').trim()}` : ''
    if (!blockId) return `[[${title}${label}]]`
    const heading = ctx.headingText(noteId, blockId)
    return heading !== null ? `[[${title}#${heading}${label}]]` : `[[${title}#^${blockAnchor(blockId)}${label}]]`
  }
  if (n.type === 'tag') return '#' + String(n.attrs?.name ?? '')
  return ''
}

/**
 * Inline content → Markdown. Marks open and close once across adjacent nodes, in a fixed nesting
 * order; spaces at the edge of a marked run are moved outside it (CommonMark flanking rules).
 * Hard breaks: `\` + newline, or `<br>` inside a table cell.
 */
export function serializeInline(nodes: PMNode[], ctx: InlineContext, o: { lineStart: boolean; inTable: boolean }): string {
  // A link whose text is its own URL is written bare (linkify reads it back as the same link).
  const items = nodes.map((n, i) => {
    const marks = known(n.marks)
    const link = marks.find((m) => m.type === 'link')
    const sameLink = (x?: PMNode) => !!x?.marks?.some((m) => m.type === 'link' && m.attrs?.href === link?.attrs?.href)
    const bare = !!link && n.type === 'text' && n.text === link.attrs?.href && marks.length === 1 && !sameLink(nodes[i - 1]) && !sameLink(nodes[i + 1])
    return { node: n, marks: bare ? [] : marks, bare }
  })

  let out = ''
  let lineStart = o.lineStart
  let open: PMMark[] = []
  const closeTo = (k: number) => {
    if (open.length <= k) return
    const ws = /\s+$/.exec(out)?.[0] ?? ''
    out = out.slice(0, out.length - ws.length)
    for (let j = open.length - 1; j >= k; j--) {
      const m = open[j]
      out += m.type === 'link' ? `](${encodeHref(String(m.attrs?.href ?? ''))})` : m.type === 'code' ? '' : CLOSE[m.type]
    }
    out += ws
    open = open.slice(0, k)
  }

  for (const { node, marks, bare } of items) {
    if (node.type === 'hardBreak') {
      closeTo(0)
      out = out.replace(/[ \t]+$/, '')
      out += o.inTable ? '<br>' : '\\\n'
      lineStart = !o.inTable
      continue
    }
    let k = 0
    while (k < open.length && k < marks.length && markKey(open[k]) === markKey(marks[k])) k++
    closeTo(k)
    let text = node.type === 'text' ? (node.text ?? '') : atomText(node, ctx)
    const isCode = marks.some((m) => m.type === 'code')
    if (marks.length > k) {
      const lead = /^\s+/.exec(text)?.[0] ?? ''
      out += lead
      text = text.slice(lead.length)
      for (const m of marks.slice(k)) out += m.type === 'link' ? '[' : m.type === 'code' ? '' : OPEN[m.type]
      open = marks
    }
    if (isCode) out += codeSpan(text)
    else if (node.type !== 'text' || bare) out += text
    else out += escapeText(text, { lineStart: lineStart && (out === '' || out.endsWith('\n')), prev: out.at(-1) ?? '', inTable: o.inTable })
    if (text) lineStart = false
  }
  closeTo(0)
  return out
    .split('\n')
    .map((l) => (l.endsWith('\\') ? l : l.replace(/[ \t]+$/, '')))
    .join('\n')
}
