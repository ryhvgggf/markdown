import { afterEach, describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { Editor } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import type { Root, RootContent } from 'hast'
import { createExtensions, type EditorContext } from '../extensions'
import { lowlight, CODE_LANGUAGES } from './code-block'

const ctx = { noteId: 'n1' } as unknown as EditorContext
const editors: Editor[] = []
function make(content?: string) {
  const editor = new Editor({ extensions: createExtensions(new Y.Doc(), ctx) })
  editors.push(editor)
  if (content) editor.commands.setContent(content)
  return editor
}
afterEach(() => editors.splice(0).forEach((e) => e.destroy()))

const key = (editor: Editor, init: KeyboardEventInit & { key: string }) => {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
  return Boolean(editor.view.someProp('handleKeyDown', (f) => f(editor.view, event)))
}
const count = (editor: Editor, type: string) => {
  let n = 0
  editor.state.doc.descendants((node) => {
    if (node.type.name === type) n++
  })
  return n
}
const classesOf = (tree: Root, cls: string) => {
  const out: string[] = []
  const walk = (n: RootContent | Root) => {
    if (n.type === 'element') {
      const c = (n.properties?.className as string[] | undefined) ?? []
      if (c.includes(cls)) out.push(n.children.map((k) => (k.type === 'text' ? k.value : '')).join(''))
    }
    if ('children' in n) n.children.forEach((k) => walk(k as RootContent))
  }
  walk(tree)
  return out
}
const cursorIn = (editor: Editor, pos: number) =>
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, pos)))

describe('callout', () => {
  it('insertCallout creates an editable paragraph with the cursor inside', () => {
    const editor = make()
    expect(editor.commands.insertCallout()).toBe(true)
    const callout = editor.getJSON().content!.find((n) => n.type === 'callout')!
    expect(callout.attrs?.icon).toBe('info')
    expect(callout.content?.[0].type).toBe('paragraph')
    editor.commands.insertContent('hi')
    expect(editor.state.doc.firstChild?.textContent).toBe('hi')
    expect(editor.state.selection.$from.node(-1).type.name).toBe('callout')
  })
})

describe('abap highlighting', () => {
  const code = '* 註解\nSELECT SINGLE * FROM ekko INTO @DATA(ls_ekko) WHERE ebeln = @lv_ebeln. " tail'
  const tree = lowlight.highlight('abap', code)
  it('marks keywords and comments', () => {
    const kw = classesOf(tree, 'hljs-keyword')
    expect(kw).toEqual(expect.arrayContaining(['SELECT', 'SINGLE', 'FROM', 'INTO', 'WHERE']))
    const comments = classesOf(tree, 'hljs-comment')
    expect(comments[0]).toBe('* 註解')
    expect(comments).toContain('" tail')
  })
  it('is case-insensitive and does not treat mid-line * as a comment', () => {
    const t = lowlight.highlight('abap', 'select single * from ekko.')
    expect(classesOf(t, 'hljs-keyword')).toEqual(expect.arrayContaining(['select', 'from']))
    expect(classesOf(t, 'hljs-comment')).toEqual([])
  })
  it('highlights strings and string templates', () => {
    const t = lowlight.highlight('abap', "lv = 'a' && |x { lv } y|.")
    expect(classesOf(t, 'hljs-string').length).toBeGreaterThanOrEqual(2)
  })
  it('supports the required languages', () => {
    const want = ['abap', 'javascript', 'typescript', 'java', 'sql', 'xml', 'json', 'css', 'bash', 'python', 'markdown']
    for (const l of want) expect(lowlight.registered(l)).toBe(true)
    expect(CODE_LANGUAGES.map((l) => l.value)).toEqual(want)
  })
  it('code block keeps language attribute', () => {
    const editor = make('<pre><code class="language-abap">DATA x.</code></pre>')
    const cb = editor.getJSON().content!.find((n) => n.type === 'codeBlock')!
    expect(cb.attrs?.language).toBe('abap')
  })
  it('Tab in a code block inserts two spaces, but not while composing', () => {
    const editor = make('<pre><code>ab</code></pre>')
    cursorIn(editor, 2)
    expect(key(editor, { key: 'Tab' })).toBe(true)
    expect(editor.state.doc.textContent).toBe('a  b')
    expect(key(editor, { key: 'Tab', isComposing: true })).toBe(false)
    expect(editor.state.doc.textContent).toBe('a  b')
  })
})

describe('table', () => {
  it('insertTable makes a 3x3 table with a header row', () => {
    const editor = make()
    expect(editor.commands.insertTable()).toBe(true)
    expect(count(editor, 'tableRow')).toBe(3)
    expect(count(editor, 'tableCell') + count(editor, 'tableHeader')).toBe(9)
    expect(count(editor, 'tableHeader')).toBe(3)
  })
  it('addColumnAfter and deleteRow work', () => {
    const editor = make()
    editor.commands.insertTable()
    expect(editor.commands.addColumnAfter()).toBe(true)
    expect(count(editor, 'tableCell') + count(editor, 'tableHeader')).toBe(12)
    expect(editor.commands.deleteRow()).toBe(true)
    expect(count(editor, 'tableRow')).toBe(2)
  })
  it('Tab moves to the next cell (Shift-Tab back); not while composing', () => {
    const editor = make()
    editor.commands.insertTable()
    let first = -1
    editor.state.doc.descendants((n, p) => {
      if (first < 0 && n.type.name === 'tableHeader') first = p + 2
    })
    cursorIn(editor, first)
    const start = editor.state.selection.from
    expect(key(editor, { key: 'Tab', isComposing: true })).toBe(false)
    expect(editor.state.selection.from).toBe(start)
    expect(key(editor, { key: 'Tab' })).toBe(true)
    expect(editor.state.selection.from).toBeGreaterThan(start)
    const next = editor.state.selection.from
    expect(key(editor, { key: 'Tab', shiftKey: true })).toBe(true)
    expect(editor.state.selection.from).toBe(start)
    expect(next).not.toBe(start)
  })
})
