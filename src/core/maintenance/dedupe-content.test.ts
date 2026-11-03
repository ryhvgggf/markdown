import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { removeDuplicatedContent } from './dedupe-content'

function docWith(...lines: string[]): Y.Doc {
  const doc = new Y.Doc()
  doc.getXmlFragment('content').insert(
    0,
    lines.map((l, i) => {
      const p = new Y.XmlElement('paragraph')
      p.setAttribute('id', `id-${i}-${Math.random()}`) // every block has its own id, also the copies
      p.insert(0, [new Y.XmlText(l)])
      return p
    }),
  )
  return doc
}
const lines = (d: Y.Doc) => d.getXmlFragment('content').toArray().map((n) => (n as Y.XmlElement).toString().replace(/<[^>]+>/g, ''))

describe('removeDuplicatedContent', () => {
  it('removes the second copy of content written twice, ignoring block ids', () => {
    const d = docWith('ST22', 'SE01', 'STMS', 'ST22', 'SE01', 'STMS')
    expect(removeDuplicatedContent(d)).toBe(true)
    expect(lines(d)).toEqual(['ST22', 'SE01', 'STMS'])
  })

  it('leaves notes alone that are not exactly doubled', () => {
    for (const l of [[], ['a'], ['a', 'a', 'b'], ['a', 'b', 'a', 'c'], ['a', 'b', 'b', 'a']]) {
      const d = docWith(...l)
      expect(removeDuplicatedContent(d)).toBe(false)
      expect(lines(d)).toEqual(l)
    }
  })

  it('a note that really repeats a line is touched only when the whole note repeats', () => {
    const d = docWith('x', 'x') // two identical blocks: it IS two copies of one block
    expect(removeDuplicatedContent(d)).toBe(true)
    expect(lines(d)).toEqual(['x'])
  })
})
