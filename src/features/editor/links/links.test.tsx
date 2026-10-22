import { useEffect } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import * as Y from 'yjs'
import { EditorContent, useEditor } from '@tiptap/react'
import type { Editor, JSONContent } from '@tiptap/core'
import { MemoryStorage } from '@/adapters/storage/memory-storage'
import { createDb, type NotesDb } from '@/adapters/storage/db'
import { Vault } from '@/core/vault/vault'
import { createExtensions, type EditorContext } from '../extensions'
import { copyBlockLink, formatBlockLink, parseBlockLink } from './block-link-clipboard'
import { noteLinkLabel } from './note-link'
import { setBlockHighlight } from './block-highlight'

const fakeChannel = () =>
  ({ postMessage() {}, close() {}, onmessage: null, addEventListener() {}, removeEventListener() {} }) as unknown as BroadcastChannel

let vault: Vault
let db: NotesDb
let ctx: EditorContext
let editor: Editor | null = null

beforeEach(async () => {
  vault = await Vault.open(new MemoryStorage(), 'v1', { channelFactory: fakeChannel })
  db = createDb('links-' + Math.random().toString(36).slice(2))
  await db.open()
  ctx = {
    vault,
    noteId: 'current',
    openNote: vi.fn(),
    searchBlocks: (id, q) =>
      db.blocks
        .where('noteId')
        .equals(id)
        .filter((b) => b.text.toLowerCase().includes(q.toLowerCase()))
        .toArray(),
    db,
    storage: new MemoryStorage(),
  }
})
afterEach(() => {
  cleanup()
  editor = null
  vault.close()
  db.close()
})

function Harness() {
  const e = useEditor({ extensions: createExtensions(new Y.Doc(), ctx) })
  useEffect(() => {
    editor = e
  }, [e])
  return <EditorContent editor={e} />
}
async function setup(content: string | JSONContent = '<p></p>') {
  render(<Harness />)
  await act(async () => {
    editor!.commands.setContent(content)
    editor!.commands.focus('end')
  })
}
const insert = (text: string) =>
  act(async () => {
    editor!.commands.insertContent(text)
  })
const key = (k: string) =>
  act(async () => {
    fireEvent.keyDown(editor!.view.dom, { key: k })
  })
/** Types like a user: each character goes through handleTextInput, so input rules run. */
const typeChars = (text: string) =>
  act(async () => {
    for (const ch of text) {
      const view = editor!.view
      const { from, to } = view.state.selection
      const handled = view.someProp('handleTextInput', (f) => f(view, from, to, ch, () => view.state.tr.insertText(ch, from, to)))
      if (!handled) view.dispatch(view.state.tr.insertText(ch, from, to))
    }
  })
function nodesOf(type: string): JSONContent[] {
  const out: JSONContent[] = []
  const walk = (n: JSONContent) => {
    if (n.type === type) out.push(n)
    n.content?.forEach(walk)
  }
  walk(editor!.getJSON())
  return out
}
function paste(text: string) {
  const event = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent
  Object.defineProperty(event, 'clipboardData', {
    value: { getData: (t: string) => (t === 'text/plain' ? text : ''), types: ['text/plain'], files: [], items: [] },
  })
  return Boolean(editor!.view.someProp('handlePaste', (f) => f(editor!.view, event, null as never)))
}
const linkDoc = (noteId: string, blockId: string | null = null): JSONContent => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: '見 ' }, { type: 'noteLink', attrs: { noteId, blockId } }] }],
})

describe('noteLinkLabel', () => {
  it('labels notes, blocks and deleted targets', () => {
    const n = vault.createNote({ title: '採購流程' })
    expect(noteLinkLabel(vault, { noteId: n.id, blockId: null })).toEqual({ text: '採購流程', state: 'ok' })
    expect(noteLinkLabel(vault, { noteId: n.id, blockId: 'b1' }, '核准層級依金額決定，超過十萬元需要經理簽核')).toEqual({
      text: '採購流程 › 核准層級依金額決定，超過十萬元需要經理簽…',
      state: 'ok',
    })
    expect(noteLinkLabel(vault, { noteId: n.id, blockId: 'b1' }, '核准層級')).toEqual({ text: '採購流程 › 核准層級', state: 'ok' })
    expect(noteLinkLabel(vault, { noteId: n.id, blockId: 'b1' })).toEqual({ text: '已刪除的區塊', state: 'deleted-block' })
    vault.trashNote(n.id)
    expect(noteLinkLabel(vault, { noteId: n.id, blockId: null })).toEqual({ text: '已刪除的筆記', state: 'deleted-note' })
    expect(noteLinkLabel(vault, { noteId: 'missing', blockId: 'b1' }, 'x')).toEqual({ text: '已刪除的筆記', state: 'deleted-note' })
  })
  it('uses 未命名 for blank titles', () => {
    const n = vault.createNote({ title: '' })
    expect(noteLinkLabel(vault, { noteId: n.id, blockId: null }).text).toBe('未命名')
  })
})

