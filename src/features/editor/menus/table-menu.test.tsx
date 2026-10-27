import { useEffect } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as Y from 'yjs'
import { EditorContent, useEditor } from '@tiptap/react'
import type { Editor } from '@tiptap/core'
import { createExtensions, type EditorContext } from '../extensions'
import { TableMenu } from './TableMenu'
import { useTyping } from '../typing'

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
      <TableMenu editor={e} />
    </>
  )
}
afterEach(() => {
  cleanup()
  editor = null
})

const TABLE = '<p>before</p><table><tr><th><p>h1</p></th><th><p>h2</p></th></tr><tr><td><p>a</p></td><td><p>b</p></td></tr></table><p>after</p>'

function shape(e: Editor) {
  const t = e.state.doc.child(1)
  if (t.type.name !== 'table') return null
  return { rows: t.childCount, cols: t.child(0).childCount, text: t.textContent }
}
/** Puts the caret inside the cell whose text is `text`. */
function caretIn(e: Editor, text: string) {
  let at = -1
  e.state.doc.descendants((n, pos) => {
    if (at < 0 && n.isText && n.text === text) at = pos + 1
  })
  e.commands.focus()
  e.commands.setTextSelection(at)
}

async function setup() {
  render(<Harness />)
  await act(async () => void editor!.commands.setContent(TABLE))
}

describe('TableMenu', () => {
  it('typing mode: the button stays but is not re-measured per keystroke; it is re-placed when typing ends', async () => {
    await setup()
    await act(async () => caretIn(editor!, 'a'))
    await screen.findByRole('button', { name: '表格操作' })
    const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect')
    try {
      act(() => useTyping.setState({ typing: true }))
      rect.mockClear()
      for (const ch of 'xyz') await act(async () => void editor!.commands.insertContent(ch))
      expect(rect).not.toHaveBeenCalled()
      expect(screen.getByRole('button', { name: '表格操作' })).toBeInTheDocument()
      act(() => useTyping.setState({ typing: false }))
      expect(rect).toHaveBeenCalled()
    } finally {
      rect.mockRestore()
      useTyping.setState({ typing: false })
    }
  })

  it('shows the 表格操作 button only while the caret is in a table', async () => {
    await setup()
    await act(async () => caretIn(editor!, 'before'))
    expect(screen.queryByRole('button', { name: '表格操作' })).toBeNull()
    await act(async () => caretIn(editor!, 'a'))
    expect(await screen.findByRole('button', { name: '表格操作' })).toBeInTheDocument()
  })

  it.each([
    ['上方插入列', { rows: 3, cols: 2 }, 'h1h2ab'],
    ['下方插入列', { rows: 3, cols: 2 }, 'h1h2ab'],
    ['左側插入欄', { rows: 2, cols: 3 }, 'h1h2ab'],
    ['右側插入欄', { rows: 2, cols: 3 }, 'h1h2ab'],
    ['刪除列', { rows: 1, cols: 2 }, 'h1h2'],
    ['刪除欄', { rows: 2, cols: 1 }, 'h2b'], // the caret's (first) column goes,
  ])('%s', async (label, expected, text) => {
    await setup()
    await act(async () => caretIn(editor!, 'a'))
    await userEvent.click(await screen.findByRole('button', { name: '表格操作' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: label }))
    expect(shape(editor!)).toEqual({ ...expected, text })
  })

  it('刪除表格 removes the table and keeps the surrounding blocks', async () => {
    await setup()
    await act(async () => caretIn(editor!, 'b'))
    await userEvent.click(await screen.findByRole('button', { name: '表格操作' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: '刪除表格' }))
    expect(shape(editor!)).toBeNull()
    expect(editor!.getText()).toContain('before')
    expect(editor!.getText()).toContain('after')
  })

  it.each([
    ['Shift+F10', { key: 'F10', shiftKey: true }],
    ['the context-menu key', { key: 'ContextMenu' }],
  ])('%s with the caret in a cell opens the menu from the keyboard', async (_name, init) => {
    await setup()
    await act(async () => caretIn(editor!, 'a'))
    await act(async () => void fireEvent.keyDown(editor!.view.dom, init))
    expect(await screen.findByRole('menuitem', { name: '下方插入列' })).toBeInTheDocument()
  })

  it('the keyboard shortcut does nothing outside a table or while composing', async () => {
    await setup()
    await act(async () => caretIn(editor!, 'before'))
    await act(async () => void fireEvent.keyDown(editor!.view.dom, { key: 'F10', shiftKey: true }))
    await act(async () => caretIn(editor!, 'a'))
    await act(async () => void fireEvent.keyDown(editor!.view.dom, { key: 'ContextMenu', keyCode: 229 }))
    expect(screen.queryByRole('menuitem', { name: '下方插入列' })).toBeNull()
  })

  it('keeps the button inside the visible part of a horizontally scrolled table', async () => {
    const rect = (left: number, right: number, top = 100) =>
      ({ left, right, top, bottom: top + 40, x: left, y: top, width: right - left, height: 40, toJSON() {} }) as DOMRect
    const spy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.classList.contains('tableWrapper')) return rect(100, 600, 90)
      if (this.tagName === 'TD' || this.tagName === 'TH') return rect(500, 900) // runs past the wrapper's right edge
      return rect(0, 0)
    })
    try {
      await setup()
      await act(async () => caretIn(editor!, 'a'))
      await screen.findByRole('button', { name: '表格操作' })
      const box = document.querySelector('[data-table-menu]') as HTMLElement
      expect(box.style.left).toBe('570px') // wrapper right (600) - 30, not cell right (900) - 30
      expect(box.style.top).toBe('104px')
    } finally {
      spy.mockRestore()
    }
  })

  it('the button does not take the selection on mousedown', async () => {
    await setup()
    await act(async () => caretIn(editor!, 'a'))
    const before = editor!.state.selection.toJSON()
    const button = await screen.findByRole('button', { name: '表格操作' })
    expect(fireEvent.mouseDown(button)).toBe(false) // default prevented: focus stays in the editor
    expect(editor!.state.selection.toJSON()).toEqual(before)
  })
})

describe('Tab in tables', () => {
  const tab = (e: Editor, init: KeyboardEventInit = {}) =>
    e.view.someProp('handleKeyDown', (f) => f(e.view, new KeyboardEvent('keydown', { key: 'Tab', cancelable: true, ...init })))

  it('Tab in the last cell adds a row and moves into it', async () => {
    await setup()
    await act(async () => caretIn(editor!, 'b'))
    expect(tab(editor!)).toBe(true)
    expect(shape(editor!)).toMatchObject({ rows: 3, cols: 2 })
    expect(editor!.state.selection.$from.node(-2).type.name).toBe('tableRow')
    expect(editor!.state.selection.$from.index(1)).toBe(2) // in the new third row
  })

  it('Shift+Tab in the first cell stays put; Tab while composing does nothing', async () => {
    await setup()
    await act(async () => caretIn(editor!, 'h1'))
    expect(tab(editor!, { shiftKey: true })).toBe(true)
    expect(shape(editor!)).toMatchObject({ rows: 2, cols: 2 })
    await act(async () => caretIn(editor!, 'b'))
    expect(tab(editor!, { keyCode: 229 })).toBeFalsy()
    expect(shape(editor!)).toMatchObject({ rows: 2, cols: 2 })
  })
})
