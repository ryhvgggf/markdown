import { blockAnchor, encodeLinkPath } from './paths'
import { escapeText, serializeInline, type InlineContext } from './serialize-inline'
import type { PMNode } from './types'

export type SerializeContext = InlineContext & {
  /** '附件/檔名'; null → 「（找不到附件）」 */
  attachmentPath(attachmentId: string): string | null
  /** Blocks of this note that some block link points at (headings excluded): they get a `^anchor`. */
  anchoredBlocks: Set<string>
}

const CALLOUT = new Set(['info', 'tip', 'warning'])

/** ProseMirror JSON → Markdown (spec 6). Ends with exactly one newline; an empty note is an empty file. */
export function serializeNote(doc: PMNode, ctx: SerializeContext): string {
  const out = blocks(doc.content ?? [], ctx).join('\n')
  return out ? out + '\n' : ''
}

const isEmptyPara = (n: PMNode) => n.type === 'paragraph' && !(n.content ?? []).length

/** Top-level / container blocks, separated by one blank line. Returns lines. */
function blocks(nodes: PMNode[], ctx: SerializeContext): string[] {
  const out: string[] = []
  const alt = alternator()
  for (const n of nodes) {
    if (isEmptyPara(n)) continue
    const lines = block(n, ctx, alt(n))
    if (!lines.length) continue
    if (out.length) out.push('')
    out.push(...lines)
  }
  return out
}

const isList = (n: PMNode) => n.type === 'bulletList' || n.type === 'orderedList' || n.type === 'taskList'

/**
 * Two lists in a row would merge into one when read back: the second uses the other marker
 * (`-` ↔ `*`, `.` ↔ `)`), which CommonMark treats as a new list.
 */
function alternator() {
  let prev: { ordered: boolean; alt: boolean } | null = null
  return (n: PMNode): boolean => {
    if (!isList(n)) {
      prev = null
      return false
    }
    const ordered = n.type === 'orderedList'
    const alt = !!prev && prev.ordered === ordered && !prev.alt
    prev = { ordered, alt }
    return alt
  }
}

const anchorOf = (n: PMNode, ctx: SerializeContext): string | null => {
  const id = n.attrs?.id
  return typeof id === 'string' && ctx.anchoredBlocks.has(id) ? blockAnchor(id) : null
}

function block(n: PMNode, ctx: SerializeContext, altMarker = false): string[] {
  const anchor = n.type === 'heading' ? null : anchorOf(n, ctx)
  const lines = blockBody(n, ctx, altMarker)
  if (!anchor || !lines.length) return lines
  if (n.type === 'paragraph') {
    lines[lines.length - 1] += ` ^${anchor}`
    return lines
  }
  return [...lines, '', `^${anchor}`]
}

