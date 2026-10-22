import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { linkMention } from './link-mention'
import { extractNote } from '../extract/extract'

function setup(...paras: string[]) {
  const doc = new Y.Doc()
  const f = doc.getXmlFragment('content')
  f.insert(
    0,
    paras.map((s, i) => {
      const p = new Y.XmlElement('paragraph')
      p.setAttribute('id', `b${i}`)
      p.insert(0, [new Y.XmlText(s)])
      return p
    }),
  )
  return f
}

describe('linkMention', () => {
  it('replaces the first match with a noteLink', () => {
    const f = setup('依採購流程追蹤採購流程')
    expect(linkMention(f, '採購流程', 'n2')).toBe(true)
    const p = f.get(0) as Y.XmlElement
    const kids = p.toArray()
    expect(kids).toHaveLength(3)
    expect((kids[0] as Y.XmlText).toString()).toBe('依')
    expect((kids[1] as Y.XmlElement).nodeName).toBe('noteLink')
    expect((kids[1] as Y.XmlElement).getAttribute('noteId')).toBe('n2')
    expect((kids[1] as Y.XmlElement).getAttribute('blockId')).toBeUndefined()
    expect((kids[2] as Y.XmlText).toString()).toBe('追蹤採購流程')
    expect(extractNote(f).links).toHaveLength(1)
  })

  it('is case-insensitive and skips text before in document order', () => {
    const f = setup('nothing', 'Read PROCUREMENT now')
    expect(linkMention(f, 'procurement', 'n2')).toBe(true)
    expect(extractNote(f).links[0].sourceBlockId).toBe('b1')
  })

  it('preserves formatting of remaining text', () => {
    const doc = new Y.Doc()
    const f = doc.getXmlFragment('content')
    const t = new Y.XmlText()
    const p = new Y.XmlElement('paragraph')
    p.insert(0, [t])
    f.insert(0, [p])
    t.insert(0, 'a foo ')
    t.insert(6, 'bold', { bold: true })
    expect(linkMention(f, 'foo', 'n2')).toBe(true)
    const rest = p.toArray()[2] as Y.XmlText
    expect(rest.toDelta()).toEqual([{ insert: ' ' }, { insert: 'bold', attributes: { bold: true } }])
  })

  it('returns false and leaves content unchanged when not found or blank', () => {
    const f = setup('hello')
    const before = f.toString()
    expect(linkMention(f, 'zzz', 'n2')).toBe(false)
    expect(linkMention(f, '  ', 'n2')).toBe(false)
    expect(linkMention(f, '', 'n2')).toBe(false)
    expect(f.toString()).toBe(before)
  })

  it('does not re-link text split across an existing noteLink', () => {
    const f = setup('採購流程')
    linkMention(f, '採購流程', 'n2')
    expect(linkMention(f, '採購流程', 'n2')).toBe(false)
  })

  it('never links text inside a code block', () => {
    const doc = new Y.Doc()
    const f = doc.getXmlFragment('content')
    const code = new Y.XmlElement('codeBlock')
    code.insert(0, [new Y.XmlText('call 採購流程 now')])
    const p = new Y.XmlElement('paragraph')
    p.insert(0, [new Y.XmlText('說明採購流程')])
    f.insert(0, [code, p])
    expect(linkMention(f, '採購流程', 'n2')).toBe(true)
    expect((code.get(0) as Y.XmlText).toString()).toBe('call 採購流程 now')
    expect(p.toArray().some((k) => k instanceof Y.XmlElement && k.nodeName === 'noteLink')).toBe(true)
    const only = new Y.Doc().getXmlFragment('content')
    const c2 = new Y.XmlElement('codeBlock')
    c2.insert(0, [new Y.XmlText('採購流程')])
    only.insert(0, [c2])
    expect(linkMention(only, '採購流程', 'n2')).toBe(false)
  })
})
