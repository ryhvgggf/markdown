import { afterEach, describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { Editor } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import { createExtensions, type EditorContext } from '../extensions'
import { orderedStyleForDepth } from './ordered-list'

const ctx = { noteId: 'n1' } as unknown as EditorContext
const editors: Editor[] = []
function make(content?: string) {
  const editor = new Editor({ extensions: createExtensions(new Y.Doc(), ctx) })
  editors.push(editor)
  if (content) editor.commands.setContent(content) // Collaboration ignores the `content` option
  return editor
}
afterEach(() => editors.splice(0).forEach((e) => e.destroy()))

const key = (editor: Editor, init: KeyboardEventInit & { key: string }) => {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
  const handled = editor.view.someProp('handleKeyDown', (f) => f(editor.view, event))
  return Boolean(handled)
}
const typeText = (editor: Editor, text: string) => {
  const { from } = editor.state.selection
  const handled = editor.view.someProp('handleTextInput', (f) => f(editor.view, from, from, text, () => editor.state.tr))
  if (!handled) editor.view.dispatch(editor.state.tr.insertText(text))
}
const placeCursorIn = (editor: Editor, text: string) => {
  let pos = -1
  editor.state.doc.descendants((n, p) => {
    if (n.isText && n.text === text) pos = p + 1
  })
  expect(pos).toBeGreaterThan(0)
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, pos)))
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const json = (editor: Editor): any => editor.getJSON()
const outline = (editor: Editor) => {
  const out: string[] = []
  editor.state.doc.descendants((n) => {
    if (n.isText) out.push(n.text!)
  })
  return out.join(',')
}

describe('orderedStyleForDepth', () => {
  it('cycles decimal, alpha, roman', () => {
    expect([0, 1, 2, 3].map(orderedStyleForDepth)).toEqual(['decimal', 'alpha', 'roman', 'decimal'])
  })
})

describe('ordered list style', () => {
  const nested = '<ol><li><p>a</p><ol><li><p>b</p></li></ol></li></ol>'
  it('renders the effective style by depth and respects explicit choice', () => {
    const editor = make(nested)
    const ols = () => [...editor.view.dom.querySelectorAll('ol')].map((o) => o.getAttribute('data-list-style'))
    expect(ols()).toEqual(['decimal', 'alpha'])
    placeCursorIn(editor, 'b')
    expect(editor.commands.setListStyle('roman')).toBe(true)
    expect(ols()).toEqual(['decimal', 'roman'])
    editor.commands.setListStyle('auto')
    expect(ols()).toEqual(['decimal', 'alpha'])
  })

  it('counts bullet ancestors as depth', () => {
    const editor = make('<ul><li><p>a</p><ol><li><p>b</p></li></ol></li></ul>')
    expect(editor.view.dom.querySelector('ol')?.getAttribute('data-list-style')).toBe('alpha')
  })
})

describe('input rules', () => {
  const run = (marker: string) => {
    const editor = make('<p></p>')
    editor.commands.focus('start')
    typeText(editor, marker.slice(0, -1))
    typeText(editor, ' ')
    return editor.getJSON().content?.[0]?.type
  }
  it('1. -> orderedList', () => expect(run('1. ')).toBe('orderedList'))
  it('- -> bulletList', () => expect(run('- ')).toBe('bulletList'))
  it('* -> bulletList', () => expect(run('* ')).toBe('bulletList'))
  it('[] -> taskList', () => expect(run('[] ')).toBe('taskList'))
  it('[ ] -> taskList', () => expect(run('[ ] ')).toBe('taskList'))
})

const tree = '<ul><li><p>a</p><ul><li><p>a1</p></li></ul></li><li><p>b</p></li><li><p>c</p></li></ul>'

describe('Tab / Shift-Tab', () => {
  it('indents with children and outdents back', () => {
    const editor = make(tree)
    placeCursorIn(editor, 'b')
    expect(key(editor, { key: 'Tab' })).toBe(true)
    // b is now the last child of a's sublist
    const a = json(editor).content![0].content![0]
    expect(a.content[1].content.map((li: { content: { content: { text: string }[] }[] }) => li.content[0].content[0].text)).toEqual(['a1', 'b'])
    expect(key(editor, { key: 'Tab', shiftKey: true })).toBe(true)
    expect(json(editor).content![0].content!.length).toBe(3)
  })

  it('moves a parent item together with its children', () => {
    const editor = make('<ul><li><p>x</p></li><li><p>b</p><ul><li><p>b1</p></li></ul></li></ul>')
    placeCursorIn(editor, 'b')
    key(editor, { key: 'Tab' })
    const x = json(editor).content![0].content![0]
    const sub = x.content![1].content![0]
    expect(sub.content![0].content![0].text).toBe('b')
    expect(sub.content![1].content![0].content![0].content![0].text).toBe('b1')
  })
})

describe('moveSubtree', () => {
  it('swaps an item (with children) with the next sibling', () => {
    const editor = make(tree)
    placeCursorIn(editor, 'a')
    expect(key(editor, { key: 'ArrowDown', altKey: true, shiftKey: true })).toBe(true)
    expect(outline(editor)).toBe('b,a,a1,c')
    expect(editor.state.selection.$from.parent.textContent).toBe('a')
  })

  it('moves up and keeps the selection inside the moved item', () => {
    const editor = make(tree)
    placeCursorIn(editor, 'b')
    editor.commands.moveSubtreeUp()
    expect(outline(editor)).toBe('b,a,a1,c')
    expect(editor.state.selection.$from.parent.textContent).toBe('b')
  })

  it('is a no-op at the boundary', () => {
    const editor = make(tree)
    placeCursorIn(editor, 'a')
    expect(editor.commands.moveSubtreeUp()).toBe(false)
    placeCursorIn(editor, 'c')
    expect(editor.commands.moveSubtreeDown()).toBe(false)
    expect(outline(editor)).toBe('a,a1,b,c')
  })

  it('does nothing while composing', () => {
    const editor = make(tree)
    placeCursorIn(editor, 'a')
    key(editor, { key: 'ArrowDown', altKey: true, shiftKey: true, isComposing: true })
    expect(outline(editor)).toBe('a,a1,b,c')
  })
})
