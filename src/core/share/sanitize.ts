import type { PMMark, PMNode } from '@/core/markdown/types'

/** Shown where an attachment was. */
export const ATTACHMENT_OMITTED_TEXT = '附件未包含'

/**
 * Allow-list for what a share link may contain (phase 4 todo 3). The share page lives on the app's own origin
 * and its content comes from someone else, so a snapshot is treated as untrusted data: only the block and mark
 * types the editor knows, with only the attributes below, survive. Everything else is dropped (not an error).
 * `media` becomes a placeholder and `noteLink` plain text. Pure data in, pure data out; the schema check that
 * follows (in the share page) catches whatever structure is still wrong.
 */

/** Must equal `TEXT_COLORS` / `HIGHLIGHT_COLORS` in the editor's formatting (a test keeps them in step). */
export const SHARE_TEXT_COLORS = ['#6E6E73', '#C62828', '#B45309', '#1F7A4D', '#1E5FB8', '#7B3FC4']
export const SHARE_HIGHLIGHT_COLORS = ['#FFF1A8', '#CDEFD3', '#CFE3FB', '#FBD3DE', '#E2D6F8', '#FFDDB5']

export const MAX_DEPTH = 40
export const MAX_NODES = 200_000
const MAX_URL = 4096

type Attrs = Record<string, unknown>
type AttrRule = (v: unknown) => unknown | undefined // undefined = drop the attribute (schema default applies)

const int = (min: number, max: number): AttrRule => (v) => (typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : undefined)
const oneOf = (...allowed: Array<string | null>): AttrRule => (v) => (allowed.includes(v as string | null) ? v : undefined)
const str = (max: number, re?: RegExp): AttrRule => (v) => (typeof v === 'string' && v.length <= max && (!re || re.test(v)) ? v : undefined)
const bool: AttrRule = (v) => (typeof v === 'boolean' ? v : undefined)
const colwidth: AttrRule = (v) =>
  v === null || (Array.isArray(v) && v.length <= 100 && v.every((n) => typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= 5000)) ? v : undefined

const id = str(64, /^[\w-]+$/)
const cell: Record<string, AttrRule> = { colspan: int(1, 100), rowspan: int(1, 100), colwidth, align: oneOf(null, 'left', 'center', 'right') }

