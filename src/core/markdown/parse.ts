import MarkdownItCtor, { type MarkdownIt, type Token } from 'markdown-it'
import { assignBlockIds } from '../blocks'
import { splitFrontmatter } from './frontmatter'
import { v2Syntax, type WikiMeta } from './md-plugins'
import { encodeLinkPath } from './paths'
import type { ParseResult, PMMark, PMNode } from './types'
import { v1Dialect } from './v1-dialect'

const HIGHLIGHT = '#FFF1A8'
const CALLOUT_TIP = new Set(['tip', 'hint', 'important', 'success', 'check', 'done'])
const CALLOUT_WARN = new Set(['warning', 'caution', 'attention', 'danger', 'error', 'failure', 'fail', 'missing', 'bug'])
const ANCHOR_RE = /(?:^|[ \t])\^([A-Za-z0-9-]+)[ \t]*$/
const EXTERNAL = /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i
/** markdown-it percent-encodes hrefs; undo it (reserved characters stay encoded). */
const unencode = (href: string) => {
  try {
    return decodeURI(href)
  } catch {
    return href
  }
}

const makeMd = (v1: boolean) => {
  const md = new MarkdownItCtor({ html: false, linkify: true })
  md.use(v2Syntax)
  if (v1) md.use(v1Dialect)
  return md
}
let mdPlain: MarkdownIt | undefined
let mdV1: MarkdownIt | undefined

/** Markdown → ProseMirror JSON in the editor's schema, with `wikiRef` / `embedRef` placeholders (see resolveRefs). */
export function parseMarkdown(src: string, opts: { dialect?: 'v1' } = {}): ParseResult {
  let text = src.replace(/^\ufeff/, '').replace(/\r\n?/g, '\n')
  const fm = splitFrontmatter(text)
  if (fm) text = fm.body
  const md = opts.dialect === 'v1' ? (mdV1 ??= makeMd(true)) : (mdPlain ??= makeMd(false))
  const tokens = md.parse(text, {})
  const lossy = new Set<string>()
  const footnotes: string[] = []
  const conv = new Converter(tokens, lossy, footnotes)
  const content = conv.blocks(0, tokens.length)
  if (footnotes.length) {
    lossy.add('註腳')
    content.push(para([{ type: 'text', text: '註腳', marks: [{ type: 'bold' }] }]), ...footnotes.map((f) => para([{ type: 'text', text: f }])))
  }
  if (!content.length) content.push({ type: 'paragraph' })
  return {
    doc: assignBlockIds({ type: 'doc', content }),
    tags: fm?.fm.tags ?? [],
    created: fm?.fm.created ?? null,
    updated: fm?.fm.updated ?? null,
    lossy: [...lossy],
  }
}

const para = (content: PMNode[], attrs?: Record<string, unknown>): PMNode =>
  ({ type: 'paragraph', ...(attrs && { attrs }), ...(content.length && { content }) })

const ref = (type: 'wikiRef' | 'embedRef', m: WikiMeta): PMNode => ({ type, attrs: { ...m } })

class Converter {
  constructor(
    private readonly t: Token[],
    private readonly lossy: Set<string>,
    private readonly footnotes: string[],
  ) {}

  /** Index of the token closing the one opened at `i`. */
  private close(i: number): number {
    let depth = 0
    for (let j = i; j < this.t.length; j++) {
      depth += this.t[j].nesting
      if (depth === 0) return j
    }
    return this.t.length - 1
  }

  blocks(from: number, to: number): PMNode[] {
    const out: PMNode[] = []
    for (let i = from; i < to; ) {
      const tok = this.t[i]
      const end = tok.nesting === 1 ? this.close(i) : i
      const node = this.block(tok, i, end)
      if (node === 'anchor-line') {
        // A paragraph that is only `^anchor`: the id of the block before it.
        const id = ANCHOR_RE.exec(this.t[i + 1].content.trim())![1]
        const prev = out.at(-1)
        if (prev) prev.attrs = { ...prev.attrs, id }
      } else if (node) out.push(node)
      i = end + 1
    }
    return out
  }