describe('block link format', () => {
  it('round-trips and rejects malformed text', () => {
    expect(formatBlockLink('n1', 'b1')).toBe('[[note:n1#b1]]')
    expect(formatBlockLink('n1', null)).toBe('[[note:n1]]')
    expect(parseBlockLink(formatBlockLink('n1', 'b1'))).toEqual({ noteId: 'n1', blockId: 'b1' })
    expect(parseBlockLink(formatBlockLink('V1StGXR8_Z5jdHi6B-myT', null))).toEqual({ noteId: 'V1StGXR8_Z5jdHi6B-myT', blockId: null })
    expect(parseBlockLink('  [[note:n1#b1]]\n')).toEqual({ noteId: 'n1', blockId: 'b1' })
    for (const bad of ['[[n1#b1]]', '[[note:]]', '[[note:n1#]]', 'x [[note:n1]]', '[[note:n 1]]', '[[note:n1]] [[note:n2]]', '']) {
      expect(parseBlockLink(bad)).toBeNull()
    }
  })
  it('copyBlockLink writes the token to the clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    await copyBlockLink('n1', 'b1')
    expect(writeText).toHaveBeenCalledWith('[[note:n1#b1]]')
  })
})

describe('[[ suggestion', () => {
  it('lists matching notes with folder path and inserts a noteLink', async () => {
    const folder = vault.createFolder({ name: '工作', parentId: null })
    const n = vault.createNote({ title: '採購流程', folderId: folder.id })
    vault.createNote({ title: '會議紀錄' })
    await setup()
    await insert('[[採')
    const options = await screen.findAllByRole('option')
    expect(options[0]).toHaveTextContent('採購流程')
    expect(options[0]).toHaveTextContent('工作')
    expect(options.map((o) => o.textContent)).not.toContainEqual(expect.stringContaining('會議紀錄'))
    expect(options.at(-1)).toHaveTextContent('建立新筆記「採」')
    await key('Enter')
    expect(nodesOf('noteLink')).toEqual([expect.objectContaining({ attrs: { noteId: n.id, blockId: null } })])
    expect(nodesOf('text').map((t) => t.text).join('')).not.toContain('[[')
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('hides trashed notes and omits the create row on an exact title match', async () => {
    const t = vault.createNote({ title: '採購舊版' })
    vault.trashNote(t.id)
    vault.createNote({ title: '採購' })
    await setup()
    await insert('[[採購')
    const options = await screen.findAllByRole('option')
    expect(options).toHaveLength(1)
    expect(options[0]).toHaveTextContent('採購')
  })

  it('creates a new note from the last row and links it', async () => {
    vault.createNote({ title: '採購流程' })
    await setup()
    await insert('[[採')
    const create = await screen.findByRole('option', { name: /建立新筆記「採」/ })
    await act(async () => {
      fireEvent.click(create)
    })
    const created = vault.listNotes().find((x) => x.title === '採')
    expect(created).toBeDefined()
    expect(nodesOf('noteLink')).toEqual([expect.objectContaining({ attrs: { noteId: created!.id, blockId: null } })])
    expect(ctx.openNote).not.toHaveBeenCalled()
  })

  it('lists blocks of the named note after # and links the block', async () => {
    const n = vault.createNote({ title: '採購流程' })
    await db.blocks.bulkPut([
      { noteId: n.id, blockId: 'h1', type: 'heading', text: '核准' },
      { noteId: n.id, blockId: 'p1', type: 'paragraph', text: '核准層級依金額決定' },
      { noteId: n.id, blockId: 'p2', type: 'paragraph', text: '其他內容' },
      { noteId: 'other', blockId: 'x', type: 'paragraph', text: '核准別處' },
    ])
    await setup()
    await insert('[[採購流程#核准層')
    const options = await screen.findAllByRole('option')
    expect(options).toHaveLength(1)
    expect(options[0]).toHaveTextContent('段落')
    expect(options[0]).toHaveTextContent('核准層級依金額決定')
    await key('Enter')
    expect(nodesOf('noteLink')).toEqual([expect.objectContaining({ attrs: { noteId: n.id, blockId: 'p1' } })])
  })

  it('Enter with no items closes the menu without inserting or splitting the line', async () => {
    vault.createNote({ title: '採購流程' })
    await setup()
    await insert('[[採購流程#zzz')
    expect(await screen.findByText('沒有符合的區塊')).toBeInTheDocument()
    const blocks = editor!.state.doc.childCount
    await key('Enter')
    expect(nodesOf('noteLink')).toEqual([])
    expect(screen.queryByText('沒有符合的區塊')).toBeNull()
    expect(editor!.state.doc.childCount).toBe(blocks)
  })

  it('Enter while composing does not insert', async () => {
    vault.createNote({ title: '採購流程' })
    await setup()
    await insert('[[採')
    await screen.findAllByRole('option')
    const view = editor!.view
    const plugin = view.state.plugins.find((p) => (p as unknown as { key: string }).key.startsWith('noteLinkSuggestion'))!
    await act(async () => {
      plugin.props.handleKeyDown!.call(plugin, view, new KeyboardEvent('keydown', { key: 'Enter', isComposing: true }))
    })
    expect(nodesOf('noteLink')).toEqual([])
    expect(screen.getByRole('listbox')).toBeInTheDocument()
  })

  it('does not open inside a code block', async () => {
    vault.createNote({ title: '採購流程' })
    await setup('<pre><code></code></pre>')
    await insert('[[採')
    expect(screen.queryByRole('listbox')).toBeNull()
  })
})

describe('noteLink node view', () => {
  it('follows renames and opens the target on click', async () => {
    const n = vault.createNote({ title: '採購流程' })
    await setup(linkDoc(n.id))
    const link = await screen.findByRole('link', { name: '前往 採購流程' })
    await act(async () => {
      vault.renameNote(n.id, '請購流程')
    })
    expect(link).toHaveTextContent('請購流程')
    expect(link).toHaveAttribute('aria-label', '前往 請購流程')
    fireEvent.click(link)
    expect(ctx.openNote).toHaveBeenCalledWith(n.id, undefined)
  })

  it('shows block text from the index and passes the block id', async () => {
    const n = vault.createNote({ title: '採購流程' })
    await db.blocks.put({ noteId: n.id, blockId: 'p1', type: 'paragraph', text: '核准層級依金額決定' })
    await setup(linkDoc(n.id, 'p1'))
    const link = await screen.findByRole('link', { name: '前往 採購流程 › 核准層級依金額決定' })
    fireEvent.click(link)
    expect(ctx.openNote).toHaveBeenCalledWith(n.id, 'p1')
  })

  it('renders deleted block and deleted note states, not clickable, and recovers on restore', async () => {
    const n = vault.createNote({ title: '採購流程' })
    ctx.peekNoteDoc = (id) => (id === n.id ? new Y.Doc() : undefined) // loaded target doc without that block
    await setup({
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'noteLink', attrs: { noteId: n.id, blockId: 'gone' } }] },
        { type: 'paragraph', content: [{ type: 'noteLink', attrs: { noteId: n.id, blockId: null } }] },
      ],
    })
    expect(await screen.findByText('已刪除的區塊')).toHaveAttribute('data-state', 'deleted-block')
    await act(async () => vault.trashNote(n.id))
    const deleted = screen.getAllByText('已刪除的筆記')
    expect(deleted).toHaveLength(2)
    deleted.forEach((el) => {
      expect(el).toHaveAttribute('data-state', 'deleted-note')
      expect(el).toHaveClass('line-through')
    })
    fireEvent.click(deleted[1])
    expect(ctx.openNote).not.toHaveBeenCalled()
    await act(async () => vault.restoreNote(n.id))
    expect(screen.getByRole('link', { name: '前往 採購流程' })).toBeInTheDocument()
  })

  it('a missing row in a never-indexed note is unknown: title label, clickable', async () => {
    const n = vault.createNote({ title: '採購流程' })
    await setup(linkDoc(n.id, 'p1'))
    const link = await screen.findByRole('link', { name: '前往 採購流程' })
    await act(async () => new Promise((r) => setTimeout(r, 50)))
    expect(link).toHaveAttribute('data-state', 'ok')
    fireEvent.click(link)
    expect(ctx.openNote).toHaveBeenCalledWith(n.id, 'p1')
  })

  it('a loaded doc that still has the block keeps the link unknown, not deleted', async () => {
    const n = vault.createNote({ title: '採購流程' })
    await db.blocks.put({ noteId: n.id, blockId: 'other', type: 'paragraph', text: 'x' })
    const doc = new Y.Doc()
    const p = new Y.XmlElement('paragraph')
    p.setAttribute('id', 'p1')
    doc.getXmlFragment('content').insert(0, [p])
    ctx.peekNoteDoc = () => doc
    await setup(linkDoc(n.id, 'p1'))
    expect(await screen.findByRole('link', { name: '前往 採購流程' })).toHaveAttribute('data-state', 'ok')
  })

  it('a missing row in an indexed note becomes deleted after the grace period; a late row shows text', async () => {
    const n = vault.createNote({ title: '採購流程' })
    await db.blocks.put({ noteId: n.id, blockId: 'other', type: 'paragraph', text: 'x' })
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true })
    try {
      await setup({
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'noteLink', attrs: { noteId: n.id, blockId: 'gone' } }] },
          { type: 'paragraph', content: [{ type: 'noteLink', attrs: { noteId: n.id, blockId: 'late' } }] },
        ],
      })
      await waitFor(() => expect(screen.getAllByRole('link', { name: '前往 採購流程' })).toHaveLength(2))
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000)
      })
      await act(async () => {
        await db.blocks.put({ noteId: n.id, blockId: 'late', type: 'paragraph', text: '後來索引的段落' })
      })
      await waitFor(() => expect(screen.getByRole('link', { name: '前往 採購流程 › 後來索引的段落' })).toBeInTheDocument())
      expect(screen.queryByText('已刪除的區塊')).toBeNull()
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2500) // past the grace period wherever it started
      })
      await waitFor(() => expect(screen.getByText('已刪除的區塊')).toHaveAttribute('data-state', 'deleted-block'))
      expect(screen.getByRole('link', { name: '前往 採購流程 › 後來索引的段落' })).toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it('Enter on a selected link opens it', async () => {
    const n = vault.createNote({ title: '採購流程' })
    await setup(linkDoc(n.id))
    await act(async () => {
      editor!.commands.setNodeSelection(3)
    })
    await key('Enter')
    expect(ctx.openNote).toHaveBeenCalledWith(n.id, undefined)
  })
})

