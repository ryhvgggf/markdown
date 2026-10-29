import type { Node as PMNode } from '@tiptap/pm/model'

export interface Match {
  from: number
  to: number
}

/**
 * Case-insensitive plain-text matches of `query` inside one textblock (paragraph, heading, list item
 * text, table cell paragraph, …), reported as absolute document positions. Walking the block's own text
 * runs (rather than using `textContent`'s offsets directly) keeps positions correct across mark
 * boundaries — e.g. a query that spans "hel" (bold) + "lo" (plain) inside one paragraph is still found —
 * and across any non-text inline nodes (which contribute no characters but do occupy a position).
 */
function matchesInTextblock(node: PMNode, blockStart: number, needle: string): Match[] {
  const chars: string[] = []
  const pos: number[] = []
  node.descendants((child, offset) => {
    if (child.isText && child.text) {
      for (let i = 0; i < child.text.length; i++) {
        chars.push(child.text[i])
        pos.push(blockStart + 1 + offset + i)
      }
    }
    return true
  })
  const text = chars.join('').toLowerCase()
  const q = needle.toLowerCase()
  const out: Match[] = []
  let idx = 0
  while (true) {
    const found = text.indexOf(q, idx)
    if (found === -1) break
    out.push({ from: pos[found], to: pos[found + q.length - 1] + 1 })
    idx = found + q.length
  }
  return out
}

/** All matches in the document, in document order. Matches never span two different blocks. Empty query → no matches. */
export function findAllMatches(doc: PMNode, query: string): Match[] {
  if (!query) return []
  const all: Match[] = []
  doc.descendants((node, pos) => {
    if (node.isTextblock) {
      all.push(...matchesInTextblock(node, pos, query))
      return false
    }
    return true
  })
  return all
}
