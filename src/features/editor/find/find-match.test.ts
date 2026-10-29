import { afterEach, describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { Editor } from '@tiptap/core'
import { createExtensions, type EditorContext } from '../extensions'
import { findAllMatches } from './find-match'

let editor: Editor | null = null
afterEach(() => editor?.destroy())

function open(content: string) {
  editor = new Editor({ extensions: createExtensions(new Y.Doc(), { noteId: 'n1' } as unknown as EditorContext) })
  editor.commands.setContent(content)
  return editor
}

describe('findAllMatches', () => {
  it('finds a plain match', () => {
    const e = open('<p>hello world</p>')
    const matches = findAllMatches(e.state.doc, 'world')
    expect(matches).toHaveLength(1)
    expect(e.state.doc.textBetween(matches[0].from, matches[0].to)).toBe('world')
  })

  it('is case-insensitive', () => {
    const e = open('<p>Hello World</p>')
    expect(findAllMatches(e.state.doc, 'WORLD')).toHaveLength(1)
  })

  it('finds every non-overlapping occurrence, in document order', () => {
    const e = open('<p>aa aa aa</p>')
    const matches = findAllMatches(e.state.doc, 'aa')
    expect(matches).toHaveLength(3)
    expect(matches[0].from).toBeLessThan(matches[1].from)
    expect(matches[1].from).toBeLessThan(matches[2].from)
  })

  it('finds a match that spans a mark boundary within one block', () => {
    const e = open('<p><strong>hel</strong>lo</p>')
    const matches = findAllMatches(e.state.doc, 'hello')
    expect(matches).toHaveLength(1)
    expect(e.state.doc.textBetween(matches[0].from, matches[0].to)).toBe('hello')
  })

  it('never matches across two different blocks', () => {
    const e = open('<p>foo</p><p>bar</p>')
    expect(findAllMatches(e.state.doc, 'foobar')).toHaveLength(0)
  })

  it('returns nothing for an empty query', () => {
    const e = open('<p>hello</p>')
    expect(findAllMatches(e.state.doc, '')).toEqual([])
  })

  it('returns nothing when there is no match', () => {
    const e = open('<p>hello</p>')
    expect(findAllMatches(e.state.doc, 'xyz')).toEqual([])
  })
})
