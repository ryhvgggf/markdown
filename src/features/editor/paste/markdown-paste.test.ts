import { afterEach, describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { Editor } from '@tiptap/core'
import { createExtensions, type EditorContext } from '../extensions'
import { looksLikeMarkdown, markdownToHtml } from './markdown-paste'

const ctx = { noteId: 'n1' } as unknown as EditorContext
const editors: Editor[] = []
function make() {
  const editor = new Editor({ extensions: createExtensions(new Y.Doc(), ctx) })
  editors.push(editor)
  return editor
}
afterEach(() => editors.splice(0).forEach((e) => e.destroy()))

function paste(editor: Editor, data: Record<string, string>) {
  const event = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent
  Object.defineProperty(event, 'clipboardData', {
    value: { getData: (t: string) => data[t] ?? '', types: Object.keys(data), files: [], items: [] },
  })
  return Boolean(editor.view.someProp('handlePaste', (f) => f(editor.view, event, null as never)))
}
const names = (editor: Editor) => editor.getJSON().content?.map((n) => n.type)

describe('looksLikeMarkdown', () => {
  it.each(['# 標題\n- 項目', '1. a\n2. b', '- [ ] 待辦', '```ts\nx\n```', '> 引用', '| a | b |\n|---|---|\n| 1 | 2 |', '這是 **粗體** 文字', '看 [連結](https://a.com)'])(
    'true: %s',
    (t) => expect(looksLikeMarkdown(t)).toBe(true),
  )
  it.each(['這是一般句子。', '今天天氣很好，我們去散步！\n\n明天再說：好嗎？', 'Hello world, this is plain.', '價格 5 - 3 = 2', '#hashtag 不是標題', ''])(
    'false: %s',
    (t) => expect(looksLikeMarkdown(t)).toBe(false),
  )
})

describe('markdownToHtml', () => {
  it('drops raw html and scripts', () => {
    const html = markdownToHtml('<script>alert(1)</script>文字')
    expect(html).not.toContain('<script')
    expect(html).toContain('文字')
  })
  it('turns task markers into task lists', () => {
    const html = markdownToHtml('- [ ] a\n- [x] b')
    expect(html).toContain('data-type="taskList"')
    expect(html).toContain('data-checked="true"')
  })
  it('strips javascript: links', () => {
    expect(markdownToHtml('[x](javascript:alert(1))')).not.toContain('<a')
  })
})

describe('markdown paste', () => {
  it('converts markdown plain text into heading and bullet list', () => {
    const editor = make()
    expect(paste(editor, { 'text/plain': '# 標題\n\n- a\n- b' })).toBe(true)
    expect(names(editor)).toEqual(expect.arrayContaining(['heading', 'bulletList']))
  })
  it('pastes task items as a taskList', () => {
    const editor = make()
    paste(editor, { 'text/plain': '- [ ] a\n- [x] b' })
    expect(names(editor)).toContain('taskList')
  })
  it('leaves ordinary prose to the default handler', () => {
    const editor = make()
    expect(paste(editor, { 'text/plain': '一般句子。' })).toBe(false)
  })
  it('does not intercept html clipboards', () => {
    const editor = make()
    expect(paste(editor, { 'text/html': '<p>x</p>', 'text/plain': '# x' })).toBe(false)
  })
  it('sanitizes script in pasted html', () => {
    const editor = make()
    ;(globalThis as { ClipboardEvent?: unknown }).ClipboardEvent ??= Event
    editor.view.pasteHTML('<script>alert(1)</script>文字')
    expect(editor.getText()).toBe('文字')
  })
  it('does not intercept while composing', () => {
    const editor = make()
    Object.defineProperty(editor.view, 'composing', { value: true })
    expect(paste(editor, { 'text/plain': '# x' })).toBe(false)
  })
  it('leaves pastes inside a code block alone', () => {
    const editor = make()
    editor.commands.setCodeBlock()
    expect(paste(editor, { 'text/plain': '# comment\n- item' })).toBe(false)
    expect(names(editor)).toEqual(['codeBlock'])
  })
})
