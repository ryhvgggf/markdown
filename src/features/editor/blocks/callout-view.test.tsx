import { afterEach, expect, it } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import * as Y from 'yjs'
import { Editor } from '@tiptap/core'
import { EditorContent } from '@tiptap/react'
import { createExtensions, type EditorContext } from '../extensions'

let editor: Editor | null = null
afterEach(() => editor?.destroy())

it('callout icon button renders an svg and cycles info, warning, tip', async () => {
  editor = new Editor({ extensions: createExtensions(new Y.Doc(), { noteId: 'n1' } as unknown as EditorContext) })
  editor.commands.insertCallout()
  render(<EditorContent editor={editor} />)
  const btn = await screen.findByLabelText('切換提示框圖示')
  expect(btn.querySelector('svg')).not.toBeNull()
  expect(btn.textContent).toBe('')
  const icon = () => editor!.getJSON().content!.find((n) => n.type === 'callout')!.attrs?.icon
  for (const want of ['warning', 'tip', 'info']) {
    await act(async () => {
      fireEvent.click(btn)
    })
    expect(icon()).toBe(want)
  }
})