describe('block link paste', () => {
  it('pasting a block-link token inserts a noteLink', async () => {
    const n = vault.createNote({ title: '採購流程' })
    await setup()
    let handled = false
    await act(async () => {
      handled = paste(`  ${formatBlockLink(n.id, 'p1')}\n`)
    })
    expect(handled).toBe(true)
    expect(nodesOf('noteLink')).toEqual([expect.objectContaining({ attrs: { noteId: n.id, blockId: 'p1' } })])
    expect(nodesOf('text').map((t) => t.text ?? '').join('')).not.toContain('[[note:')
  })
  it('pastes tokens for missing or trashed notes as plain text', async () => {
    const t = vault.createNote({ title: '舊筆記' })
    vault.trashNote(t.id)
    await setup()
    expect(paste('[[note:nope#b1]]')).toBe(false)
    expect(paste(formatBlockLink(t.id, null))).toBe(false)
    expect(nodesOf('noteLink')).toEqual([])
  })
  it('drops HTML noteLinks to notes that do not exist', async () => {
    const n = vault.createNote({ title: '採購流程' })
    await setup()
    await act(async () => {
      editor!.commands.insertContent(`<p>a <span data-note-link data-note-id="ghost">x</span> b <span data-note-link data-note-id="${n.id}">y</span></p>`)
    })
    expect(nodesOf('noteLink')).toEqual([expect.objectContaining({ attrs: { noteId: n.id, blockId: null } })])
  })
  it('leaves other text and code blocks alone', async () => {
    await setup('<pre><code></code></pre>')
    expect(paste('[[note:n1#b1]]')).toBe(false)
    await act(async () => editor!.commands.setContent('<p></p>'))
    expect(paste('see [[note:n1#b1]]')).toBe(false)
  })
})

