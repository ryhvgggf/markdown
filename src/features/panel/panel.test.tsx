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
import { useTyping } from '@/features/editor/typing'
import { BacklinksLayer, PANEL_LEAVE_MS } from './BacklinksPanel'
import { OutlineTicks, OUTLINE_HIDE_MS } from './OutlineTicks'
import { OUTLINE_DEBOUNCE_MS } from './use-outline'
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

function Overlay() {
  const id = useUi((s) => s.openNoteId)
  return id ? (
    <>
      <OutlineTicks key={id} noteId={id} />
      <BacklinksLayer noteId={id} />
    </>
  ) : null
}
function mount() {
  const services = { vault, db, search: { mentions, search: vi.fn(), dispose() {} }, notes: { acquire, release } } as unknown as AppServices
  return render(
    <ServicesProvider services={services}>
      <Overlay />
    </ServicesProvider>,
  )
}
const panel = () => screen.getByRole('complementary', { name: '反向連結面板', hidden: true })
const pill = () => screen.getByRole('button', { name: /^反向連結/ })
const link = (src: string, tgt: string, snippet: string, blockId = 'b1') =>
  db.links.add({ sourceNoteId: src, sourceBlockId: blockId, targetNoteId: tgt, targetBlockId: null, snippet })

beforeEach(async () => {
  vault = await Vault.open(new MemoryStorage(), 'v', { channelFactory })
  db = createDb(`panel-${n++}-${Math.random()}`)
  mentionHits = []
  mentions = vi.fn(async () => mentionHits)
  acquire = vi.fn()
  release = vi.fn()
  useUi.setState({ openNoteId: null, backlinksOpen: false, backlinksPinned: false })
  useTyping.setState({ typing: false })
  useActiveEditor.setState({ noteId: null, editor: null })
})
afterEach(() => cleanup())

