import { afterEach, expect, it } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import * as Y from 'yjs'
import { Editor } from '@tiptap/core'
import { EditorContent } from '@tiptap/react'
import { createExtensions, type EditorContext } from '../extensions'

let editor: Editor | null = null
afterEach(() => editor?.destroy())

it('language change moves focus back into the editor at the end of the code', async () => {
  editor = new Editor({ extensions: createExtensions(new Y.Doc(), { noteId: 'n1' } as unknown as EditorContext) })
  editor.commands.setContent('<pre><code>abc</code></pre>')
  render(<EditorContent editor={editor} />)
  const select = await screen.findByLabelText('程式語言')
  select.focus()
  await act(async () => {
    fireEvent.change(select, { target: { value: 'sql' } })
  })
  await act(async () => {
    await new Promise((r) => setTimeout(r, 50))
  })
  expect(editor.getJSON().content![0].attrs?.language).toBe('sql')
  expect(select.ownerDocument.activeElement).not.toBe(select)
  expect(editor.view.dom.contains(select.ownerDocument.activeElement)).toBe(true)
  expect(editor.state.selection.from).toBe(4)
})

it('plain text (null language) is not auto-highlighted, abap is', async () => {
  editor = new Editor({ extensions: createExtensions(new Y.Doc(), { noteId: 'n1' } as unknown as EditorContext) })
  editor.commands.setContent(
    '<pre><code>SELECT * FROM t</code></pre><pre><code class="language-abap">SELECT * FROM t</code></pre>',
  )
  const { container } = render(<EditorContent editor={editor} />)
  await screen.findAllByLabelText('程式語言')
  const blocks = container.querySelectorAll('.code-block')
  expect(blocks).toHaveLength(2)
  expect(editor.getJSON().content![0].attrs?.language).toBeNull()
  expect(blocks[0].querySelector('.hljs-keyword')).toBeNull()
  expect(blocks[1].querySelector('.hljs-keyword')).not.toBeNull()
})
