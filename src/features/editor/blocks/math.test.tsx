import { afterEach, describe, expect, it } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import * as Y from 'yjs'
import { Editor } from '@tiptap/core'
import { EditorContent } from '@tiptap/react'
import { NodeSelection, TextSelection } from '@tiptap/pm/state'
import { ySyncPluginKey } from '@tiptap/y-tiptap'
import { createExtensions, type EditorContext } from '../extensions'
import { filterSlashItems } from '../menus/slash-items'
import { editorSchema } from '@/app/doc-io'
import { sanitizeShareDoc } from '@/core/share/sanitize'

const ctx = { noteId: 'n1' } as unknown as EditorContext
const editors: Editor[] = []
function make(content?: object, doc = new Y.Doc()) {
  const editor = new Editor({ extensions: createExtensions(doc, ctx) })
  editors.push(editor)
  if (content) editor.commands.setContent(content)
  return editor
}
afterEach(() => editors.splice(0).forEach((e) => e.destroy()))

const p = (...content: object[]) => ({ type: 'paragraph', ...(content.length && { content }) })
const t = (text: string, marks?: object[]) => ({ type: 'text', text, ...(marks && { marks }) })
const doc = (...content: object[]) => ({ type: 'doc', content })
const strip = (j: unknown) =>
  JSON.parse(JSON.stringify(j, (k, v) => (k === 'id' ? undefined : k === 'attrs' && v && Object.keys(v).every((a) => a === 'id') ? undefined : v)))
const formula = async (c: HTMLElement) => {
  await waitFor(() => expect(c.querySelector('.math-render')).not.toBeNull())
  return c.querySelector('.math-render')!
}
const body = (e: Editor) => strip(e.getJSON()).content

/** Types `text` one character at a time through the input-rule path, as the keyboard does. */
function type(editor: Editor, text: string) {
  for (const ch of text) {
    const { from, to } = editor.state.selection
    const handled = editor.view.someProp('handleTextInput', (f) => f(editor.view, from, to, ch, () => editor.state.tr.insertText(ch, from, to)))
    if (!handled) editor.view.dispatch(editor.state.tr.insertText(ch, from, to))
  }
}
const cursorAtEnd = (e: Editor) => e.view.dispatch(e.state.tr.setSelection(TextSelection.atEnd(e.state.doc)))

