import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { Editor, Extension } from '@tiptap/core'
import Document from '@tiptap/extension-document'
import Heading from '@tiptap/extension-heading'
import Paragraph from '@tiptap/extension-paragraph'
import Text from '@tiptap/extension-text'
import * as Y from 'yjs'
import { createDb, type NotesDb } from '@/adapters/storage/db'
import { MemoryStorage } from '@/adapters/storage/memory-storage'
import { ServicesProvider } from '@/app/services-context'
import { useUi } from '@/app/ui-store'
import type { AppServices } from '@/app/bootstrap'
import { Vault } from '@/core/vault/vault'
import type { SearchHit } from '@/core/search/search'
import { Panel } from './Panel'
import { PanelPills } from './PanelPills'
import { useActiveEditor } from './active-editor'

const channelFactory = () =>
  ({ postMessage() {}, close() {}, onmessage: null, addEventListener() {}, removeEventListener() {} }) as unknown as BroadcastChannel

let vault: Vault
let db: NotesDb
let mentionHits: SearchHit[]
let mentions: ReturnType<typeof vi.fn>
let acquire: ReturnType<typeof vi.fn>
let release: ReturnType<typeof vi.fn>
let n = 0

function mount() {
  const services = { vault, db, search: { mentions, search: vi.fn(), dispose() {} }, notes: { acquire, release } } as unknown as AppServices
  return render(
    <ServicesProvider services={services}>
      <PanelPills />
      <aside>
        <Panel />
      </aside>
    </ServicesProvider>,
  )
}
const link = (src: string, tgt: string, snippet: string, blockId = 'b1') =>
  db.links.add({ sourceNoteId: src, sourceBlockId: blockId, targetNoteId: tgt, targetBlockId: null, snippet })

beforeEach(async () => {
  vault = await Vault.open(new MemoryStorage(), 'v', { channelFactory })
  db = createDb(`panel-${n++}-${Math.random()}`)
  mentionHits = []
  mentions = vi.fn(async () => mentionHits)
  acquire = vi.fn()
  release = vi.fn()
  useUi.setState({ openNoteId: null, panel: 'none' })
  useActiveEditor.setState({ noteId: null, editor: null })
})
afterEach(() => cleanup())