function blockBody(n: PMNode, ctx: SerializeContext, altMarker: boolean): string[] {
  const c = n.content ?? []
  switch (n.type) {
    case 'paragraph':
      return serializeInline(c, ctx, { lineStart: true, inTable: false }).split('\n')
    case 'heading': {
      const level = Math.min(3, Math.max(1, Number(n.attrs?.level) || 1))
      const text = serializeInline(c, ctx, { lineStart: false, inTable: false }).replace(/\\\n/g, ' ')
      return [`${'#'.repeat(level)}${text ? ' ' + text : ''}`]
    }
    case 'blockquote':
      return quoted(blocks(c, ctx))
    case 'callout': {
      const icon = CALLOUT.has(String(n.attrs?.icon)) ? String(n.attrs?.icon) : 'info'
      return quoted([`[!${icon}]`, ...blocks(c, ctx)])
    }
    case 'codeBlock': {
      const text = c.map((t) => t.text ?? '').join('')
      const longest = Math.max(0, ...Array.from(text.matchAll(/`{3,}/g), (m) => m[0].length))
      const fence = '`'.repeat(Math.max(3, longest + 1))
      const lang = typeof n.attrs?.language === 'string' ? n.attrs.language : ''
      return [fence + lang, ...(text ? text.split('\n') : []), fence]
    }
    case 'bulletList':
    case 'taskList':
    case 'orderedList':
      return list(n, ctx, altMarker)
    case 'table':
      return table(n, ctx)
    case 'horizontalRule':
      return ['---']
    case 'media':
      return [media(n, ctx)]
    default:
      return c.length ? blocks(c, ctx) : []
  }
}

function quoted(lines: string[]): string[] {
  return lines.map((l) => (l ? '> ' + l : '>'))
}

function media(n: PMNode, ctx: SerializeContext): string {
  const path = ctx.attachmentPath(String(n.attrs?.attachmentId ?? ''))
  if (!path) return '（找不到附件）'
  const name = escapeText(path.split('/').pop() ?? path, { lineStart: false, prev: '', inTable: false })
  const target = encodeLinkPath(path)
  return n.attrs?.kind === 'file' ? `[${name}](${target})` : `![${name}](${target})`
}

function list(n: PMNode, ctx: SerializeContext, altMarker: boolean): string[] {
  const out: string[] = []
  const start = Number(n.attrs?.start) || 1
  const bullet = altMarker ? '* ' : '- '
  ;(n.content ?? []).forEach((item, i) => {
    const marker =
      n.type === 'orderedList'
        ? `${start + i}${altMarker ? ')' : '.'} `
        : item.type === 'taskItem'
          ? bullet + (item.attrs?.checked ? '[x] ' : '[ ] ')
          : bullet
    const indent = ' '.repeat(n.type === 'orderedList' ? marker.length : 2)
    const lines = itemLines(item, ctx)
    const anchor = anchorOf(item, ctx)
    if (anchor) lines[0] = (lines[0] ? lines[0] + ' ' : '') + `^${anchor}`
    lines.forEach((l, j) => out.push(j === 0 ? (marker + l).trimEnd() : l ? indent + l : ''))
  })
  return out
}

/** A list item's blocks: a nested list follows its line directly, anything else after a blank line. */
function itemLines(item: PMNode, ctx: SerializeContext): string[] {
  const out: string[] = []
  const alt = alternator()
  ;(item.content ?? []).forEach((b, i) => {
    const lines = i === 0 && isEmptyPara(b) ? [''] : block(b, ctx, alt(b))
    if (!lines.length) return
    if (i > 0 && !(isList(b) && !isList(item.content![i - 1]))) out.push('')
    out.push(...lines)
  })
  return out.length ? out : ['']
}

function table(n: PMNode, ctx: SerializeContext): string[] {
  const rows = (n.content ?? []).map((r) => (r.content ?? []).map((cell) => cellText(cell, ctx)))
  if (!rows.length) return []
  const cols = Math.max(...rows.map((r) => r.length))
  const line = (r: string[]) => '| ' + Array.from({ length: cols }, (_, i) => r[i] ?? '').join(' | ') + ' |'
  return [line(rows[0]), '| ' + Array(cols).fill('---').join(' | ') + ' |', ...rows.slice(1).map(line)]
}

/** A cell on one line: its blocks' lines joined with `<br>`. */
function cellText(cell: PMNode, ctx: SerializeContext): string {
  const lines: string[] = []
  const walk = (nodes: PMNode[], prefix = '') => {
    for (const b of nodes) {
      if (b.type === 'paragraph' || b.type === 'heading') {
        const t = serializeInline(b.content ?? [], ctx, { lineStart: false, inTable: true })
        if (t || prefix) lines.push(prefix + t)
      } else if (b.type === 'bulletList' || b.type === 'orderedList' || b.type === 'taskList') {
        ;(b.content ?? []).forEach((item, i) => {
          const marker =
            b.type === 'orderedList' ? `${i + 1}. ` : item.type === 'taskItem' ? (item.attrs?.checked ? '- [x] ' : '- [ ] ') : '- '
          const [first, ...rest] = item.content ?? []
          walk(first ? [first] : [], marker)
          walk(rest)
        })
      } else if (b.type === 'codeBlock') {
        lines.push(...(b.content ?? []).map((t) => t.text ?? '').join('').split('\n').map((l) => escapeText(l, { lineStart: false, prev: '', inTable: true })))
      } else walk(b.content ?? [], prefix)
      prefix = ''
    }
  }
  walk(cell.content ?? [])
  return lines.join('<br>')
}
