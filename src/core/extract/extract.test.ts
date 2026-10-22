import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { extractNote } from './extract'

function el(name: string, attrs: Record<string, string>, children: (Y.XmlElement | Y.XmlText)[] = []) {
  const e = new Y.XmlElement(name)
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v)
  if (children.length) e.insert(0, children)
  return e
}
function build(nodes: Y.XmlElement[]) {
  const doc = new Y.Doc()
  const f = doc.getXmlFragment('content')
  f.insert(0, nodes)
  return f
}

describe('extractNote', () => {
  it('extracts text, blocks, links, tags', () => {
    const f = build([
      el('paragraph', { id: 'b1' }, [
        new Y.XmlText('see '),
        el('noteLink', { noteId: 'n2', blockId: 'x9' }),
        new Y.XmlText(' now '),
        el('tag', { name: 'Work' }),
        el('tag', { name: 'work' }),
      ]),
      el('heading', { id: 'b2', level: '1' }, [new Y.XmlText('Title')]),
    ])
    const r = extractNote(f)
    expect(r.text).toBe('see  now #Work#work\nTitle')
    expect(r.blocks).toEqual([
      { id: 'b1', type: 'paragraph', text: 'see  now #Work#work' },
      { id: 'b2', type: 'heading', text: 'Title' },
    ])
    expect(r.links).toEqual([
      { sourceBlockId: 'b1', targetNoteId: 'n2', targetBlockId: 'x9', snippet: 'see \u2063link:n2\u2063 now #Work#work' },
    ])
    expect(r.tags).toEqual(['work'])
  })

  it('truncates snippet to 80 chars and nulls missing blockId', () => {
    const f = build([
      el('paragraph', { id: 'b1' }, [new Y.XmlText('a'.repeat(100)), el('noteLink', { noteId: 'n2' })]),
    ])
    const [l] = extractNote(f).links
    expect(l.snippet).toBe('a'.repeat(80))
    expect(l.targetBlockId).toBeNull()
  })

  it('never cuts a link token in half: a token that does not fit is dropped', () => {
    const f = build([
      el('paragraph', { id: 'b1' }, [
        new Y.XmlText('a'.repeat(70)),
        el('noteLink', { noteId: 'nnnnnnnnnnnnnnnn' }),
        new Y.XmlText('tail'),
      ]),
    ])
    const [l] = extractNote(f).links
    expect(l.snippet).toBe('a'.repeat(70))
    const g = build([
      el('paragraph', { id: 'b1' }, [new Y.XmlText('a'.repeat(30)), el('noteLink', { noteId: 'n2' }), new Y.XmlText('b'.repeat(80))]),
    ])
    const s = extractNote(g).links[0].snippet
    expect(s.length).toBe(80)
    expect(s.startsWith('a'.repeat(30) + '\u2063link:n2\u2063')).toBe(true)
  })

  it('walks nested lists and tables, joins with newline', () => {
    const f = build([
      el('bulletList', { id: 'l1' }, [
        el('listItem', { id: 'i1' }, [
          el('paragraph', { id: 'p1' }, [new Y.XmlText('one')]),
          el('bulletList', {}, [el('listItem', {}, [el('paragraph', { id: 'p2' }, [new Y.XmlText('two')])])]),
        ]),
      ]),
      el('table', {}, [el('tableRow', {}, [el('tableCell', {}, [el('paragraph', { id: 'p3' }, [new Y.XmlText('cell')])])])]),
    ])
    const r = extractNote(f)
    expect(r.text).toBe('one\ntwo\ncell')
    expect(r.blocks.map((b) => b.id)).toEqual(['l1', 'i1', 'p1', 'p2', 'p3'])
    expect(r.blocks[0].text).toBe('')
  })

  it('uses nearest id-bearing ancestor, or empty string', () => {
    const f = build([
      el('listItem', { id: 'i1' }, [el('paragraph', {}, [new Y.XmlText('x'), el('noteLink', { noteId: 'n2' })])]),
      el('paragraph', {}, [el('noteLink', { noteId: 'n3' })]),
    ])
    const r = extractNote(f)
    expect(r.links.map((l) => l.sourceBlockId)).toEqual(['i1', ''])
    expect(r.links[0].snippet).toBe('x\u2063link:n2\u2063')
  })

  it('collects deduplicated attachment ids', () => {
    const f = build([
      el('media', { id: 'm1', attachmentId: 'a1' }),
      el('media', { id: 'm2', attachmentId: 'a1' }),
      el('media', { id: 'm3', attachmentId: 'a2' }),
    ])
    expect(extractNote(f).attachmentIds).toEqual(['a1', 'a2'])
  })

  it('ignores formatting marks in text', () => {
    const t = new Y.XmlText()
    const f = build([el('paragraph', { id: 'b1' }, [t])])
    t.insert(0, 'bold', { bold: true })
    t.insert(4, ' plain')
    expect(extractNote(f).text).toBe('bold plain')
  })
})
