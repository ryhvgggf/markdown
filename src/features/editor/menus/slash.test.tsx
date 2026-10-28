import { useEffect } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import * as Y from 'yjs'
import { EditorContent, useEditor } from '@tiptap/react'
import type { Editor } from '@tiptap/core'
import { createExtensions, type EditorContext } from '../extensions'
import { SLASH_ITEMS, filterSlashItems, itemsOfGroup } from './slash-items'
import { registerTitle } from '../focus-bridge'

const ctx = {
  noteId: 'n1',
  vault: { listNotes: () => [], listFolders: () => [], getNote: () => undefined },
} as unknown as EditorContext
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
    expect(itemsOfGroup('block').map((i) => i.label)).toEqual([
      '文字', '標題 1', '標題 2', '標題 3', '項目清單', '編號清單', '待辦清單', '引用', '提示框', '程式碼', '表格', '分隔線',
    ])
    expect(itemsOfGroup('format').map((i) => i.label)).toEqual(['粗體', '斜體', '底線', '刪除線', '螢光', '行內程式碼'])
    expect(itemsOfGroup('insert').map((i) => i.label)).toEqual(['圖片或影片', '檔案', '連結筆記', '標籤'])
    expect(SLASH_ITEMS.find((i) => i.label === '檔案')).toMatchObject({ hint: '上傳任意檔案，提供下載' })
    expect(filterSlashItems('pdf').map((i) => i.label)).toEqual(['檔案'])
    expect(SLASH_ITEMS.find((i) => i.label === '圖片或影片')).toMatchObject({ hint: '上傳或拖入圖片、影片' })
    expect(SLASH_ITEMS.find((i) => i.label === '圖片或影片')?.disabled).toBeUndefined()
  })
  it('matches label and aliases case-insensitively', () => {
    expect(filterSlashItems('標題').map((i) => i.label)).toEqual(['標題 1', '標題 2', '標題 3'])
    expect(filterSlashItems('TODO').map((i) => i.label)).toEqual(['待辦清單'])
    expect(filterSlashItems('h1').map((i) => i.label)).toContain('標題 1')
    expect(filterSlashItems('')).toHaveLength(SLASH_ITEMS.length)
    expect(filterSlashItems('zzz')).toEqual([])
  })
})

describe('slash menu: formatting and mid-line', () => {
  it('opens after text (also right after Chinese) and 螢光 highlights what is typed next', async () => {
    await setup('<p>這是重點</p>')
    await type('/螢光')
    expect((await screen.findAllByRole('option', { name: /螢光/ })).length).toBeGreaterThan(0)
    await key('Enter')
    expect(editor!.getText()).toBe('這是重點')
    await type('很重要')
    expect(editor!.getHTML()).toContain('<mark')
    expect(editor!.getHTML()).toMatch(/<mark[^>]*>很重要<\/mark>/)
  })
  it('stays quiet inside URLs, "and/or", and when nothing matches', async () => {
    await setup('<p>see https:</p>')
    await type('/')
    expect(screen.queryByRole('listbox')).toBeNull()
    await setup('<p>是</p>')
    await type('/否')
    expect(screen.queryByRole('listbox')).toBeNull()
  })
})

describe('slash menu tabs', () => {
  it('← → switch tabs while the query is empty; a query searches every tab', async () => {
    await setup()
    await type('/')
    expect(await screen.findByRole('tab', { name: '區塊', selected: true })).toBeInTheDocument()
    await key('ArrowRight')
    expect(screen.getByRole('tab', { name: '文字格式', selected: true })).toBeInTheDocument()
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(expect.arrayContaining([expect.stringContaining('螢光')]))
    await key('ArrowLeft')
    await key('ArrowLeft') // wraps to the last tab
    expect(screen.getByRole('tab', { name: '插入', selected: true })).toBeInTheDocument()
    await type('螢')
    expect(screen.queryByRole('tablist')).toBeNull()
    expect(screen.getAllByRole('option').length).toBeGreaterThan(1) // 螢光 and the coloured 螢光・…
  })
  it('a colour item colours what is typed next', async () => {
    await setup()
    await type('/紅')
    await key('Enter')
    await type('字')
    expect(editor!.getHTML()).toMatch(/<span[^>]*color[^>]*>字<\/span>/)
  })
})

const html = () => editor!.getHTML().replace(/ data-block-id="[^"]*"/g, '')

describe('→ leaves a style', () => {
  it('at the end of styled text → drops the style without moving; the next → moves', async () => {
    await setup('<p><strong>粗</strong></p>')
    expect(editor!.state.selection.from).toBe(2)
    await key('ArrowRight')
    expect(editor!.state.selection.from).toBe(2)
    await type('後')
    expect(html()).toBe('<p><strong>粗</strong>後</p>')
  })
  it('keeps a style that continues into the next character', async () => {
    await setup('<p><strong>粗粗</strong></p>')
    await act(async () => void editor!.commands.setTextSelection(2))
    await key('ArrowRight')
    expect(editor!.state.storedMarks ?? editor!.state.selection.$from.marks()).toHaveLength(1)
  })
  it('cancels a style just switched on from the menu', async () => {
    await setup('<p>字</p>')
    await act(async () => void editor!.chain().focus().toggleHighlight({ color: '#FFF1A8' }).run())
    await key('ArrowRight')
    await type('後')
    expect(html()).toBe('<p>字後</p>')
  })
})

