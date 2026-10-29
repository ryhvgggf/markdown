import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { ServicesProvider } from '@/app/services-context'
import { useUi } from '@/app/ui-store'
import type { AppServices } from '@/app/bootstrap'
import { MemoryStorage } from '@/adapters/storage/memory-storage'
import { Vault } from '@/core/vault/vault'
import type { SearchHit } from '@/core/search/search'
import { QuickSwitcher } from './QuickSwitcher'

const channelFactory = () =>
  ({ postMessage() {}, close() {}, onmessage: null, addEventListener() {}, removeEventListener() {} }) as unknown as BroadcastChannel

let vault: Vault
let search: ReturnType<typeof vi.fn>
let searchTags: ReturnType<typeof vi.fn>
let listTags: ReturnType<typeof vi.fn>

function mount() {
  const services = { vault, search: { search, searchTags, listTags, mentions: vi.fn(), dispose() {} } } as unknown as AppServices
  return render(
    <ServicesProvider services={services}>
      <button>外部</button>
      <QuickSwitcher />
    </ServicesProvider>,
  )
}
const hit = (noteId: string, title: string, field: SearchHit['field'], snippet: string): SearchHit => ({
  noteId, title, field, snippet, updatedAt: 1,
})
const input = () => screen.getByRole('combobox')
const type = (v: string) => fireEvent.change(input(), { target: { value: v } })
const keyOn = (key: string, init: KeyboardEventInit = {}) => fireEvent.keyDown(input(), { key, ...init })

beforeEach(async () => {
  vault = await Vault.open(new MemoryStorage(), 'v', { channelFactory })
  search = vi.fn(async () => [])
  searchTags = vi.fn(async () => [])
  listTags = vi.fn(async () => [])
  useUi.setState({ openNoteId: null, quickSwitcherOpen: false, quickSwitcherSeed: '' })
})
afterEach(() => cleanup())