describe('pill and floating panel', () => {
  async function linkedTarget() {
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
    await waitFor(() => expect(pill()).toHaveTextContent('反向連結 1'))
    return target
  }

  it('the pill shows the distinct linking-note count and toggles the panel', async () => {
    await linkedTarget()
    expect(pill()).toHaveAttribute('aria-expanded', 'false')
    expect(panel()).toHaveAttribute('data-open', 'false')
    fireEvent.click(pill())
    expect(useUi.getState().backlinksOpen).toBe(true)
    expect(pill()).toHaveAttribute('aria-expanded', 'true')
    expect(panel()).toHaveAttribute('data-open', 'true')
    fireEvent.click(pill())
    expect(useUi.getState().backlinksOpen).toBe(false)
  })

  it('× and Esc close it (Esc returns focus to the pill), but not while composing', async () => {
    await linkedTarget()
    fireEvent.click(pill(), { detail: 0 }) // keyboard activation
    await waitFor(() => expect(panel()).toHaveFocus())
    fireEvent.keyDown(panel(), { key: 'Escape', isComposing: true })
    expect(useUi.getState().backlinksOpen).toBe(true)
    fireEvent.keyDown(panel(), { key: 'Escape' })
    expect(useUi.getState().backlinksOpen).toBe(false)
    expect(pill()).toHaveFocus()
    fireEvent.click(pill())
    fireEvent.click(within(panel()).getByRole('button', { name: '關閉面板', hidden: true }))
    expect(useUi.getState().backlinksOpen).toBe(false)
  })

  it('opening the panel re-runs the mention search (the index may have caught up since)', async () => {
    await linkedTarget()
    await waitFor(() => expect(mentions).toHaveBeenCalledTimes(1))
    fireEvent.click(pill())
    await waitFor(() => expect(mentions).toHaveBeenCalledTimes(2))
  })

  it('closes 500 ms after the pointer leaves, unless pinned', async () => {
    await linkedTarget()
    vi.useFakeTimers()
    try {
      fireEvent.click(pill())
      fireEvent.pointerLeave(panel())
      act(() => void vi.advanceTimersByTime(PANEL_LEAVE_MS - 50))
      fireEvent.pointerEnter(panel()) // came back in time
      act(() => void vi.advanceTimersByTime(200))
      expect(useUi.getState().backlinksOpen).toBe(true)
      fireEvent.pointerLeave(panel())
      act(() => void vi.advanceTimersByTime(PANEL_LEAVE_MS))
      expect(useUi.getState().backlinksOpen).toBe(false)
      fireEvent.click(pill())
      const pin = within(panel()).getByRole('button', { name: '釘選面板', hidden: true })
      fireEvent.click(pin)
      expect(pin).toHaveAttribute('aria-pressed', 'true')
      fireEvent.pointerLeave(panel())
      act(() => void vi.advanceTimersByTime(PANEL_LEAVE_MS * 2))
      expect(useUi.getState().backlinksOpen).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('pinned: switching notes keeps it open with the new note\'s content; unpinned: it closes', async () => {
    const target = await linkedTarget()
    const other = vault.createNote({ title: '別的' })
    const src = vault.createNote({ title: '來源二' })
    await link(src.id, other.id, 'q')
    fireEvent.click(pill())
    act(() => useUi.getState().openNote(other.id))
    expect(useUi.getState().backlinksOpen).toBe(false)
    act(() => useUi.getState().openNote(target.id))
    fireEvent.click(await screen.findByRole('button', { name: /^反向連結/ }))
    act(() => useUi.getState().setBacklinksPinned(true))
    act(() => useUi.getState().openNote(other.id))
    expect(useUi.getState().backlinksOpen).toBe(true)
    expect(await within(panel()).findByRole('button', { name: /來源二/, hidden: true })).toBeInTheDocument()
  })
})

describe('backlinks panel content', () => {
  it('no pill when nothing links here and nothing mentions it', async () => {
    const t = vault.createNote({ title: '孤島' })
    useUi.setState({ openNoteId: t.id })
    mount()
    await waitFor(() => expect(mentions).toHaveBeenCalled())
    await act(async () => {})
    expect(screen.queryByRole('button', { name: /^反向連結/ })).toBeNull()
  })

  it('snippet tokens: block links (link:<note>#<block>) take the block-link colour; old tokens still render', async () => {
    const target = vault.createNote({ title: '採購流程' })
    const other = vault.createNote({ title: '別篇' })
    const a = vault.createNote({ title: '來源' })
    await link(a.id, target.id, `看 \u2063link:${target.id}#blk-1\u2063 與 \u2063link:${other.id}#blk-2\u2063 和 \u2063link:${other.id}\u2063`)
    useUi.setState({ openNoteId: target.id })
    mount()
    const heading = await screen.findByRole('heading', { name: /^已連結 · [1-9]/, hidden: true })
    const card = within(heading.parentElement!).getByRole('button', { name: /來源/, hidden: true })
    expect(card.textContent).toContain('看 採購流程 與 別篇 和 別篇')
    expect(card.querySelector('mark')).toHaveAttribute('data-link-kind', 'block')
    const kinds = [...card.querySelectorAll('[data-link-kind]')].map((e) => e.getAttribute('data-link-kind'))
    expect(kinds).toEqual(['block', 'block', 'note'])
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
    useUi.setState({ openNoteId: target.id })
    mount()
    const heading = await screen.findByRole('heading', { name: /^已連結 · [1-9]/, hidden: true })
    const card = within(heading.parentElement!).getByRole('button', { name: /會議紀錄/, hidden: true })
    expect(card).toHaveTextContent('SAP / MM')
    expect(card).toHaveTextContent('另有 1 處連結')
    expect(card.textContent).toContain('參考 採購流程')
    expect(card.querySelector('mark')).toHaveTextContent('採購流程')
    expect(card.querySelector('mark')).toHaveAttribute('data-link-kind', 'note') // note-link colour, like the editor
    const rootCard = within(heading.parentElement!).getByRole('button', { name: /根目錄筆記/, hidden: true })
    expect(rootCard).not.toHaveTextContent('/')
    expect(rootCard).toHaveTextContent('與 已刪除的筆記')
    expect(within(rootCard).getByText('已刪除的筆記')).not.toHaveAttribute('data-link-kind') // not coloured as a link
    fireEvent.click(card)
    expect(useUi.getState().openNoteId).toBe(a.id)
    expect(useUi.getState().highlightBlockId).toBe('blk-9')
  })

  it('shows no empty message while data is still loading', async () => {
    const t = vault.createNote({ title: '孤島' })
    let resolve!: (h: SearchHit[]) => void
    mentions.mockReturnValue(new Promise<SearchHit[]>((r) => (resolve = r)))
    useUi.setState({ openNoteId: t.id })
    mount()
    await new Promise((r) => setTimeout(r, 450))
    expect(screen.queryByText('還沒有筆記連到這裡。')).toBeNull()
    expect(screen.queryByRole('button', { name: /^反向連結/ })).toBeNull() // no pill (and no 0) while loading
    resolve([{ noteId: 'm', title: '提到者', snippet: '孤島' } as SearchHit])
    expect(await screen.findByRole('button', { name: /^反向連結/ })).toHaveTextContent('反向連結 0')
    expect(screen.getByText('還沒有筆記連到這裡。')).toBeInTheDocument()
  })

  it('does not carry mentions or hidden items over to another note', async () => {
    const a = vault.createNote({ title: '甲' })
    const b = vault.createNote({ title: '乙' })
    const m = vault.createNote({ title: '提到者' })
    mentionHits = [{ noteId: m.id, title: '提到者', snippet: '甲甲' } as SearchHit]
    useUi.setState({ openNoteId: a.id })
    mount()
    await screen.findByRole('button', { name: '轉為連結', hidden: true })
    mentionHits = []
    act(() => useUi.setState({ openNoteId: b.id }))
    expect(screen.queryByRole('button', { name: '轉為連結', hidden: true })).toBeNull()
    await waitFor(() => expect(mentions).toHaveBeenLastCalledWith('乙', [b.id]))
    expect(screen.queryByRole('button', { name: '轉為連結', hidden: true })).toBeNull()
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
    useUi.setState({ openNoteId: target.id })
    mount()
    const btn = await screen.findByRole('button', { name: '轉為連結', hidden: true })
    expect(screen.getByRole('heading', { name: '提到但未連結 · 1', hidden: true })).toBeInTheDocument()
    expect(mentions).toHaveBeenLastCalledWith('採購流程', [target.id, linked.id])
    fireEvent.click(btn)
    await waitFor(() => expect(screen.queryByRole('button', { name: '轉為連結', hidden: true })).toBeNull())
    expect(acquire).toHaveBeenCalledWith(m.id)
    expect(release).toHaveBeenCalledWith(m.id)
    expect(p.toArray().some((k) => k instanceof Y.XmlElement && k.getAttribute('noteId') === target.id)).toBe(true)
  })

  it('only mentions: shows just that section, no empty message; blank title skips the query', async () => {
    const target = vault.createNote({ title: '採購流程' })
    const m = vault.createNote({ title: '提到者' })
    mentionHits = [{ noteId: m.id, title: '提到者', snippet: '採購流程' } as SearchHit]
    useUi.setState({ openNoteId: target.id })
    mount()
    await screen.findByRole('button', { name: '轉為連結', hidden: true })
    expect(screen.getByRole('heading', { name: '已連結 · 0', hidden: true })).toBeInTheDocument()
    expect(pill()).toHaveTextContent('反向連結 0') // mentions alone show the pill
    cleanup()
    mentions.mockClear()
    const blank = vault.createNote({ title: '未命名' })
    useUi.setState({ openNoteId: blank.id })
    mount()
    await new Promise((r) => setTimeout(r, 400))
    expect(mentions).not.toHaveBeenCalled()
  })
})

describe('outline ticks', () => {
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
    useUi.setState({ openNoteId: note.id })
    act(() => useActiveEditor.getState().set(note.id, editor))
    return note
  }
  afterEach(() => {
    editor?.destroy()
    scroller?.remove()
  })

  const ticks = () => screen.getByRole('button', { name: '大綱' })
  const card = () => screen.getByRole('navigation', { name: '大綱', hidden: true })
  const fakeTops = (tops: Record<string, number>) => {
    const rect = (top: number) => ({ top, bottom: top, left: 0, right: 0, width: 0, height: 0, x: 0, y: top, toJSON() {} }) as DOMRect
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const id = this.getAttribute('data-block-id')
      return rect(id ? (tops[id] ?? 999) : 0)
    })
    onTestFinished(() => void vi.restoreAllMocks())
  }

  it('renders nothing when the note has no headings', () => {
    setup([{ type: 'paragraph', content: [{ type: 'text', text: 'hi' }] }])
    mount()
    expect(screen.queryByRole('button', { name: '大綱' })).toBeNull()
  })

  it('one tick per entry (title, then H1–H3; H4 ignored) with its level; the heading in view is current', async () => {
    setup([h(1, 'h1', '壹'), h(2, 'h2', '貳'), h(3, 'h3', '參'), h(4, 'h4', '肆')])
    const tops: Record<string, number> = { h1: -300, h2: 40, h3: 500 }
    fakeTops(tops)
    mount()
    const marks = ticks().querySelectorAll('.outline-tick')
    expect([...marks].map((t) => t.getAttribute('data-level'))).toEqual(['0', '1', '2', '3'])
    const items = within(card()).getAllByRole('button', { hidden: true })
    expect(items.map((b) => b.textContent)).toEqual(['N', '壹', '貳', '參'])
    await waitFor(() => expect(items[2]).toHaveAttribute('aria-current', 'location'))
    expect(marks[2]).toHaveAttribute('data-on', 'true')
    tops.h3 = 20
    fireEvent.scroll(scroller)
    await waitFor(() => expect(items[3]).toHaveAttribute('aria-current', 'location'))
    expect(marks[3]).toHaveAttribute('data-on', 'true')
    expect(marks[2]).not.toHaveAttribute('data-on')
  })

  it('recomputes after edits settle, never synchronously per transaction', async () => {
    setup([h(1, 'h1', '壹')])
    mount()
    act(() => void editor.commands.insertContentAt(editor.state.doc.content.size, h(2, 'h5', '新增')))
    expect(screen.queryByRole('button', { name: '新增', hidden: true })).toBeNull()
    await new Promise((r) => setTimeout(r, OUTLINE_DEBOUNCE_MS + 60))
    await waitFor(() => expect(screen.getByRole('button', { name: '新增', hidden: true })).toBeInTheDocument())
  })

  it('hover shows the card; it hides ~220 ms after the pointer left both ticks and card', () => {
    setup([h(1, 'h1', '壹')])
    mount()
    vi.useFakeTimers()
    try {
      fireEvent.pointerEnter(ticks())
      expect(card()).toHaveAttribute('data-open', 'true')
      fireEvent.pointerLeave(ticks())
      act(() => void vi.advanceTimersByTime(OUTLINE_HIDE_MS - 100))
      fireEvent.pointerEnter(card())
      act(() => void vi.advanceTimersByTime(OUTLINE_HIDE_MS))
      expect(card()).toHaveAttribute('data-open', 'true')
      fireEvent.pointerLeave(card())
      act(() => void vi.advanceTimersByTime(OUTLINE_HIDE_MS))
      expect(card()).toHaveAttribute('data-open', 'false')
    } finally {
      vi.useRealTimers()
    }
  })

  it('typing mode hides the card and the ticks', () => {
    setup([h(1, 'h1', '壹')])
    mount()
    fireEvent.pointerEnter(ticks())
    act(() => useTyping.setState({ typing: true }))
    expect(card()).toHaveAttribute('data-open', 'false')
    expect(ticks().parentElement).toHaveAttribute('data-typing', 'true')
  })

  it('keyboard: the ticks button opens the card on the current heading; Esc closes and refocuses', async () => {
    setup([h(1, 'h1', '壹'), h(2, 'h2', '貳')])
    mount()
    fireEvent.click(ticks())
    expect(ticks()).toHaveAttribute('aria-expanded', 'true')
    await waitFor(() => expect(card().querySelector('button[aria-current="location"]')).toHaveFocus())
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
    expect(card()).toHaveAttribute('data-open', 'false')
    expect(ticks()).toHaveFocus()
  })

  it('click scrolls the heading into view (instant with 減少動態) and places the cursor in it', () => {
    setup([h(1, 'h1', '壹'), h(2, 'h2', '貳')])
    const scrollIntoView = vi.fn()
    const original = Element.prototype.scrollIntoView
    Element.prototype.scrollIntoView = scrollIntoView
    onTestFinished(() => {
      Element.prototype.scrollIntoView = original
      delete document.documentElement.dataset.reduceMotion
    })
    mount()
    fireEvent.click(screen.getByRole('button', { name: '貳', hidden: true }))
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' })
    expect(editor.state.selection.$from.parent.attrs.id).toBe('h2')
    document.documentElement.dataset.reduceMotion = 'true'
    fireEvent.click(screen.getByRole('button', { name: '壹', hidden: true }))
    expect(scrollIntoView).toHaveBeenLastCalledWith({ behavior: 'auto', block: 'start' })
  })
})