describe('pills and panel chrome', () => {
  it('pills toggle the panel and show the distinct linking-note count', async () => {
    const target = vault.createNote({ title: '採購流程' })
    const a = vault.createNote({ title: 'A' })
    const trashed = vault.createNote({ title: 'T' })
    vault.trashNote(trashed.id)
    await link(a.id, target.id, 'x', 'b1')
    await link(a.id, target.id, 'y', 'b2')
    await link(trashed.id, target.id, 'z')
    await link(target.id, target.id, 'self')
    useUi.setState({ openNoteId: target.id })
    mount()
    const pill = screen.getByRole('button', { name: /^反向連結/ })
    await waitFor(() => expect(pill).toHaveTextContent('反向連結 1'))
    expect(pill).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(pill)
    expect(useUi.getState().panel).toBe('backlinks')
    expect(screen.getByRole('tab', { name: '反向連結' })).toHaveAttribute('aria-selected', 'true')
    fireEvent.click(screen.getByRole('tab', { name: '大綱' }))
    expect(useUi.getState().panel).toBe('outline')
    expect(screen.getByRole('button', { name: '大綱' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('× and Esc close the panel, but not while composing', () => {
    useUi.setState({ openNoteId: 'x', panel: 'outline' })
    mount()
    const tab = screen.getByRole('tab', { name: '大綱' })
    fireEvent.keyDown(tab, { key: 'Escape', isComposing: true })
    expect(useUi.getState().panel).toBe('outline')
    fireEvent.keyDown(tab, { key: 'Escape' })
    expect(useUi.getState().panel).toBe('none')
    useUi.setState({ panel: 'backlinks' })
    fireEvent.click(screen.getByRole('button', { name: '關閉面板' }))
    expect(useUi.getState().panel).toBe('none')
  })
})

describe('backlinks tab', () => {
  it('shows the empty message when nothing links here', async () => {
    const t = vault.createNote({ title: '孤島' })
    useUi.setState({ openNoteId: t.id, panel: 'backlinks' })
    mount()
    expect(await screen.findByText('還沒有其他筆記連結到這裡')).toBeInTheDocument()
  })

  it('lists linked cards with folder path and highlighted title; click opens the source block', async () => {
    const f = vault.createFolder({ name: 'SAP', parentId: null })
    const sub = vault.createFolder({ name: 'MM', parentId: f.id })
    const target = vault.createNote({ title: '採購流程' })
    const a = vault.createNote({ title: '會議紀錄', folderId: sub.id })
    const root = vault.createNote({ title: '根目錄筆記' })
    await link(a.id, target.id, `參考 \u2063link:${target.id}\u2063`, 'blk-9')
    await link(a.id, target.id, '第二處', 'blk-10')
    await link(root.id, target.id, `見 \u2063link:${target.id}\u2063 與 \u2063link:gone\u2063`)
    useUi.setState({ openNoteId: target.id, panel: 'backlinks' })
    mount()
    const heading = await screen.findByRole('heading', { name: '已連結' })
    const card = within(heading.parentElement!).getByRole('button', { name: /會議紀錄/ })
    expect(card).toHaveTextContent('SAP / MM')
    expect(card).toHaveTextContent('另有 1 處連結')
    expect(card.textContent).toContain('參考 採購流程')
    expect(card.querySelector('mark')).toHaveTextContent('採購流程')
    const rootCard = within(heading.parentElement!).getByRole('button', { name: /根目錄筆記/ })
    expect(rootCard).not.toHaveTextContent('/')
    expect(rootCard).toHaveTextContent('與 已刪除的筆記')
    fireEvent.click(card)
    expect(useUi.getState().openNoteId).toBe(a.id)
    expect(useUi.getState().highlightBlockId).toBe('blk-9')
  })

  it('shows no empty message while data is still loading', async () => {
    const t = vault.createNote({ title: '孤島' })
    let resolve!: (h: SearchHit[]) => void
    mentions.mockReturnValue(new Promise<SearchHit[]>((r) => (resolve = r)))
    useUi.setState({ openNoteId: t.id, panel: 'backlinks' })
    mount()
    await new Promise((r) => setTimeout(r, 450))
    expect(screen.queryByText('還沒有其他筆記連結到這裡')).toBeNull()
    expect(screen.getByRole('button', { name: /^反向連結/ }).textContent).toBe('反向連結 0')
    resolve([])
    expect(await screen.findByText('還沒有其他筆記連結到這裡')).toBeInTheDocument()
  })

  it('does not carry mentions or hidden items over to another note', async () => {
    const a = vault.createNote({ title: '甲' })
    const b = vault.createNote({ title: '乙' })
    const m = vault.createNote({ title: '提到者' })
    mentionHits = [{ noteId: m.id, title: '提到者', snippet: '甲甲' } as SearchHit]
    useUi.setState({ openNoteId: a.id, panel: 'backlinks' })
    mount()
    await screen.findByRole('button', { name: '轉為連結' })
    mentionHits = []
    act(() => useUi.setState({ openNoteId: b.id }))
    expect(screen.queryByRole('button', { name: '轉為連結' })).toBeNull()
    await waitFor(() => expect(mentions).toHaveBeenLastCalledWith('乙', [b.id]))
    expect(screen.queryByRole('button', { name: '轉為連結' })).toBeNull()
  })

  it('lists mentions (excluding self and linked notes); 轉為連結 links the text and hides the item', async () => {
    const target = vault.createNote({ title: '採購流程' })
    const linked = vault.createNote({ title: 'L' })
    const m = vault.createNote({ title: '提到者' })
    await link(linked.id, target.id, '已連結')
    mentionHits = [{ noteId: m.id, title: '提到者', snippet: '先走採購流程再說' } as SearchHit]
    const ydoc = new Y.Doc()
    const p = new Y.XmlElement('paragraph')
    p.insert(0, [new Y.XmlText('先走採購流程再說')])
    ydoc.getXmlFragment('content').insert(0, [p])
    acquire.mockResolvedValue(ydoc)
    useUi.setState({ openNoteId: target.id, panel: 'backlinks' })
    mount()
    const btn = await screen.findByRole('button', { name: '轉為連結' })
    expect(screen.getByRole('heading', { name: '提到但未連結' })).toBeInTheDocument()
    expect(mentions).toHaveBeenLastCalledWith('採購流程', [target.id, linked.id])
    fireEvent.click(btn)
    await waitFor(() => expect(screen.queryByRole('button', { name: '轉為連結' })).toBeNull())
    expect(acquire).toHaveBeenCalledWith(m.id)
    expect(release).toHaveBeenCalledWith(m.id)
    expect(p.toArray().some((k) => k instanceof Y.XmlElement && k.getAttribute('noteId') === target.id)).toBe(true)
  })

  it('only mentions: shows just that section, no empty message; blank title skips the query', async () => {
    const target = vault.createNote({ title: '採購流程' })
    const m = vault.createNote({ title: '提到者' })
    mentionHits = [{ noteId: m.id, title: '提到者', snippet: '採購流程' } as SearchHit]
    useUi.setState({ openNoteId: target.id, panel: 'backlinks' })
    mount()
    await screen.findByRole('button', { name: '轉為連結' })
    expect(screen.queryByRole('heading', { name: '已連結' })).toBeNull()
    expect(screen.queryByText('還沒有其他筆記連結到這裡')).toBeNull()
    cleanup()
    mentions.mockClear()
    const blank = vault.createNote({ title: '未命名' })
    useUi.setState({ openNoteId: blank.id })
    mount()
    await new Promise((r) => setTimeout(r, 400))
    expect(mentions).not.toHaveBeenCalled()
  })
})

describe('outline tab', () => {
  const IdAttr = Extension.create({
    name: 'idAttr',
    addGlobalAttributes: () => [
      {
        types: ['heading', 'paragraph'],
        attributes: { id: { default: null, renderHTML: (a) => (a.id ? { 'data-block-id': a.id } : {}) } },
      },
    ],
  })
  const h = (level: number, id: string, text: string) => ({
    type: 'heading',
    attrs: { level, id },
    content: [{ type: 'text', text }],
  })
  let editor: Editor
  let scroller: HTMLDivElement

  function setup(content: object[]) {
    scroller = document.createElement('div')
    scroller.setAttribute('data-note-scroll', '')
    document.body.append(scroller)
    editor = new Editor({
      element: scroller,
      extensions: [Document, Paragraph, Text, Heading.configure({ levels: [1, 2, 3, 4] }), IdAttr],
      content: { type: 'doc', content },
    })
    const note = vault.createNote({ title: 'N' })
    useUi.setState({ openNoteId: note.id, panel: 'outline' })
    act(() => useActiveEditor.getState().set(note.id, editor))
    return note
  }
  afterEach(() => {
    editor?.destroy()
    scroller?.remove()
  })

  it('shows empty copy when there are no headings', () => {
    setup([{ type: 'paragraph', content: [{ type: 'text', text: 'hi' }] }])
    mount()
    expect(screen.getByText('這篇筆記還沒有標題')).toBeInTheDocument()
  })

  it('lists H1-H3 indented, ignores H4, follows edits, and marks the current heading on scroll', async () => {
    setup([h(1, 'h1', '壹'), h(2, 'h2', '貳'), h(3, 'h3', '參'), h(4, 'h4', '肆')])
    // jsdom has no layout: fake tops relative to the scroller (top 0).
    const tops: Record<string, number> = { h1: -300, h2: 40, h3: 500 }
    const rect = (top: number) => ({ top, bottom: top, left: 0, right: 0, width: 0, height: 0, x: 0, y: top, toJSON() {} }) as DOMRect
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const id = this.getAttribute('data-block-id')
      return rect(id ? (tops[id] ?? 999) : 0)
    })
    mount()
    const items = within(screen.getByRole('navigation', { name: '大綱' })).getAllByRole('button')
    expect(items.map((b) => b.textContent)).toEqual(['壹', '貳', '參'])
    expect(items[0].parentElement).toHaveStyle({ paddingLeft: '0px' })
    expect(items[1].parentElement).toHaveStyle({ paddingLeft: '12px' })
    expect(items[2].parentElement).toHaveStyle({ paddingLeft: '24px' })
    await waitFor(() => expect(items[1]).toHaveAttribute('aria-current', 'location'))
    expect(items[0]).not.toHaveAttribute('aria-current')
    tops.h3 = 20
    fireEvent.scroll(scroller)
    await waitFor(() => expect(items[2]).toHaveAttribute('aria-current', 'location'))
    expect(items[1]).not.toHaveAttribute('aria-current')
    act(() => void editor.commands.insertContentAt(editor.state.doc.content.size, h(2, 'h5', '新增')))
    await waitFor(() => expect(screen.getByRole('button', { name: '新增' })).toBeInTheDocument())
    vi.restoreAllMocks()
  })

  it('click scrolls the heading into view and places the cursor in it', () => {
    setup([h(1, 'h1', '壹'), h(2, 'h2', '貳')])
    const scrollIntoView = vi.fn()
    const original = Element.prototype.scrollIntoView
    Element.prototype.scrollIntoView = scrollIntoView
    onTestFinished(() => void (Element.prototype.scrollIntoView = original))
    mount()
    fireEvent.click(screen.getByRole('button', { name: '貳' }))
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' })
    const $from = editor.state.selection.$from
    expect($from.parent.attrs.id).toBe('h2')
  })
})
