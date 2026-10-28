import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryStorage } from '@/adapters/storage/memory-storage'
import { ServicesProvider } from '@/app/services-context'
import { useUi } from '@/app/ui-store'
import type { AppServices } from '@/app/bootstrap'
import { Vault } from '@/core/vault/vault'
import { Sidebar } from './Sidebar'
import { TRASH_DAY_MS } from './TrashView'
import { rowRenders } from './TreeItem'

const focusTitleEnd = vi.hoisted(() => vi.fn(() => true))
vi.mock('@/features/editor/focus-bridge', () => ({ focusTitleEnd }))

const channelFactory = () =>
  ({ postMessage() {}, close() {}, onmessage: null, addEventListener() {}, removeEventListener() {} }) as unknown as BroadcastChannel

let vault: Vault
let metaRows: Map<string, unknown>
let maintenance: { purge: ReturnType<typeof vi.fn> }
let mode: 'persistent' | 'memory'

function fakeDb() {
  return {
    meta: {
      get: async (k: string) => (metaRows.has(k) ? { key: k, value: metaRows.get(k) } : undefined),
      put: async (r: { key: string; value: unknown }) => void metaRows.set(r.key, r.value),
    },
  }
}
const mount = () => {
  const services = { vault, maintenance, db: fakeDb(), storageMode: mode } as unknown as AppServices
  return render(
    <ServicesProvider services={services}>
      <Sidebar />
    </ServicesProvider>,
  )
}

