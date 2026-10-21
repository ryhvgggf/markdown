import { useEffect } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
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
      <DragHandleMenu editor={e} />
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
    expect(screen.getByRole('menuitem', { name: '複製區塊連結' })).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByRole('menuitem', { name: '刪除' })).toBeInTheDocument()
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
})
