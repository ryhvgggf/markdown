import type { PMNode } from '../types'

/** Removes block ids (random) so documents compare by content. */
export function stripIds(n: PMNode): PMNode {
  const rest = { ...n.attrs }
  delete rest.id
  const attrs = n.attrs && Object.keys(rest).length ? rest : undefined
  return { ...n, attrs, ...(n.content && { content: n.content.map(stripIds) }) } as PMNode
}