beforeEach(async () => {
  vault = await Vault.open(new MemoryStorage(), 'v', { channelFactory })
  metaRows = new Map()
  maintenance = {
    purge: vi.fn(async (ref: { kind: string; id: string }) => {
      if (ref.kind === 'note') vault.purgeNote(ref.id)
      else vault.purgeFolder(ref.id)
      return true
    }),
  }
  mode = 'persistent'
  focusTitleEnd.mockClear()
  useUi.setState({ openNoteId: null, sidebarView: 'tree' })
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const row = (name: string | RegExp) => screen.getByRole('treeitem', { name })

describe('Sidebar tree', () => {
  it('renders folders with chevrons, 20px indent per level and the open note as current page', async () => {
    const a = vault.createFolder({ name: '專案', parentId: null })
    const b = vault.createFolder({ name: '子層', parentId: a.id })
    const n = vault.createNote({ title: '深處的筆記', folderId: b.id })
    vault.createNote({ title: '根筆記' })
    metaRows.set('expandedFolders', [a.id, b.id])
    useUi.setState({ openNoteId: n.id })
    mount()
    const top = await screen.findByRole('treeitem', { name: /專案/ })
    expect(top).toHaveAttribute('aria-expanded', 'true')
    expect(top).toHaveAttribute('aria-level', '1')
    const deep = row(/深處的筆記/)
    expect(deep).toHaveAttribute('aria-level', '3')
    expect(deep).toHaveAttribute('aria-current', 'page')
    expect(row(/根筆記/)).not.toHaveAttribute('aria-current')
    const pad = (el: HTMLElement) => parseFloat(el.style.paddingLeft)
    expect(pad(row(/子層/)) - pad(top)).toBe(20)
    expect(pad(deep) - pad(row(/子層/))).toBe(20)
  })

  it('collapsed folders hide children; toggling persists to meta.expandedFolders and survives remount', async () => {
    const a = vault.createFolder({ name: '專案', parentId: null })
    vault.createNote({ title: '內容', folderId: a.id })
    const { unmount } = mount()
    await screen.findByRole('tree')
    expect(screen.queryByRole('treeitem', { name: /內容/ })).toBeNull()
    fireEvent.click(row(/專案/))
    expect(row(/內容/)).toBeInTheDocument()
    await waitFor(() => expect(metaRows.get('expandedFolders')).toEqual([a.id]))
    unmount()
    mount()
    expect(await screen.findByRole('treeitem', { name: /內容/ })).toBeInTheDocument()
  })

  it('shows 未命名 for untitled notes and opens a note on click', async () => {
    const n = vault.createNote()
    mount()
    fireEvent.click(await screen.findByRole('treeitem', { name: '未命名' }))
    expect(useUi.getState().openNoteId).toBe(n.id)
  })

  it('shows the storage status line', async () => {
    mount()
    expect(await screen.findByText('已儲存在此裝置')).toBeInTheDocument()
    cleanup()
    mode = 'memory'
    mount()
    expect(await screen.findByText('資料未保存')).toBeInTheDocument()
  })
})

describe('Sidebar actions', () => {
  it('新增筆記 creates an untitled note in the open note\'s folder, opens it and focuses the title', async () => {
    const f = vault.createFolder({ name: '專案', parentId: null })
    const open = vault.createNote({ title: '已開啟', folderId: f.id })
    metaRows.set('expandedFolders', [f.id])
    useUi.setState({ openNoteId: open.id })
    mount()
    fireEvent.click(await screen.findByRole('button', { name: '新增筆記' }))
    const created = vault.listNotes().find((n) => n.id !== open.id)!
    expect(created.title).toBe('')
    expect(created.folderId).toBe(f.id)
    expect(useUi.getState().openNoteId).toBe(created.id)
    await waitFor(() => expect(focusTitleEnd).toHaveBeenCalledWith(created.id))
  })

  it('新增資料夾 creates a root folder with an inline rename input', async () => {
    mount()
    fireEvent.click(await screen.findByRole('button', { name: '新增資料夾' }))
    const input = await screen.findByRole('textbox', { name: '重新命名' })
    fireEvent.change(input, { target: { value: '工作' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(vault.listFolders().map((f) => f.name)).toEqual(['工作'])
    expect(screen.queryByRole('textbox', { name: '重新命名' })).toBeNull()
  })

  it('context menu renames a note, rejecting duplicates with 已有同名筆記', async () => {
    vault.createNote({ title: 'Alpha' })
    const b = vault.createNote({ title: 'Beta' })
    mount()
    fireEvent.contextMenu(await screen.findByRole('treeitem', { name: /Beta/ }))
    fireEvent.click(await screen.findByRole('menuitem', { name: '重新命名' }))
    const input = await screen.findByRole('textbox', { name: '重新命名' })
    fireEvent.change(input, { target: { value: 'alpha' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(screen.getByText('已有同名筆記')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: '重新命名' })).toBeInTheDocument()
    expect(vault.getNote(b.id)?.title).toBe('Beta')
    fireEvent.change(input, { target: { value: 'Gamma' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(vault.getNote(b.id)?.title).toBe('Gamma')
  })

  it('Escape cancels a rename', async () => {
    const a = vault.createNote({ title: 'Alpha' })
    mount()
    fireEvent.contextMenu(await screen.findByRole('treeitem', { name: /Alpha/ }))
    fireEvent.click(await screen.findByRole('menuitem', { name: '重新命名' }))
    const input = await screen.findByRole('textbox', { name: '重新命名' })
    fireEvent.change(input, { target: { value: 'Zed' } })
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(screen.queryByRole('textbox', { name: '重新命名' })).toBeNull()
    expect(vault.getNote(a.id)?.title).toBe('Alpha')
  })

  it('folder menu offers 新增子資料夾 and 新增筆記', async () => {
    const f = vault.createFolder({ name: '專案', parentId: null })
    mount()
    fireEvent.contextMenu(await screen.findByRole('treeitem', { name: /專案/ }))
    expect(await screen.findByRole('menuitem', { name: '新增筆記' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('menuitem', { name: '新增子資料夾' }))
    expect(vault.listFolders().find((x) => x.parentId === f.id)).toBeTruthy()
    expect(await screen.findByRole('textbox', { name: '重新命名' })).toBeInTheDocument()
  })

  it('trashing the open note opens the next note', async () => {
    const a = vault.createNote({ title: 'A' })
    const b = vault.createNote({ title: 'B' })
    useUi.setState({ openNoteId: a.id })
    mount()
    fireEvent.contextMenu(await screen.findByRole('treeitem', { name: /^A$/ }))
    fireEvent.click(await screen.findByRole('menuitem', { name: '移到垃圾桶' }))
    expect(vault.getNote(a.id)?.deletedAt).not.toBeNull()
    expect(useUi.getState().openNoteId).toBe(b.id)
  })
})

describe('Trash', () => {
  const openTrash = async () => fireEvent.click(await screen.findByRole('button', { name: /垃圾桶/ }))

  it('is empty by default', async () => {
    mount()
    await openTrash()
    expect(screen.getByText('垃圾桶是空的')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '返回' }))
    expect(screen.getByRole('tree')).toBeInTheDocument()
  })

  it('lists trashed items with remaining days and restores them', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    const n = vault.createNote({ title: '舊筆記' })
    vault.trashNote(n.id)
    vi.setSystemTime(Date.now() + TRASH_DAY_MS + 1000)
    mount()
    await openTrash()
    const item = screen.getByRole('listitem')
    expect(within(item).getByText('舊筆記')).toBeInTheDocument()
    expect(within(item).getByText('29 天後永久刪除')).toBeInTheDocument()
    fireEvent.click(within(item).getByRole('button', { name: '還原' }))
    expect(vault.getNote(n.id)?.deletedAt).toBeNull()
    expect(screen.getByText('垃圾桶是空的')).toBeInTheDocument()
  })

  it('shows at least 1 day and restores whole folders', async () => {
    const f = vault.createFolder({ name: '資料夾', parentId: null })
    vault.createNote({ title: '裡面', folderId: f.id })
    vault.trashFolder(f.id)
    mount()
    await openTrash()
    expect(screen.getAllByRole('listitem')).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: '還原' }))
    expect(vault.listFolders()).toHaveLength(1)
    expect(vault.listNotes()).toHaveLength(1)
  })

  it('永久刪除 asks for inline confirmation, then purges the note through maintenance', async () => {
    const n = vault.createNote({ title: '要刪的' })
    vault.trashNote(n.id)
    mount()
    await openTrash()
    fireEvent.click(screen.getByRole('button', { name: '永久刪除' }))
    expect(screen.getByText('確定永久刪除？')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(vault.getNote(n.id)).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: '永久刪除' }))
    await act(async () => void fireEvent.click(screen.getByRole('button', { name: '刪除' })))
    expect(vault.getNote(n.id)).toBeUndefined()
    expect(maintenance.purge).toHaveBeenCalledWith({ kind: 'note', id: n.id })
  })

  it('永久刪除 of a folder purges every note inside', async () => {
    const f = vault.createFolder({ name: '資料夾', parentId: null })
    const n = vault.createNote({ title: '裡面', folderId: f.id })
    vault.trashFolder(f.id)
    mount()
    await openTrash()
    fireEvent.click(screen.getByRole('button', { name: '永久刪除' }))
    await act(async () => void fireEvent.click(screen.getByRole('button', { name: '刪除' })))
    expect(vault.listFolders({ includeTrashed: true })).toHaveLength(0)
    expect(vault.getNote(n.id)).toBeUndefined()
    expect(maintenance.purge).toHaveBeenCalledWith({ kind: 'folder', id: f.id })
  })
})

describe('row menus (typing cost)', () => {
  it('a closed row menu does not listen to every keydown (1000 rows must not cost the editor per key)', async () => {
    for (let i = 0; i < 30; i++) vault.createNote({ title: `N${i}` })
    mount()
    await screen.findByRole('treeitem', { name: /N29/ })
    const spy = vi.spyOn(document, 'addEventListener')
    fireEvent.keyDown(document.body, { key: 'a' })
    const calls = spy.mock.calls.length
    spy.mockRestore()
    expect(calls).toBeLessThan(5)
  })

  it('editing one note (updatedAt touch) re-renders only that row, not the whole tree', async () => {
    const ids = Array.from({ length: 30 }, (_, i) => vault.createNote({ title: `M${i}` }).id)
    mount()
    await screen.findByRole('treeitem', { name: /M29/ })
    await act(async () => void (await new Promise((r) => setTimeout(r, 100)))) // let the initial loads settle
    rowRenders.count = 0
    act(() => vault.touchNote(ids[5]))
    expect(rowRenders.count).toBeLessThanOrEqual(2)
  })

  it('更多操作 still opens the menu on press', async () => {
    vault.createNote({ title: 'Solo' })
    mount()
    const r = await screen.findByRole('treeitem', { name: /Solo/ })
    fireEvent.pointerDown(within(r).getByRole('button', { name: '更多操作', hidden: true }), { button: 0, pointerType: 'mouse' })
    expect(await screen.findByRole('menuitem', { name: '重新命名' })).toBeInTheDocument()
  })
})
