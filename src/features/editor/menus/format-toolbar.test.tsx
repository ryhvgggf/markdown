import { useEffect } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import * as Y from 'yjs'
import { EditorContent, useEditor } from '@tiptap/react'
import { createExtensions, type EditorContext } from '../extensions'
import { FormatToolbar } from './FormatToolbar'
import { HIGHLIGHT_COLORS, TEXT_COLORS, contrast } from '../marks/formatting'
import type { Editor } from '@tiptap/core'

const ctx = { noteId: 'n1' } as unknown as EditorContext
let editor: Editor | null = null

function Harness() {
  const e = useEditor({ extensions: createExtensions(new Y.Doc(), ctx), })
  useEffect(() => {
    editor = e
  }, [e])
  return (
    <>
      <EditorContent editor={e} />
      <FormatToolbar editor={e} />
    </>
  )
}
afterEach(() => {
  cleanup()
  editor = null
})

const LABELS = ['粗體', '斜體', '底線', '刪除線', '行內程式碼', '連結', '文字顏色', '螢光標記', '轉為…']

describe('FormatToolbar', () => {
  it('typing with a collapsed caret dispatches nothing extra (no per-key option updates)', async () => {
    render(<Harness />)
    await act(async () => {
      editor!.commands.setContent('<p>hello</p>')
      editor!.commands.setTextSelection(6)
    })
    await act(async () => {}) // let mount effects settle
    let extra = 0
    const count = ({ transaction }: { transaction: import('@tiptap/pm/state').Transaction }) => {
      if (!transaction.docChanged && !transaction.selectionSet) extra++
    }
    editor!.on('transaction', count)
    for (const ch of 'abcde') {
      await act(async () => {
        editor!.commands.insertContent(ch)
      })
    }
    await act(async () => {})
    editor!.off('transaction', count)
    expect(extra).toBe(0)
  })

  it('is hidden without a selection', async () => {
    render(<Harness />)
    await act(async () => {
      editor!.commands.setContent('<p>hello world</p>')
    })
    expect(screen.queryByRole('button', { name: '粗體' })).toBeNull()
  })

  it('appears over a selection and bolds it', async () => {
    render(<Harness />)
    await act(async () => {
      editor!.commands.setContent('<p>hello world</p>')
    })
    await act(async () => {
      editor!.chain().focus().setTextSelection({ from: 1, to: 6 }).run()
    })
    for (const l of LABELS) expect(await screen.findByRole('button', { name: l })).toBeInTheDocument()
    const bold = screen.getByRole('button', { name: '粗體' })
    expect(bold).toHaveAttribute('aria-pressed', 'false')
    await act(async () => {
      fireEvent.click(bold)
    })
    expect(editor!.isActive('bold')).toBe(true)
    expect(screen.getByRole('button', { name: '粗體' })).toHaveAttribute('aria-pressed', 'true')
    expect(editor!.getHTML()).toContain('<strong>hello</strong>')
  })

  it('does not show inside code blocks', async () => {
    render(<Harness />)
    await act(async () => {
      editor!.commands.setContent('<p>hello world</p>')
    })
    await act(async () => {
      editor!.chain().focus().setTextSelection({ from: 1, to: 6 }).toggleCodeBlock().setTextSelection({ from: 1, to: 3 }).run()
    })
    expect(screen.queryByRole('button', { name: '粗體' })).toBeNull()
  })

  it('applies a link from the inline input and rejects javascript:', async () => {
    render(<Harness />)
    await act(async () => {
      editor!.commands.setContent('<p>hello world</p>')
    })
    await act(async () => {
      editor!.chain().focus().setTextSelection({ from: 1, to: 6 }).run()
    })
    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: '連結' }))
    })
    const input = screen.getByLabelText('連結網址')
    fireEvent.change(input, { target: { value: 'javascript:alert(1)' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(editor!.getHTML()).not.toContain('javascript')
    fireEvent.change(screen.getByLabelText('連結網址'), { target: { value: 'https://example.com' } })
    await act(async () => {
      fireEvent.keyDown(screen.getByLabelText('連結網址'), { key: 'Enter' })
    })
    expect(editor!.getHTML()).toContain('href="https://example.com"')
  })
})

describe('palette', () => {
  it('text colours pass 4.5:1 on white', () => {
    expect(TEXT_COLORS).toHaveLength(6)
    for (const c of TEXT_COLORS) expect(contrast(c.value, '#FFFFFF')).toBeGreaterThanOrEqual(4.5)
  })
  it('highlight backgrounds keep #1D1D1F readable', () => {
    expect(HIGHLIGHT_COLORS).toHaveLength(6)
    for (const c of HIGHLIGHT_COLORS) expect(contrast('#1D1D1F', c.value)).toBeGreaterThanOrEqual(4.5)
  })
})
