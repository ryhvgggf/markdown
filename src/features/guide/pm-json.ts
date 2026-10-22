/** Tiny builders for ProseMirror JSON in the editor's schema (used by the built-in guide notes). */

export type Mark = { type: string; attrs?: Record<string, unknown> }
export type J = { type: string; attrs?: Record<string, unknown>; content?: J[]; marks?: Mark[]; text?: string }
export type Inline = string | J | Inline[]

function flat(parts: Inline[]): J[] {
  const out: J[] = []
  for (const p of parts) {
    if (Array.isArray(p)) out.push(...flat(p))
    else if (typeof p === 'string') {
      if (p) out.push({ type: 'text', text: p })
    } else if (p.type !== 'text' || p.text) out.push(p)
  }
  return out
}

const withContent = (type: string, content: J[], attrs?: Record<string, unknown>): J =>
  content.length ? { type, ...(attrs && { attrs }), content } : { type, ...(attrs && { attrs }) }

// ---- inline ----
const marked = (text: string, ...marks: Mark[]): J => ({ type: 'text', text, marks })
export const b = (s: string) => marked(s, { type: 'bold' })
export const i = (s: string) => marked(s, { type: 'italic' })
export const u = (s: string) => marked(s, { type: 'underline' })
export const s = (t: string) => marked(t, { type: 'strike' })
export const code = (t: string) => marked(t, { type: 'code' })
export const color = (t: string, hex: string) => marked(t, { type: 'textStyle', attrs: { color: hex } })
export const hl = (t: string, hex: string) => marked(t, { type: 'highlight', attrs: { color: hex } })
export const a = (t: string, href: string) =>
  marked(t, { type: 'link', attrs: { href, target: '_blank', rel: 'noopener noreferrer nofollow' } })
export const noteLink = (noteId: string, blockId: string | null = null): J => ({ type: 'noteLink', attrs: { noteId, blockId } })
export const tag = (name: string): J => ({ type: 'tag', attrs: { name } })
/** `Ctrl+B`／`⌘B` */
export const keys = (win: string, mac?: string): Inline[] => (mac ? [code(win), '／', code(mac)] : [code(win)])

// ---- blocks ----
/** `id` is optional everywhere: missing block ids are filled in by `assignBlockIds`. */
export const p = (...c: Inline[]): J => withContent('paragraph', flat(c))
export const h = (level: 1 | 2 | 3, ...c: Inline[]): J => withContent('heading', flat(c), { level })
export const hid = (id: string, level: 1 | 2 | 3, ...c: Inline[]): J => withContent('heading', flat(c), { level, id })
export const hr = (): J => ({ type: 'horizontalRule' })
export const quote = (...blocks: J[]): J => ({ type: 'blockquote', content: blocks })
export const callout = (icon: 'info' | 'warning' | 'tip', ...blocks: J[]): J => ({ type: 'callout', attrs: { icon }, content: blocks })
export const codeBlock = (language: string | null, text: string, id?: string): J =>
  withContent('codeBlock', flat([text]), { language, ...(id && { id }) })
export const media = (attachmentId: string, kind: 'image' | 'video', width: number | null = null): J => ({
  type: 'media',
  attrs: { attachmentId, kind, width },
})

/** A list item: first argument is its line, the rest are nested blocks (e.g. a sub-list). */
export const li = (line: Inline, ...children: J[]): J => ({ type: 'listItem', content: [p(line), ...children] })
export const ul = (...items: Array<Inline | J>): J => ({ type: 'bulletList', content: items.map(asItem) })
export const ol = (...items: Array<Inline | J>): J => ({ type: 'orderedList', content: items.map(asItem) })
function asItem(x: Inline | J): J {
  return typeof x === 'object' && !Array.isArray(x) && x.type === 'listItem' ? x : li(x as Inline)
}
export const task = (checked: boolean, line: Inline, ...children: J[]): J => ({
  type: 'taskItem',
  attrs: { checked },
  content: [p(line), ...children],
})
export const tasks = (...items: J[]): J => ({ type: 'taskList', content: items })

const cell = (type: 'tableHeader' | 'tableCell', c: Inline): J => ({ type, content: [p(c)] })
/** First row is the header row. */
export const table = (header: Inline[], rows: Inline[][], id?: string): J => ({
  type: 'table',
  ...(id && { attrs: { id } }),
  content: [
    { type: 'tableRow', content: header.map((c) => cell('tableHeader', c)) },
    ...rows.map((r) => ({ type: 'tableRow', content: r.map((c) => cell('tableCell', c)) })),
  ],
})

export const doc = (...blocks: J[]): J => ({ type: 'doc', content: blocks })

/** Gives every block type that carries an id (see BLOCK_TYPES) a fresh one when it has none. */
export function assignBlockIds(node: J, blockTypes: readonly string[], newId: () => string): J {
  const attrs = blockTypes.includes(node.type) && !node.attrs?.id ? { ...node.attrs, id: newId() } : node.attrs
  return {
    ...node,
    ...(attrs && { attrs }),
    ...(node.content && { content: node.content.map((c) => assignBlockIds(c, blockTypes, newId)) }),
  }
}