describe('tags', () => {
  it('#name followed by space becomes a tag node', async () => {
    await setup()
    await typeChars('看 #採購 ')
    expect(nodesOf('tag')).toEqual([expect.objectContaining({ attrs: { name: '採購' } })])
    expect(editor!.getText()).toBe('看 #採購 ')
    expect(document.querySelector('[data-tag="採購"]')).toHaveTextContent('#採購')
  })
  it('stores lowercase and works at line start', async () => {
    await setup()
    await typeChars('#SAP ')
    expect(nodesOf('tag')).toEqual([expect.objectContaining({ attrs: { name: 'sap' } })])
  })
  it('does not convert in URLs, code, headings or [[ queries', async () => {
    for (const [content, text] of [
      ['<p></p>', 'https://a.com/#frag '],
      ['<p></p>', 'abc#def '],
      ['<p></p>', 'example.com#frag '],
      ['<pre><code></code></pre>', '#include '],
      ['<p>x <code>c</code></p>', ''],
      ['<p></p>', '# '],
      ['<p></p>', '#1 '],
    ] as const) {
      cleanup()
      await setup(content)
      if (text) await typeChars(text)
      expect(nodesOf('tag')).toEqual([])
    }
    cleanup()
    vault.createNote({ title: '採購流程' })
    await setup()
    await typeChars('[[採購流程#核准 ')
    expect(nodesOf('tag')).toEqual([])
  })
})