  private block(tok: Token, i: number, end: number): PMNode | null | 'anchor-line' {
    switch (tok.type) {
      case 'paragraph_open': {
        const inl = this.t[i + 1]
        if (/^\^[A-Za-z0-9-]+$/.test(inl.content.trim())) return 'anchor-line'
        return this.paragraph(inl)
      }
      case 'heading_open': {
        const level = Math.min(3, Number(tok.tag.slice(1)) || 1)
        const content = this.inline(this.t[i + 1]).filter((n) => n.type !== 'hardBreak')
        return { type: 'heading', attrs: { level }, ...(content.length && { content }) }
      }
      case 'blockquote_open':
        return this.quote(this.blocks(i + 1, end))
      case 'bullet_list_open':
      case 'ordered_list_open':
        return this.list(tok, i, end)
      case 'fence':
      case 'code_block': {
        const text = tok.content.replace(/\n$/, '')
        const language = tok.type === 'fence' ? tok.info.trim().split(/\s+/)[0] || null : null
        return { type: 'codeBlock', attrs: { language }, ...(text && { content: [{ type: 'text', text }] }) }
      }
      case 'hr':
        return { type: 'horizontalRule' }
      case 'table_open':
        return this.table(i, end)
      case 'footnote_def':
        this.footnotes.push(tok.content)
        return null
      default:
        return null
    }
  }

  /** A paragraph, taking a trailing ` ^anchor` as its id. */
  private paragraph(inl: Token): PMNode {
    const nodes = this.inline(inl)
    const m = ANCHOR_RE.exec(inl.content)
    if (m) {
      const last = nodes.at(-1)
      if (last?.type === 'text' && last.text) {
        last.text = last.text.replace(/[ \t]*\^[A-Za-z0-9-]+[ \t]*$/, '')
        if (!last.text) nodes.pop()
        return para(nodes, { id: m[1] })
      }
    }
    return para(nodes)
  }

  private quote(content: PMNode[]): PMNode {
    const first = content[0]
    if (first?.type === 'paragraph') {
      const inl = first.content ?? []
      const br = inl.findIndex((n) => n.type === 'hardBreak')
      const line = br >= 0 ? inl.slice(0, br) : inl
      const lineText = line.map((n) => n.text ?? '').join('')
      const m = /^\[!([\w-]+)\]([+-])?[ \t]*(.*)$/.exec(lineText)
      if (m && line.every((n) => n.type === 'text')) {
        const kind = m[1].toLowerCase()
        const icon = CALLOUT_TIP.has(kind) ? 'tip' : CALLOUT_WARN.has(kind) ? 'warning' : 'info'
        const rest = br >= 0 ? inl.slice(br + 1) : []
        const head: PMNode[] = []
        if (m[3].trim()) head.push(para([{ type: 'text', text: m[3].trim(), marks: [{ type: 'bold' }] }]))
        if (rest.length) head.push(para(rest, first.attrs))
        const body = [...head, ...content.slice(1)]
        return { type: 'callout', attrs: { icon }, content: body.length ? body : [para([])] }
      }
    }
    return { type: 'blockquote', content: content.length ? content : [para([])] }
  }

  private list(tok: Token, i: number, end: number): PMNode {
    const items: Array<{ node: PMNode; task: boolean | undefined }> = []
    for (let j = i + 1; j < end; ) {
      const itemEnd = this.close(j)
      const content = this.blocks(j + 1, itemEnd)
      const task = (this.t[j].meta as { task?: boolean } | null)?.task
      let attrs: Record<string, unknown> | undefined
      // `- a ^id`: the anchor on the item's line belongs to the item.
      if (content[0]?.type === 'paragraph' && content[0].attrs?.id) {
        attrs = { id: content[0].attrs.id }
        content[0] = { ...content[0], attrs: undefined }
        delete content[0].attrs
      }
      if (content[0]?.type !== 'paragraph') content.unshift({ type: 'paragraph' })
      items.push({ node: { type: 'listItem', ...(attrs && { attrs }), content }, task })
      j = itemEnd + 1
    }
    const allTasks = tok.type === 'bullet_list_open' && items.length > 0 && items.every((x) => x.task !== undefined)
    if (allTasks) {
      return {
        type: 'taskList',
        content: items.map(({ node, task }) => ({ ...node, type: 'taskItem', attrs: { ...node.attrs, checked: !!task } })),
      }
    }
    for (const { node, task } of items) {
      if (task === undefined) continue
      const p = node.content![0]
      p.content = [{ type: 'text', text: task ? '[x] ' : '[ ] ' }, ...(p.content ?? [])]
    }
    const start = Number(tok.attrGet('start') ?? 1)
    const attrs = tok.type === 'ordered_list_open' && start !== 1 ? { start } : undefined
    return { type: tok.type === 'ordered_list_open' ? 'orderedList' : 'bulletList', ...(attrs && { attrs }), content: items.map((x) => x.node) }
  }

