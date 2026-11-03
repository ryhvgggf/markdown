import * as Y from 'yjs'

/** The block as text, without ids (two separately made copies of one note differ only in those). */
const shape = (n: Y.XmlElement | Y.XmlText | Y.XmlHook) => n.toString().replace(/\s+id="[^"]*"/g, '')

/**
 * A note whose content is written twice, one copy right after the other (the same note was once made separately
 * on two devices and then merged): removes the second copy. Only when the two halves are the same blocks in the
 * same order — anything else is left untouched. Returns whether it changed the note.
 */
export function removeDuplicatedContent(doc: Y.Doc, fragment = 'content'): boolean {
  const frag = doc.getXmlFragment(fragment)
  const n = frag.length
  if (n < 2 || n % 2 !== 0) return false
  const half = n / 2
  const blocks = frag.toArray()
  for (let i = 0; i < half; i++) if (shape(blocks[i]) !== shape(blocks[i + half])) return false
  frag.delete(half, half)
  return true
}
