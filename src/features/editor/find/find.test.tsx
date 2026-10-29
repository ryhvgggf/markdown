import { useEffect } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as Y from 'yjs'
import { EditorContent, useEditor } from '@tiptap/react'
import type { Editor } from '@tiptap/core'
import { createExtensions, type EditorContext } from '../extensions'
import { FindBar } from './FindBar'

const ctx = { noteId: 'n1' } as unknown as EditorContext
let editor: Editor | null = null

function Harness() {
  const e = useEditor({ extensions: createExtensions(new Y.Doc(), ctx) })
  useEffect(() => {
    editor = e
  }, [e])
  return (
    <>
      <EditorContent editor={e} />
      <FindBar editor={e} />
    </>
  )
}
afterEach(() => {
  cleanup()
  editor = null
})

async function setup(content: string) {
  render(<Harness />)
  await act(async () => void editor!.commands.setContent(content))
}

describe('FindBar', () => {
  it('is not shown until Ctrl/Cmd+F is pressed, then opens and focuses the input', async () => {
    await setup('<p>hello world hello</p>')
    expect(screen.queryByRole('search', { name: '尋找' })).toBeNull()
    await act(async () => void fireEvent.keyDown(editor!.view.dom, { key: 'f', ctrlKey: true }))
    const input = await screen.findByLabelText('尋找文字')
    expect(input).toHaveFocus()
  })

  it('highlights matches and shows a count as you type', async () => {
    await setup('<p>hello world hello</p>')
    await act(async () => void fireEvent.keyDown(editor!.view.dom, { key: 'f', ctrlKey: true }))
    const input = await screen.findByLabelText('尋找文字')
    await userEvent.type(input, 'hello')
    expect(screen.getByText('1 / 2')).toBeInTheDocument()
    expect(editor!.view.dom.querySelectorAll('.find-match')).toHaveLength(2)
  })

  it('steps through matches with next/prev, wrapping around', async () => {
    await setup('<p>a a a</p>')
    await act(async () => void fireEvent.keyDown(editor!.view.dom, { key: 'f', ctrlKey: true }))
    const input = await screen.findByLabelText('尋找文字')
    await userEvent.type(input, 'a')
    expect(screen.getByText('1 / 3')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '下一個' }))
    expect(screen.getByText('2 / 3')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '上一個' }))
    await userEvent.click(screen.getByRole('button', { name: '上一個' }))
    expect(screen.getByText('3 / 3')).toBeInTheDocument() // wrapped backwards past the first match
  })

  it('Escape closes the find bar', async () => {
    await setup('<p>hello</p>')
    await act(async () => void fireEvent.keyDown(editor!.view.dom, { key: 'f', ctrlKey: true }))
    await screen.findByLabelText('尋找文字')
    await act(async () => void fireEvent.keyDown(editor!.view.dom, { key: 'Escape' }))
    expect(screen.queryByRole('search', { name: '尋找' })).toBeNull()
  })

  it('全部套用 replaces every match with the given text, in one undo step', async () => {
    await setup('<p>[123] and [123] again</p>')
    await act(async () => void fireEvent.keyDown(editor!.view.dom, { key: 'f', ctrlKey: true }))
    const input = await screen.findByLabelText('尋找文字')
    await userEvent.type(input, '[[123]')
    await userEvent.click(screen.getByRole('button', { name: '取代／格式' }))
    await userEvent.type(screen.getByLabelText('取代為'), '[[456]')
    await userEvent.click(screen.getByRole('button', { name: '套用' }))
    expect(editor!.getText()).toBe('[456] and [456] again')
    editor!.commands.undo()
    expect(editor!.getText()).toBe('[123] and [123] again')
  })

  it('套用 with only a color selected changes formatting but leaves the text untouched', async () => {
    await setup('<p>hello hello</p>')
    await act(async () => void fireEvent.keyDown(editor!.view.dom, { key: 'f', ctrlKey: true }))
    const input = await screen.findByLabelText('尋找文字')
    await userEvent.type(input, 'hello')
    await userEvent.click(screen.getByRole('button', { name: '取代／格式' }))
    await userEvent.click(screen.getByRole('button', { name: '紅' }))
    await userEvent.click(screen.getByRole('button', { name: '套用' }))
    expect(editor!.getText()).toBe('hello hello')
    const html = editor!.getHTML()
    // jsdom serializes inline style colors as rgb(), not the hex we set.
    expect((html.match(/rgb\(198, 40, 40\)/g) ?? []).length).toBe(2)
  })

  it('套用按鈕在沒有符合項目或兩個欄位都空白時是停用的', async () => {
    await setup('<p>hello</p>')
    await act(async () => void fireEvent.keyDown(editor!.view.dom, { key: 'f', ctrlKey: true }))
    await userEvent.click(screen.getByRole('button', { name: '取代／格式' }))
    expect(screen.getByRole('button', { name: '套用' })).toBeDisabled()
  })
})