  private table(i: number, end: number): PMNode {
    const rows: PMNode[] = []
    for (let j = i; j < end; j++) {
      if (this.t[j].type !== 'tr_open') continue
      const trEnd = this.close(j)
      const cells: PMNode[] = []
      for (let k = j + 1; k < trEnd; k++) {
        const c = this.t[k]
        if (c.type !== 'th_open' && c.type !== 'td_open') continue
        const content = this.inline(this.t[k + 1])
        cells.push({ type: c.type === 'th_open' ? 'tableHeader' : 'tableCell', content: [para(content)] })
        k = this.close(k)
      }
      rows.push({ type: 'tableRow', content: cells })
      j = trEnd
    }
    return { type: 'table', content: rows }
  }

  /** Inline tokens → text nodes with marks, atoms and refs; adjacent equal-mark text merged. */
  inline(tok: Token): PMNode[] {
    this.noteLossy(tok.content)
    const out: PMNode[] = []
    const marks: PMMark[] = []
    const kids = tok.children ?? []
    const push = (n: PMNode) => {
      const prev = out.at(-1)
      if (n.type === 'text' && prev?.type === 'text' && JSON.stringify(prev.marks ?? []) === JSON.stringify(n.marks ?? [])) prev.text += n.text ?? ''
      else out.push(n)
    }
    const text = (s: string, extra?: PMMark) => {
      if (!s) return
      const m = extra ? [...marks, extra] : [...marks]
      push(m.length ? { type: 'text', text: s, marks: m } : { type: 'text', text: s })
    }
    const pop = (type: string) => {
      const k = marks.map((m) => m.type).lastIndexOf(type)
      if (k >= 0) marks.splice(k, 1)
    }
    for (let i = 0; i < kids.length; i++) {
      const k = kids[i]
      switch (k.type) {
        case 'text':
        case 'text_special':
          text(k.content)
          break
        case 'softbreak':
        case 'hardbreak':
          push({ type: 'hardBreak' })
          break
        case 'strong_open': marks.push({ type: 'bold' }); break
        case 'strong_close': pop('bold'); break
        case 'em_open': marks.push({ type: 'italic' }); break
        case 'em_close': pop('italic'); break
        case 's_open': marks.push({ type: 'strike' }); break
        case 's_close': pop('strike'); break
        case 'underline_open': marks.push({ type: 'underline' }); break
        case 'underline_close': pop('underline'); break
        case 'highlight_open': marks.push({ type: 'highlight', attrs: { color: HIGHLIGHT } }); break
        case 'highlight_close': pop('highlight'); break
        case 'code_inline':
          text(k.content, { type: 'code' })
          break
        case 'tag':
          push({ type: 'tag', attrs: { name: (k.meta as { name: string }).name } })
          break
        case 'wikiref':
          push(ref('wikiRef', k.meta as WikiMeta))
          break
        case 'wikiembed':
          push(ref('embedRef', k.meta as WikiMeta))
          break
        case 'image': {
          const href = unencode(String(k.attrGet('src') ?? ''))
          const alt = k.content
          if (EXTERNAL.test(href)) text(alt || href, { type: 'link', attrs: { href } })
          else push(ref('embedRef', { target: href, heading: null, anchor: null, alias: alt || null, width: null, raw: `![${alt}](${encodeLinkPath(href)})` }))
          break
        }
        case 'link_open': {
          const href = unencode(String(k.attrGet('href') ?? ''))
          if (EXTERNAL.test(href)) {
            marks.push({ type: 'link', attrs: { href } })
            break
          }
          // A relative link: another note (.md) or an attachment.
          let j = i + 1
          let label = ''
          while (j < kids.length && kids[j].type !== 'link_close') label += kids[j++].content
          const path = href
          const raw = `[${label}](${encodeLinkPath(href)})`
          if (/\.md$/i.test(path)) {
            const target = path.split('/').pop()!.replace(/\.md$/i, '')
            push(ref('wikiRef', { target, heading: null, anchor: null, alias: label || null, width: null, raw }))
          } else push(ref('embedRef', { target: path, heading: null, anchor: null, alias: label || null, width: null, raw }))
          i = j
          break
        }
        case 'link_close':
          pop('link')
          break
        default:
          text(k.content)
      }
    }
    while (out.at(-1)?.type === 'hardBreak') out.pop()
    return out
  }

  private noteLossy(src: string) {
    const html = src.match(/<\/?[a-z][^>]*>/gi)?.filter((h) => !/^<\/?u>$|^<br\s*\/?>$/i.test(h))
    if (html?.length) this.lossy.add('HTML')
    if (/(^|[^~\\])~[^~\s]([^~]*[^~\s])?~(?!~)/.test(src)) this.lossy.add('下標')
    if (/(^|[^\\])\^[^^\s]+\^/.test(src)) this.lossy.add('上標')
  }
}
