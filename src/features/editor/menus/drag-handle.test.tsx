import { useEffect } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as Y from 'yjs'
import { EditorContent, useEditor } from '@tiptap/react'
import type { Editor } from '@tiptap/core'
import { createExtensions, type EditorContext } from '../extensions'
import { DragHandleMenu } from './DragHandleMenu'

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
      <DragHandleMenu editor={e} noteId="n1" />
    </>
  )
}
afterEach(() => {
  cleanup()
  editor = null
})

describe('DragHandleMenu', () => {
  it('renders the grip and opens the block menu', async () => {
    render(<Harness />)
    await act(async () => {
      editor!.commands.setContent('<p>one</p><p>two</p>')
    })
    const grip = await screen.findByLabelText('拖曳以移動，點擊開啟選單')
    await userEvent.click(grip)
    expect(await screen.findByRole('menuitem', { name: /轉換類型/ })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: '複製區塊連結' })).not.toHaveAttribute('aria-disabled')
    expect(screen.getByRole('menuitem', { name: '刪除' })).toBeInTheDocument()
  })

  it('複製區塊連結 copies the target block link and confirms', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    render(<Harness />)
    await act(async () => {
      editor!.commands.setContent('<p>one</p><p>two</p>')
    })
    await act(async () => {
      editor!.commands.setTextSelection(7) // inside "two"
    })
    const id = editor!.state.doc.child(1).attrs.id as string
    expect(id).toBeTruthy()
    await userEvent.click(await screen.findByLabelText('拖曳以移動，點擊開啟選單'))
    await userEvent.click(await screen.findByRole('menuitem', { name: '複製區塊連結' }))
    expect(writeText).toHaveBeenCalledWith(`[[note:n1#${id}]]`)
    expect(await screen.findByText('已複製')).toBeInTheDocument()
  })

  it('刪除 removes the block the handle points at', async () => {
    render(<Harness />)
    await act(async () => {
      editor!.commands.setContent('<p>one</p><p>two</p>')
    })
    const grip = await screen.findByLabelText('拖曳以移動，點擊開啟選單')
    // point the handle at the first block (what hovering does)
    await act(async () => {
      editor!.commands.setTextSelection(2)
    })
    await userEvent.click(grip)
    await userEvent.click(await screen.findByRole('menuitem', { name: '刪除' }))
    expect(editor!.getText()).toBe('two')
  })

  async function convertVia(html: string, cursor: number, entry: string) {
    render(<Harness />)
    await act(async () => {
      editor!.commands.setContent(html)
      editor!.commands.setTextSelection(cursor)
    })
    const grip = await screen.findByLabelText('拖曳以移動，點擊開啟選單')
    await userEvent.click(grip)
    await userEvent.click(await screen.findByRole('menuitem', { name: /轉換類型/ }))
    await userEvent.click(await screen.findByRole('menuitem', { name: entry }))
  }

  it('converts a paragraph to 標題 1', async () => {
    await convertVia('<p>one</p><p>two</p>', 2, '標題 1')
    expect(editor!.getHTML()).toMatch(/^<h1[^>]*>one<\/h1><p/)
  })

  it('converts a bullet list to 段落, keeping the text', async () => {
    await convertVia('<ul><li><p>item</p></li></ul>', 3, '段落')
    expect(editor!.getHTML()).not.toContain('<ul')
    expect(editor!.getText()).toBe('item')
  })

  it('converts a paragraph to 項目清單', async () => {
    await convertVia('<p>one</p><p>two</p>', 2, '項目清單')
    expect(editor!.getHTML()).toMatch(/^<ul/)
    expect(editor!.getText()).toContain('one')
  })
})