describe('slash menu', () => {
  it('opens on / in an empty paragraph and filters', async () => {
    await setup()
    await type('/')
    expect(await screen.findByRole('listbox')).toBeInTheDocument()
    expect(screen.getAllByRole('option')).toHaveLength(itemsOfGroup('block').length)
    await type('標題')
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual([
      expect.stringContaining('標題 1'), expect.stringContaining('標題 2'), expect.stringContaining('標題 3'),
    ])
    await type('九')
    expect(screen.getByText('沒有符合的功能')).toBeInTheDocument()
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

  it('runs the media item by opening the file picker', async () => {
    await setup()
    const click = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {})
    await type('/圖片')
    await screen.findByRole('option')
    await key('Enter')
    expect(click).toHaveBeenCalledTimes(1)
    expect(editor!.getText()).toBe('')
    click.mockRestore()
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

describe('open suggestion popups own the navigation keys', () => {
  let titleInput: HTMLInputElement
  afterEach(() => {
    registerTitle('n1', null)
    titleInput?.remove()
  })
  const withTitle = () => {
    titleInput = document.createElement('input')
    titleInput.value = 'Title'
    document.body.appendChild(titleInput)
    registerTitle('n1', titleInput)
  }
  /** keydown on the editor; returns true when it was consumed (default prevented). */
  const consumed = async (k: string, init: KeyboardEventInit = {}) => {
    let notPrevented = true
    await act(async () => {
      notPrevented = fireEvent.keyDown(editor!.view.dom, { key: k, ...init })
    })
    return !notPrevented
  }

  it('ArrowUp in the first block moves the slash highlight, not the caret into the title', async () => {
    withTitle()
    await setup()
    await type('/')
    await screen.findByRole('listbox')
    expect(await consumed('ArrowUp')).toBe(true)
    expect(titleInput).not.toHaveFocus()
    const options = screen.getAllByRole('option')
    expect(options[options.length - 1]).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('listbox')).toBeInTheDocument()
  })

  it('ArrowUp in the first block with the [[ menu open stays in the menu', async () => {
    withTitle()
    await setup()
    await type('[[')
    await screen.findByText('沒有符合的筆記')
    expect(await consumed('ArrowUp')).toBe(true)
    expect(titleInput).not.toHaveFocus()
    expect(await consumed('ArrowDown')).toBe(true)
  })

  it('Enter with an empty [[ list does not split the paragraph', async () => {
    await setup()
    await type('[[')
    await screen.findByText('沒有符合的筆記')
    expect(await consumed('Enter')).toBe(true)
    expect(editor!.state.doc.childCount).toBe(1)
  })

  it('Enter with no matching slash item closes the menu and keeps the text on one line', async () => {
    await setup()
    await type('/zzz')
    await screen.findByText('沒有符合的功能')
    expect(await consumed('Enter')).toBe(true)
    expect(screen.queryByText('沒有符合的功能')).toBeNull()
    expect(editor!.getText()).toBe('/zzz')
    expect(editor!.state.doc.childCount).toBe(1)
  })

  it('Tab with the slash menu open does not indent the list item', async () => {
    await setup('<ul><li><p>one</p></li><li><p></p></li></ul>')
    await type('/')
    await screen.findByRole('listbox')
    expect(await consumed('Tab')).toBe(true)
    expect(editor!.state.doc.firstChild!.childCount).toBe(2) // still two sibling items: not indented
    expect(screen.getByRole('listbox')).toBeInTheDocument()
  })

  it('ArrowUp in the first block still goes to the title once the menu is closed', async () => {
    withTitle()
    await setup()
    await type('/')
    await screen.findByRole('listbox')
    await key('Escape')
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(await consumed('ArrowUp')).toBe(true)
    expect(titleInput).toHaveFocus()
  })

  it('never handles keys during IME composition', async () => {
    withTitle()
    await setup()
    await type('/')
    await screen.findByRole('listbox')
    const view = editor!.view
    const plugin = view.state.plugins.find((p) => (p as unknown as { key: string }).key.startsWith('slashCommand'))!
    const ev = new KeyboardEvent('keydown', { key: 'ArrowDown', keyCode: 229 })
    let handled = true
    await act(async () => {
      handled = Boolean(plugin.props.handleKeyDown!.call(plugin, view, ev))
    })
    expect(handled).toBe(false)
    expect(screen.getAllByRole('option')[0]).toHaveAttribute('aria-selected', 'true')
  })
})