describe('tag activation', () => {
  const tagDoc = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'see ' }, { type: 'tag', attrs: { name: 'sap' } }, { type: 'text', text: ' end' }] }] }

  it('clicking a tag opens its search and leaves the selection alone', async () => {
    ctx.onTagClick = vi.fn()
    await setup(tagDoc)
    const before = editor!.state.selection.toJSON()
    const pill = screen.getByRole('button', { name: '搜尋標籤 #sap' })
    fireEvent.mouseDown(pill)
    fireEvent.click(pill)
    expect(ctx.onTagClick).toHaveBeenCalledWith('sap')
    expect(editor!.state.selection.toJSON()).toEqual(before)
    expect(editor!.getText()).toBe('see #sap end')
  })

  it('Ctrl/⌘+click does the same (Enter on a focused tag: e2e, jsdom has no button activation)', async () => {
    ctx.onTagClick = vi.fn()
    await setup(tagDoc)
    const pill = screen.getByRole('button', { name: '搜尋標籤 #sap' })
    fireEvent.click(pill, { ctrlKey: true })
    fireEvent.click(pill, { metaKey: true })
    expect(ctx.onTagClick).toHaveBeenCalledTimes(2)
  })

  it('Shift+click does not open the search; it extends the selection over the tag', async () => {
    ctx.onTagClick = vi.fn()
    await setup(tagDoc)
    await act(async () => void editor!.commands.setTextSelection(2)) // after "s"
    const pill = screen.getByRole('button', { name: '搜尋標籤 #sap' })
    await act(async () => {
      fireEvent.mouseDown(pill, { shiftKey: true })
      fireEvent.click(pill, { shiftKey: true, detail: 1 })
    })
    expect(ctx.onTagClick).not.toHaveBeenCalled()
    const sel = editor!.state.selection
    expect([sel.anchor, sel.head]).toEqual([2, 6]) // "ee " + the tag (pos 5, size 1)
  })

  it('Shift+Enter on the focused pill (a keyboard click, detail 0) still opens the search', async () => {
    ctx.onTagClick = vi.fn()
    await setup(tagDoc)
    fireEvent.click(screen.getByRole('button', { name: '搜尋標籤 #sap' }), { shiftKey: true, detail: 0 })
    expect(ctx.onTagClick).toHaveBeenCalledWith('sap')
  })

  it('Enter with the tag node selected opens its search; never while composing', async () => {
    ctx.onTagClick = vi.fn()
    await setup(tagDoc)
    await act(async () => void editor!.commands.setNodeSelection(5))
    expect(editor!.state.selection.toJSON()).toMatchObject({ type: 'node', anchor: 5 })
    // composing: call the handlers directly (ProseMirror itself drops keydown near a composition)
    const composing = new KeyboardEvent('keydown', { key: 'Enter', keyCode: 229 })
    const plugin = editor!.view.state.plugins.find((p) => (p as unknown as { key: string }).key.startsWith('tagActivate'))!
    expect(plugin.props.handleKeyDown!.call(plugin, editor!.view, composing)).toBe(false)
    expect(ctx.onTagClick).not.toHaveBeenCalled()
    await key('Enter')
    expect(ctx.onTagClick).toHaveBeenCalledWith('sap')
    expect(editor!.getText()).toBe('see #sap end') // Enter did not replace the tag
  })
})

describe('block highlight', () => {
  it('marks the block with data-highlight until cleared', async () => {
    await setup('<p data-block-id="b1">one</p><p data-block-id="b2">two</p>')
    await act(async () => setBlockHighlight(editor!, 'b2'))
    await waitFor(() => expect(document.querySelector('[data-block-id="b2"]')).toHaveAttribute('data-highlight', 'true'))
    expect(document.querySelector('[data-block-id="b1"]')).not.toHaveAttribute('data-highlight')
    await act(async () => setBlockHighlight(editor!, null))
    expect(document.querySelector('[data-block-id="b2"]')).not.toHaveAttribute('data-highlight')
  })
})
