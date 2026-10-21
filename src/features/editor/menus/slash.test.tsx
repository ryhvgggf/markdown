import { useEffect } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import * as Y from 'yjs'
import { EditorContent, useEditor } from '@tiptap/react'
import type { Editor } from '@tiptap/core'
import { createExtensions, type EditorContext } from '../extensions'
import { SLASH_ITEMS, filterSlashItems } from './slash-items'

const ctx = { noteId: 'n1' } as unknown as EditorContext
let editor: Editor | null = null

function Harness() {
  const e = useEditor({ extensions: createExtensions(new Y.Doc(), ctx) })
  useEffect(() => {
    editor = e
  }, [e])
  return <EditorContent editor={e} />
}
afterEach(() => {
  cleanup()
  editor = null
})

async function setup(html = '<p></p>') {
  render(<Harness />)
  await act(async () => {
    editor!.commands.setContent(html)
    editor!.commands.focus('end')
  })
}
const type = (text: string) =>
  act(async () => {
    editor!.commands.insertContent(text)
  })
const key = (k: string, init: KeyboardEventInit = {}) =>
  act(async () => {
    fireEvent.keyDown(editor!.view.dom, { key: k, ...init })
  })

describe('SLASH_ITEMS / filterSlashItems', () => {
  it('lists blocks in the specified order', () => {
    expect(SLASH_ITEMS.map((i) => i.label)).toEqual([
      '文字', '標題 1', '標題 2', '標題 3', '項目清單', '編號清單', '待辦清單', '引用', '提示框', '程式碼', '表格', '分隔線', '圖片或影片',
    ])
    expect(SLASH_ITEMS.find((i) => i.label === '圖片或影片')).toMatchObject({ disabled: true, hint: '即將推出' })
  })
  it('matches label and aliases case-insensitively', () => {
    expect(filterSlashItems('標題').map((i) => i.label)).toEqual(['標題 1', '標題 2', '標題 3'])
    expect(filterSlashItems('TODO').map((i) => i.label)).toEqual(['待辦清單'])
    expect(filterSlashItems('h1').map((i) => i.label)).toContain('標題 1')
    expect(filterSlashItems('')).toHaveLength(SLASH_ITEMS.length)
    expect(filterSlashItems('zzz')).toEqual([])
  })
})

describe('slash menu', () => {
  it('opens on / in an empty paragraph and filters', async () => {
    await setup()
    await type('/')
    expect(await screen.findByRole('listbox')).toBeInTheDocument()
    expect(screen.getAllByRole('option')).toHaveLength(SLASH_ITEMS.length)
    await type('標題')
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual([
      expect.stringContaining('標題 1'), expect.stringContaining('標題 2'), expect.stringContaining('標題 3'),
    ])
    await type('九')
    expect(screen.getByText('沒有符合的區塊')).toBeInTheDocument()
  })

  it('arrows move, Enter runs and removes the /query text', async () => {
    await setup()
    await type('/標題')
    await screen.findByRole('listbox')
    await key('ArrowDown')
    expect(screen.getAllByRole('option')[1]).toHaveAttribute('aria-selected', 'true')
    await key('Enter')
    expect(editor!.getHTML()).toMatch(/^<h2[^>]*><\/h2>$/)
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('Escape closes and keeps the typed text', async () => {
    await setup()
    await type('/標題')
    await screen.findByRole('listbox')
    await key('Escape')
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(editor!.getText()).toBe('/標題')
  })

  it('Enter while composing does not run an item and the menu stays open', async () => {
    await setup()
    await type('/表格')
    await screen.findByRole('listbox')
    // Call the suggestion plugin's handler directly: ProseMirror itself already drops keydown near a
    // composition, so this proves the menu's own guard rather than PM's.
    const view = editor!.view
    const plugin = view.state.plugins.find((p) => (p as unknown as { key: string }).key.startsWith('slashCommand'))!
    for (const init of [{ isComposing: true }, { keyCode: 229 }]) {
      const ev = new KeyboardEvent('keydown', { key: 'Enter', ...init })
      await act(async () => {
        plugin.props.handleKeyDown!.call(plugin, view, ev)
      })
    }
    expect(screen.getByRole('listbox')).toBeInTheDocument()
    expect(editor!.getText()).toBe('/表格')
    expect(editor!.getHTML()).not.toContain('<table')
  })

  it('runs table', async () => {
    await setup()
    await type('/表格')
    await screen.findByRole('listbox')
    await key('Enter')
    expect(editor!.getHTML()).toContain('<table')
    expect(editor!.getText()).not.toContain('/表格')
  })

  it('does not run the disabled media item', async () => {
    await setup()
    await type('/圖片')
    await screen.findByRole('option')
    await key('Enter')
    expect(editor!.getText()).toBe('/圖片')
  })

  it('does not open after existing text on the line', async () => {
    await setup('<p>hello </p>')
    await type('/')
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('does not open inside a code block', async () => {
    await setup('<pre><code></code></pre>')
    await type('/')
    expect(screen.queryByRole('listbox')).toBeNull()
  })
})