describe('open / close', () => {
  it('toggles with Ctrl+K, preventing the browser default, and not while composing', () => {
    mount()
    const ev = new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, cancelable: true, bubbles: true })
    act(() => void window.dispatchEvent(ev))
    expect(ev.defaultPrevented).toBe(true)
    expect(screen.getByRole('dialog', { name: '快速切換' })).toBeInTheDocument()
    act(() => void fireEvent.keyDown(window, { key: 'k', ctrlKey: true, isComposing: true }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    act(() => void fireEvent.keyDown(window, { key: 'k', ctrlKey: true }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('opens from the store (rail 搜尋), focuses the input, and Esc restores focus', async () => {
    mount()
    const outside = screen.getByRole('button', { name: '外部' })
    outside.focus()
    act(() => useUi.getState().setQuickSwitcher(true))
    expect(input()).toHaveFocus()
    keyOn('Escape')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(useUi.getState().quickSwitcherOpen).toBe(false)
    await waitFor(() => expect(outside).toHaveFocus())
  })

  it('pre-fills the seed (# from the rail tag button)', () => {
    mount()
    act(() => useUi.getState().setQuickSwitcher(true, '#'))
    expect(input()).toHaveValue('#')
  })
})

describe('empty query', () => {
  it('lists the 8 most recently updated live notes with folder paths', () => {
    const f = vault.createFolder({ name: '採購', parentId: null })
    const notes = Array.from({ length: 10 }, (_, i) => vault.createNote({ title: `N${i}`, folderId: i === 9 ? f.id : null }))
    vault.trashNote(notes[8].id)
    mount()
    act(() => useUi.getState().setQuickSwitcher(true))
    const opts = screen.getAllByRole('option')
    expect(opts.filter((o) => !/新增筆記/.test(o.textContent ?? ''))).toHaveLength(8)
    expect(screen.queryByRole('option', { name: /N8/ })).toBeNull()
    expect(screen.getByRole('option', { name: /N9/ })).toHaveTextContent('採購')
    expect(screen.getByText('筆記')).toBeInTheDocument()
    expect(screen.queryByText(/新增筆記「/)).toBeNull()
  })
})

describe('search', () => {
  it('debounces 80ms, bolds title matches, shows paths, content snippets, tags; drops trashed', async () => {
    const f = vault.createFolder({ name: '財務', parentId: null })
    const a = vault.createNote({ title: '採購流程', folderId: f.id })
    const b = vault.createNote({ title: 'B' })
    const c = vault.createNote({ title: 'C' })
    const gone = vault.createNote({ title: '採購舊' })
    vault.trashNote(gone.id)
    search.mockResolvedValue([
      hit(a.id, '採購流程', 'title', ''),
      hit(b.id, 'B', 'tag', '#採購'),
      hit(c.id, 'C', 'content', '…請建立採購申請單…'),
      hit(gone.id, '採購舊', 'title', ''),
    ])
    mount()
    act(() => useUi.getState().setQuickSwitcher(true))
    vi.useFakeTimers()
    type('採購')
    expect(search).not.toHaveBeenCalled()
    await act(async () => void (await vi.advanceTimersByTimeAsync(80)))
    vi.useRealTimers()
    expect(search).toHaveBeenCalledWith('採購')
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(4))
    const first = screen.getByRole('option', { name: /採購流程/ })
    expect(within(first).getByText('採購').tagName).toBe('STRONG')
    expect(first).toHaveTextContent('財務')
    expect(screen.getByRole('option', { name: /B/ })).toHaveTextContent('#採購')
    expect(screen.getByRole('option', { name: /C/ })).toHaveTextContent('內文提到「…請建立採購申請單…」')
    expect(screen.queryByText('採購舊')).toBeNull()
    expect(screen.getByRole('option', { name: '新增筆記「採購」' })).toBeInTheDocument()
  })

  it('ignores out-of-order responses', async () => {
    const a = vault.createNote({ title: 'Alpha' })
    const b = vault.createNote({ title: 'Beta' })
    let resolveSlow!: (h: SearchHit[]) => void
    search.mockImplementationOnce(() => new Promise<SearchHit[]>((r) => (resolveSlow = r)))
    search.mockImplementationOnce(async () => [hit(b.id, 'Beta', 'title', '')])
    mount()
    act(() => useUi.getState().setQuickSwitcher(true))
    type('a')
    await waitFor(() => expect(search).toHaveBeenCalledTimes(1))
    type('be')
    await waitFor(() => expect(search).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.getByRole('option', { name: /Beta/ })).toBeInTheDocument())
    await act(async () => resolveSlow([hit(a.id, 'Alpha', 'title', '')]))
    expect(screen.queryByRole('option', { name: /Alpha/ })).toBeNull()
  })

  it('shows a message when the search worker has failed', async () => {
    search.mockRejectedValue(new Error('Search worker failed'))
    mount()
    act(() => useUi.getState().setQuickSwitcher(true))
    type('x')
    await screen.findByText('搜尋暫時無法使用，請重新整理頁面。')
  })
})

describe('tag mode', () => {
  it('uses searchTags for #queries and drops stale hits when back to a bare #', async () => {
    const a = vault.createNote({ title: '採購單' })
    searchTags.mockResolvedValue([hit(a.id, '採購單', 'tag', '#採購')])
    mount()
    act(() => useUi.getState().setQuickSwitcher(true))
    type('#採購')
    const row = await screen.findByRole('option', { name: /採購單/ })
    expect(row).toHaveTextContent('#採購')
    expect(searchTags).toHaveBeenCalledWith('採購')
    expect(search).not.toHaveBeenCalled()
    expect(screen.queryByRole('option', { name: /新增筆記/ })).toBeNull()
    type('#')
    expect(screen.queryAllByRole('option')).toHaveLength(0)
    keyOn('Enter')
    expect(useUi.getState().openNoteId).toBeNull()
  })

  it('lists every tag on a bare #, and picking one drills into that tag', async () => {
    listTags.mockResolvedValue([{ tag: '採購', count: 2 }, { tag: '財務', count: 1 }])
    mount()
    act(() => useUi.getState().setQuickSwitcher(true))
    type('#')
    const row = await screen.findByRole('option', { name: /採購/ })
    expect(row).toHaveTextContent('2 篇筆記')
    expect(screen.getByRole('option', { name: /財務/ })).toBeInTheDocument()
    fireEvent.click(row)
    expect(input()).toHaveValue('#採購 ')
    expect(useUi.getState().quickSwitcherOpen).toBe(true) // picking a tag keeps the panel open to show its notes
  })
})

describe('create row', () => {
  it('appears only without an exact (normalized) title match and creates + opens on Enter', async () => {
    vault.createNote({ title: 'SAP' })
    mount()
    act(() => useUi.getState().setQuickSwitcher(true))
    type(' sap ')
    expect(screen.queryByRole('option', { name: /新增筆記/ })).toBeNull()
    type(' 新主題 ')
    const row = await screen.findByRole('option', { name: '新增筆記「新主題」' })
    expect(row).toBeInTheDocument()
    keyOn('ArrowUp') // wraps to the last row (the create row)
    expect(row).toHaveAttribute('aria-selected', 'true')
    keyOn('Enter')
    const made = vault.listNotes().find((n) => n.title === '新主題')
    expect(made).toBeTruthy()
    expect(useUi.getState().openNoteId).toBe(made!.id)
    expect(useUi.getState().quickSwitcherOpen).toBe(false)
  })
})

describe('keyboard and mouse', () => {
  it('arrows wrap, aria-activedescendant follows, Enter opens, composing is ignored, hover selects, click opens', () => {
    const a = vault.createNote({ title: 'A' })
    const b = vault.createNote({ title: 'B' })
    mount()
    act(() => useUi.getState().setQuickSwitcher(true))
    const opts = () => screen.getAllByRole('option')
    expect(opts()[0]).toHaveAttribute('aria-selected', 'true')
    expect(input()).toHaveAttribute('aria-activedescendant', opts()[0].id)
    keyOn('ArrowDown')
    expect(opts()[1]).toHaveAttribute('aria-selected', 'true')
    keyOn('ArrowDown')
    expect(opts()[0]).toHaveAttribute('aria-selected', 'true')
    keyOn('ArrowUp')
    expect(opts()[1]).toHaveAttribute('aria-selected', 'true')
    keyOn('ArrowDown', { isComposing: true })
    keyOn('Enter', { isComposing: true })
    expect(opts()[1]).toHaveAttribute('aria-selected', 'true')
    expect(useUi.getState().quickSwitcherOpen).toBe(true)
    fireEvent.mouseMove(opts()[0])
    expect(opts()[0]).toHaveAttribute('aria-selected', 'true')
    keyOn('Enter')
    const first = useUi.getState().openNoteId
    expect([a.id, b.id]).toContain(first)
    act(() => useUi.getState().setQuickSwitcher(true))
    fireEvent.click(screen.getAllByRole('option')[1])
    expect(useUi.getState().openNoteId).not.toBe(first)
    expect(useUi.getState().quickSwitcherOpen).toBe(false)
  })
})
