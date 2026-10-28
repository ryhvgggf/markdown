import { newId } from './ids'
import type { PMNode } from './markdown/types'

/** Node types that carry a stable `id` attribute (read by the block extractor). */
export const BLOCK_TYPES: readonly string[] = [
  'paragraph',
  'heading',
  'blockquote',
  'bulletList',
  'orderedList',
  'listItem',
  'taskList',
  'taskItem',
  'callout',
  'codeBlock',
  'table',
  'horizontalRule',
  'media',
]

/** Gives every block that carries an id a fresh one when it has none or repeats an earlier one (document order). */
export function assignBlockIds(doc: PMNode, types: readonly string[] = BLOCK_TYPES, gen: () => string = newId): PMNode {
  const seen = new Set<string>()
  const walk = (node: PMNode): PMNode => {
    let attrs = node.attrs
    if (types.includes(node.type)) {
      const id = node.attrs?.id
      if (typeof id === 'string' && id && !seen.has(id)) seen.add(id)
      else {
        const fresh = gen()
        seen.add(fresh)
        attrs = { ...node.attrs, id: fresh }
      }
    }
    return { ...node, ...(attrs && { attrs }), ...(node.content && { content: node.content.map(walk) }) }
  }
  return walk(doc)
}
