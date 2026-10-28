import type { MediaKind } from '@/core/attachments'
import type { PMNode, RefNode } from '@/core/markdown/types'

export type Resolver = {
  /** Note id for a link target (a title), or null. */
  note(title: string): string | null
  heading(noteId: string, text: string): string | null
  block(noteId: string, anchor: string): string | null
  /** Attachment for an embed target, relative to the note at `fromPath`. */
  attachment(target: string, fromPath: string): { id: string; kind: MediaKind } | null
}

export type Resolved = { doc: PMNode; unresolved: string[]; aliased: string[]; missing: string[] }

/** Blocks whose content must start with a paragraph. */
const NEEDS_LEADING_PARA = new Set(['listItem', 'taskItem'])

const isBlank = (n: PMNode) => n.type === 'text' && !(n.text ?? '').trim()

/**
 * Replaces parse() placeholders: `wikiRef` → note / block link (or its original text when the note is
 * unknown), `embedRef` → media block (lifted out of its paragraph, splitting it) or「（找不到附件：x）」.
 */
export function resolveRefs(doc: PMNode, r: Resolver, fromPath = ''): Resolved {
  const out: Resolved = { doc, unresolved: [], aliased: [], missing: [] }

  const inline = (n: PMNode, inParagraph: boolean): PMNode => {
    const ref = n as unknown as RefNode
    if (n.type === 'wikiRef') {
      const a = ref.attrs
      const noteId = r.note(a.target)
      if (!noteId) {
        out.unresolved.push(a.raw)
        return { type: 'text', text: a.raw }
      }
      if (a.alias) out.aliased.push(a.raw)
      const blockId = a.heading ? r.heading(noteId, a.heading) : a.anchor ? r.block(noteId, a.anchor) : null
      return { type: 'noteLink', attrs: { noteId, blockId } }
    }
    if (n.type === 'embedRef') {
      const a = ref.attrs
      const hit = r.attachment(a.target, fromPath)
      if (!hit || !inParagraph) {
        if (!hit) out.missing.push(a.target)
        return { type: 'text', text: hit ? a.raw : `（找不到附件：${a.target}）` }
      }
      return { type: 'media', attrs: { attachmentId: hit.id, kind: hit.kind, width: a.width } }
    }
    return n
  }

  /** A paragraph holding media nodes → [paragraph?, media, paragraph?…]. */
  const splitParagraph = (p: PMNode, kids: PMNode[]): PMNode[] => {
    if (!kids.some((k) => k.type === 'media')) return [{ ...p, content: kids }]
    const parts: PMNode[] = []
    let run: PMNode[] = []
    let first = true
    const flush = () => {
      while (run.length && (isBlank(run[0]) || run[0].type === 'hardBreak')) run.shift()
      while (run.length && (isBlank(run[run.length - 1]) || run[run.length - 1].type === 'hardBreak')) run.pop()
      if (run.length) {
        parts.push({ type: 'paragraph', ...(first && p.attrs && { attrs: p.attrs }), content: run })
        first = false
      }
      run = []
    }
    for (const k of kids) {
      if (k.type === 'media') {
        flush()
        parts.push(k)
      } else run.push(k)
    }
    flush()
    return parts
  }

  const walk = (n: PMNode): PMNode[] => {
    if (!n.content) return [n]
    if (n.type === 'paragraph') return splitParagraph(n, n.content.map((k) => inline(k, true)))
    if (n.content.some((k) => k.type === 'text' || k.type === 'wikiRef' || k.type === 'embedRef' || k.type === 'hardBreak')) {
      return [{ ...n, content: n.content.map((k) => inline(k, false)) }]
    }
    let content = n.content.flatMap(walk)
    if (NEEDS_LEADING_PARA.has(n.type) && content[0]?.type !== 'paragraph') content = [{ type: 'paragraph' }, ...content]
    return [{ ...n, content }]
  }

  out.doc = walk(doc)[0]
  return out
}