type Spec = { attrs: Record<string, AttrRule>; leaf?: true; inline?: true; keepIfEmpty?: 'paragraph' | 'drop' }
const SPECS: Record<string, Spec> = {
  paragraph: { attrs: { id }, inline: true },
  heading: { attrs: { id, level: int(1, 6) }, inline: true },
  blockquote: { attrs: { id }, keepIfEmpty: 'paragraph' },
  callout: { attrs: { id, icon: oneOf('info', 'warning', 'tip') }, keepIfEmpty: 'paragraph' },
  codeBlock: { attrs: { id, language: (v) => (v === null ? null : str(40, /^[\w+#.-]*$/)(v)) }, inline: true },
  horizontalRule: { attrs: { id }, leaf: true },
  hardBreak: { attrs: {}, leaf: true },
  table: { attrs: { id }, keepIfEmpty: 'drop' },
  tableRow: { attrs: {}, keepIfEmpty: 'drop' },
  tableHeader: { attrs: cell, keepIfEmpty: 'paragraph' },
  tableCell: { attrs: cell, keepIfEmpty: 'paragraph' },
  bulletList: { attrs: { id }, keepIfEmpty: 'drop' },
  orderedList: {
    attrs: { id, start: int(0, 1_000_000), type: oneOf(null, '1', 'a', 'A', 'i', 'I'), listStyle: oneOf('auto', 'decimal', 'alpha', 'roman') },
    keepIfEmpty: 'drop',
  },
  listItem: { attrs: { id }, keepIfEmpty: 'paragraph' },
  taskList: { attrs: { id }, keepIfEmpty: 'drop' },
  taskItem: { attrs: { id, checked: bool }, keepIfEmpty: 'paragraph' },
  tag: { attrs: { name: str(200) }, leaf: true },
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

function cleanAttrs(raw: unknown, rules: Record<string, AttrRule>): Attrs | undefined {
  if (!isObj(raw)) return undefined
  const out: Attrs = {}
  for (const [k, rule] of Object.entries(rules)) {
    if (!(k in raw)) continue
    const v = rule(raw[k])
    if (v !== undefined) out[k] = v
  }
  return Object.keys(out).length ? out : undefined
}

const hasControlChar = (s: string) => [...s].some((c) => c.charCodeAt(0) <= 0x1f || c.charCodeAt(0) === 0x7f)
const safeHref = (v: unknown): string | undefined =>
  typeof v === 'string' && v.length <= MAX_URL && /^(https?:\/\/|mailto:)\S+$/i.test(v) && !hasControlChar(v) ? v : undefined

function cleanMark(m: unknown): PMMark | null {
  if (!isObj(m) || typeof m.type !== 'string') return null
  const attrs = isObj(m.attrs) ? m.attrs : {}
  switch (m.type) {
    case 'bold':
    case 'italic':
    case 'underline':
    case 'strike':
    case 'code':
      return { type: m.type }
    case 'link': {
      const href = safeHref(attrs.href)
      return href ? { type: 'link', attrs: { href } } : null
    }
    case 'textStyle':
      return SHARE_TEXT_COLORS.includes(attrs.color as string) ? { type: 'textStyle', attrs: { color: attrs.color } } : null
    case 'highlight':
      return SHARE_HIGHLIGHT_COLORS.includes(attrs.color as string) ? { type: 'highlight', attrs: { color: attrs.color } } : null
    default:
      return null
  }
}

function cleanMarks(raw: unknown): PMMark[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const seen = new Set<string>()
  const out: PMMark[] = []
  for (const m of raw.slice(0, 20)) {
    const c = cleanMark(m)
    if (c && !seen.has(c.type)) {
      seen.add(c.type)
      out.push(c)
    }
  }
  return out.length ? out : undefined
}

const paragraph = (text?: string, italic = false): PMNode => ({
  type: 'paragraph',
  ...(text && { content: [{ type: 'text', text, ...(italic && { marks: [{ type: 'italic' }] }) }] }),
})

/** Nodes left for one snapshot; a multi-note snapshot shares one budget across all its notes. */
export type SanitizeBudget = { nodes: number }
export const newSanitizeBudget = (): SanitizeBudget => ({ nodes: MAX_NODES })

const MAX_LABEL = 2000

export interface SanitizeOptions {
  /**
   * Multi-note snapshots only: the in-snapshot codes (`n0`, `n1`…) a `noteLink` may point at. A link to one of
   * them stays a link (code, optional block id, label); every other `noteLink` becomes plain text as before.
   */
  linkTargets?: ReadonlySet<string>
  budget?: SanitizeBudget
}

/** The allow-listed copy of a snapshot document. Always returns a document (an empty one for anything that is not). */
export function sanitizeShareDoc(input: unknown, opts: SanitizeOptions = {}): PMNode {
  const budget = opts.budget ?? newSanitizeBudget()
  const targets = opts.linkTargets

  const visit = (raw: unknown, depth: number, parent: string): PMNode[] => {
    if (!isObj(raw) || typeof raw.type !== 'string' || depth > MAX_DEPTH || budget.nodes <= 0) return []
    budget.nodes--
    const type = raw.type

    if (type === 'text') {
      if (typeof raw.text !== 'string' || raw.text === '') return []
      const marks = parent === 'codeBlock' ? undefined : cleanMarks(raw.marks)
      return [{ type: 'text', text: raw.text, ...(marks && { marks }) }]
    }
    if (type === 'media') return [paragraph(ATTACHMENT_OMITTED_TEXT, true)]
    if (type === 'noteLink') {
      const a = isObj(raw.attrs) ? raw.attrs : {}
      const label = typeof a.label === 'string' ? a.label.slice(0, MAX_LABEL) : ''
      if (!label) return []
      const marks = parent === 'codeBlock' ? undefined : cleanMarks(raw.marks)
      if (parent !== 'codeBlock' && targets && typeof a.noteId === 'string' && targets.has(a.noteId)) {
        const blockId = a.blockId === null || a.blockId === undefined ? null : id(a.blockId)
        if (blockId !== undefined) return [{ type: 'noteLink', attrs: { noteId: a.noteId, blockId, label }, ...(marks && { marks }) }]
      }
      return [{ type: 'text', text: label, ...(marks && { marks }) }]
    }

    const spec = Object.hasOwn(SPECS, type) ? SPECS[type] : undefined
    if (!spec) return []
    const attrs = cleanAttrs(raw.attrs, spec.attrs)
    if (spec.leaf) return [{ type, ...(attrs && { attrs }) }]

    const children = Array.isArray(raw.content) ? raw.content.flatMap((c) => visit(c, depth + 1, type)) : []
    if (children.length === 0 && !spec.inline) {
      if (spec.keepIfEmpty === 'drop') return []
      return [{ type, ...(attrs && { attrs }), content: [paragraph()] }]
    }
    return [{ type, ...(attrs && { attrs }), ...(children.length && { content: children }) }]
  }

  const root = isObj(input) && input.type === 'doc' && Array.isArray(input.content) ? input.content.flatMap((c) => visit(c, 1, 'doc')) : []
  return { type: 'doc', content: root.length ? root : [paragraph()] }
}