describe('formula input', () => {
  it('$x$ becomes an inline formula, exactly as typed', () => {
    const e = make()
    type(e, '式 $1 + 1$ 完')
    expect(body(e)).toEqual([p(t('式 '), { type: 'mathInline', attrs: { latex: '1 + 1' } }, t(' 完'))])
  })

  it('leaves money, spaced dollars and code alone', () => {
    for (const s of ['$5 與 $', '$ x$', '\\$x$', 'NT$100 至 NT$', 'US$5 or US$', '$5-$', '$5 to $']) {
      const e = make()
      type(e, s)
      expect(body(e)).toEqual([p(t(s))])
    }
    const code = make(doc({ type: 'codeBlock', attrs: { language: null } }))
    cursorAtEnd(code)
    type(code, '$x$')
    expect(body(code)).toEqual([{ type: 'codeBlock', attrs: { language: null }, content: [t('$x$')] }])
    const mark = make(doc(p(t('a', [{ type: 'code' }]))))
    cursorAtEnd(mark)
    type(mark, '$x$')
    expect(body(mark)[0].content.some((n: { type: string }) => n.type === 'mathInline')).toBe(false)
  })

  it('$$ in an empty paragraph becomes a block formula; not after other text', () => {
    const e = make()
    type(e, '$$')
    expect(body(e)).toEqual([{ type: 'mathBlock', attrs: { latex: '' } }])
    const other = make()
    type(other, 'a$$')
    expect(body(other)).toEqual([p(t('a$$'))])
    const list = make(doc({ type: 'bulletList', content: [{ type: 'listItem', content: [p()] }] }))
    list.view.dispatch(list.state.tr.setSelection(TextSelection.create(list.state.doc, 3)))
    type(list, '$$')
    expect(body(list)).toEqual([{ type: 'bulletList', content: [{ type: 'listItem', content: [p(), { type: 'mathBlock', attrs: { latex: '' } }] }] }])
  })

  it('slash items insert a block or an inline formula', () => {
    expect(filterSlashItems('latex').map((i) => i.id)).toEqual(['math', 'math-inline'])
    expect(filterSlashItems('公式').map((i) => i.id)).toEqual(['math', 'math-inline'])
    const e = make(doc(p(t('a')), p()))
    cursorAtEnd(e)
    expect(e.commands.insertMathBlock()).toBe(true)
    expect(body(e)).toEqual([p(t('a')), { type: 'mathBlock', attrs: { latex: '' } }])
    expect(e.state.selection instanceof NodeSelection).toBe(true)

    const after = make(doc(p(t('a'))))
    cursorAtEnd(after)
    after.commands.insertMathBlock()
    expect(body(after)).toEqual([p(t('a')), { type: 'mathBlock', attrs: { latex: '' } }])

    const inl = make(doc(p(t('ab'))))
    inl.view.dispatch(inl.state.tr.setSelection(TextSelection.create(inl.state.doc, 2)))
    inl.commands.insertMathInline()
    expect(body(inl)).toEqual([p(t('a'), { type: 'mathInline', attrs: { latex: '' } }, t('b'))])

    const code = make(doc({ type: 'codeBlock', attrs: { language: null } }))
    cursorAtEnd(code)
    expect(code.commands.insertMathInline()).toBe(false)
    expect(code.commands.insertMathBlock()).toBe(false)
  })

  it('formulas survive the Yjs document', () => {
    const y = new Y.Doc()
    const content = doc(p(t('a'), { type: 'mathInline', attrs: { latex: 'x^2' } }), { type: 'mathBlock', attrs: { latex: '\\int f' } })
    make(content, y)
    const again = make(undefined, y)
    expect(body(again)).toEqual(content.content)
  })

  it('a share snapshot with formulas passes the allow-list and the editor schema check', () => {
    const shared = sanitizeShareDoc(
      doc(
        { type: 'heading', attrs: { level: 1 }, content: [t('H '), { type: 'mathInline', attrs: { latex: 'x' } }] },
        { type: 'mathBlock', attrs: { id: 'm1', latex: '\\sum' } },
        { type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableCell', content: [{ type: 'mathBlock', attrs: { latex: 'c' } }] }] }] },
      ),
    )
    expect(() => editorSchema().nodeFromJSON(shared).check()).not.toThrow()
    expect(JSON.stringify(shared)).toContain('"latex":"c"')
  })

  it('content this version does not know stops the binding instead of deleting it (the unsupported-content banner)', () => {
    const y = new Y.Doc()
    const el = new Y.XmlElement('futureNode')
    el.setAttribute('x', '1')
    y.getXmlFragment('content').insert(0, [el])
    const e = make(undefined, y)
    expect(ySyncPluginKey.getState(e.state)?.binding?.projectionError).not.toBeNull()
    e.commands.insertContent('typed')
    expect(y.getXmlFragment('content').toArray().map((n) => (n as Y.XmlElement).nodeName)).toEqual(['futureNode'])
  })
})

describe('formula view', () => {
  it('renders with KaTeX; click to edit, Enter saves, Escape cancels', async () => {
    const e = make(doc(p(t('a'), { type: 'mathInline', attrs: { latex: 'x^2' } })))
    const { container } = render(<EditorContent editor={e} />)
    await waitFor(() => expect(container.querySelector('.math-inline .katex')).not.toBeNull())
    await act(async () => void fireEvent.click(await formula(container)))
    const input = (await screen.findByLabelText('公式（LaTeX）')) as HTMLInputElement
    expect(input.value).toBe('x^2')
    fireEvent.change(input, { target: { value: ' y^3 ' } })
    await act(async () => void fireEvent.keyDown(input, { key: 'Enter' }))
    expect(body(e)[0].content[1]).toEqual({ type: 'mathInline', attrs: { latex: 'y^3' } })

    await act(async () => void fireEvent.click(await formula(container)))
    const again = await screen.findByLabelText('公式（LaTeX）')
    fireEvent.change(again, { target: { value: 'z' } })
    await act(async () => void fireEvent.keyDown(again, { key: 'Escape' }))
    expect(body(e)[0].content[1].attrs.latex).toBe('y^3')
  })

  it('Enter during IME composition does not save', async () => {
    const e = make(doc(p({ type: 'mathInline', attrs: { latex: 'a' } })))
    const { container } = render(<EditorContent editor={e} />)
    await act(async () => void fireEvent.click(await formula(container)))
    const input = await screen.findByLabelText('公式（LaTeX）')
    fireEvent.change(input, { target: { value: 'ab' } })
    await act(async () => void fireEvent.keyDown(input, { key: 'Enter', keyCode: 229 }))
    expect(screen.getByLabelText('公式（LaTeX）')).toBeTruthy()
    expect(body(e)[0].content[0].attrs.latex).toBe('a')
  })

  it('a new block formula opens for editing; Ctrl+Enter saves; an emptied inline formula is removed', async () => {
    const e = make()
    const { container } = render(<EditorContent editor={e} />)
    await act(async () => void type(e, '$$'))
    const area = await screen.findByLabelText('公式（LaTeX）')
    expect(area.tagName).toBe('TEXTAREA')
    fireEvent.change(area, { target: { value: 'a\\\\\nb' } })
    await act(async () => void fireEvent.keyDown(area, { key: 'Enter' }))
    expect(screen.getByLabelText('公式（LaTeX）')).toBeTruthy() // plain Enter is a new line
    await act(async () => void fireEvent.keyDown(area, { key: 'Enter', ctrlKey: true }))
    expect(body(e)).toEqual([{ type: 'mathBlock', attrs: { latex: 'a\\\\\nb' } }])

    await act(async () => void e.chain().insertContentAt(e.state.doc.content.size, p(t('x'))).run())
    cursorAtEnd(e)
    await act(async () => void e.commands.insertMathInline())
    const input = await screen.findByLabelText('公式（LaTeX）')
    await act(async () => void fireEvent.keyDown(input, { key: 'Enter' }))
    expect(body(e)).toEqual([{ type: 'mathBlock', attrs: { latex: 'a\\\\\nb' } }, p(t('x'))])
    expect(container.querySelector('.math-block .katex-display')).not.toBeNull()
  })

  it('Enter on a selected formula opens it; a read-only editor never does', async () => {
    const e = make(doc({ type: 'mathBlock', attrs: { latex: 'q' } }, p()))
    render(<EditorContent editor={e} />)
    await act(async () => void e.commands.setNodeSelection(0))
    const ev = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
    await act(async () => void e.view.someProp('handleKeyDown', (f) => f(e.view, ev)))
    expect((await screen.findByLabelText('公式（LaTeX）') as HTMLTextAreaElement).value).toBe('q')

    const ro = new Editor({ extensions: createExtensions(new Y.Doc(), ctx), editable: false })
    editors.push(ro)
    ro.commands.setContent(doc(p({ type: 'mathInline', attrs: { latex: 'r' } })))
    const { container } = render(<EditorContent editor={ro} />)
    await act(async () => void fireEvent.click(await formula(container)))
    expect(container.querySelector('.math-inline input')).toBeNull()
  })

  it('leaving by clicking elsewhere saves without moving the cursor back', async () => {
    const e = make(doc(p(t('abc'), { type: 'mathInline', attrs: { latex: 'x' } })))
    const { container } = render(<EditorContent editor={e} />)
    await act(async () => void fireEvent.click(await formula(container)))
    const input = await screen.findByLabelText('公式（LaTeX）')
    fireEvent.change(input, { target: { value: 'y' } })
    e.view.dispatch(e.state.tr.setSelection(TextSelection.create(e.state.doc, 2)))
    await act(async () => void fireEvent.blur(input))
    expect(body(e)[0].content[1].attrs.latex).toBe('y')
    expect(e.state.selection.from).toBe(2)
  })

  it('a formula with an error shows its text', async () => {
    const e = make(doc(p({ type: 'mathInline', attrs: { latex: '\\frac{' } })))
    const { container } = render(<EditorContent editor={e} />)
    await waitFor(() => expect(container.querySelector('.math-error')?.textContent).toBe('\\frac{'))
  })
})
