import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryStorage } from '@/adapters/storage/memory-storage'
import { ServicesProvider } from '@/app/services-context'
import { useUi } from '@/app/ui-store'
import type { AppServices } from '@/app/bootstrap'
import { createUnavailableAccount, type AccountService, type AccountState } from '@/app/account-service'
import type { SyncStatus } from '@/app/sync-status'
import { Vault } from '@/core/vault/vault'
import { DEFAULT_PREFS } from '@/core/preferences/preferences'
import { Sidebar } from './Sidebar'
import { TRASH_DAY_MS } from './TrashView'
import { rowRenders } from './TreeItem'

let prefsNow = DEFAULT_PREFS
const fakePrefs = { get: () => prefsNow, observe: () => () => {} }
const focusTitleEnd = vi.hoisted(() => vi.fn(() => true))
vi.mock('@/features/editor/focus-bridge', () => ({ focusTitleEnd }))

const channelFactory = () =>
  ({ postMessage() {}, close() {}, onmessage: null, addEventListener() {}, removeEventListener() {} }) as unknown as BroadcastChannel

let vault: Vault
let metaRows: Map<string, unknown>
let maintenance: { purge: ReturnType<typeof vi.fn>; purgeAll: ReturnType<typeof vi.fn> }
let mode: 'persistent' | 'memory'
let account: AccountService

/** An account stub in a fixed state, with a settable sync status. */
function fakeAccount(state: AccountState, status: SyncStatus = { state: 'synced', issues: [] }) {
  const listeners = new Set<() => void>()
  let st = status
  const a: AccountService & { setSync(s: SyncStatus): void } = {
    ...createUnavailableAccount(),
    getState: () => state,
    getSyncStatus: () => st,
    subscribeSync: (cb) => {
      listeners.add(cb)
      return () => void listeners.delete(cb)
    },
    setSync(s) {
      st = s
      listeners.forEach((l) => l())
    },
  }
  return a
}

function fakeDb() {
  return {
    meta: {
      get: async (k: string) => (metaRows.has(k) ? { key: k, value: metaRows.get(k) } : undefined),
      put: async (r: { key: string; value: unknown }) => void metaRows.set(r.key, r.value),
    },
  }
}
const mount = () => {
  const services = { vault, maintenance, account, db: fakeDb(), storageMode: mode, prefs: fakePrefs } as unknown as AppServices
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
    purgeAll: vi.fn(async (refs: Array<{ kind: string; id: string }>) => {
      for (const ref of refs) {
        if (ref.kind === 'note') vault.purgeNote(ref.id)
        else if (ref.kind === 'folder') vault.purgeFolder(ref.id)
      }
      return true
    }),
  }
  mode = 'persistent'
  account = createUnavailableAccount()
  prefsNow = DEFAULT_PREFS
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

  it('a note menu has no 重新命名 (the title is its name) and offers 下載此筆記; F2 does nothing on a note', async () => {
    vault.createNote({ title: 'Alpha' })
    mount()
    const row = await screen.findByRole('treeitem', { name: /Alpha/ })
    fireEvent.contextMenu(row)
    expect(await screen.findByRole('menuitem', { name: '下載此筆記' })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: '重新命名' })).toBeNull()
    fireEvent.keyDown(row, { key: 'Escape' })
    fireEvent.keyDown(row, { key: 'F2' })
    expect(screen.queryByRole('textbox', { name: '重新命名' })).toBeNull()
  })

  it('a folder renames from its menu; Escape cancels', async () => {
    const f = vault.createFolder({ name: '專案', parentId: null })
    mount()
    fireEvent.contextMenu(await screen.findByRole('treeitem', { name: /專案/ }))
    expect(await screen.findByRole('menuitem', { name: '下載此資料夾' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('menuitem', { name: '重新命名' }))
    const input = await screen.findByRole('textbox', { name: '重新命名' })
    fireEvent.change(input, { target: { value: 'Zed' } })
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(screen.queryByRole('textbox', { name: '重新命名' })).toBeNull()
    expect(vault.listFolders().find((x) => x.id === f.id)?.name).toBe('專案')
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

  it('清空垃圾桶 asks for one confirmation, then purges every trashed item', async () => {
    const a = vault.createNote({ title: 'A' })
    const b = vault.createNote({ title: 'B' })
    vault.trashNote(a.id)
    vault.trashNote(b.id)
    mount()
    await openTrash()
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
    fireEvent.click(screen.getByRole('button', { name: '清空垃圾桶' }))
    expect(screen.getByText('確定永久刪除全部 2 項？此動作無法復原。')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(vault.getNote(a.id)).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: '清空垃圾桶' }))
    await act(async () => void fireEvent.click(screen.getByRole('button', { name: '全部刪除' })))
    expect(vault.getNote(a.id)).toBeUndefined()
    expect(vault.getNote(b.id)).toBeUndefined()
    expect(maintenance.purgeAll).toHaveBeenCalledWith(expect.arrayContaining([{ kind: 'note', id: a.id }, { kind: 'note', id: b.id }]))
    expect(screen.getByText('垃圾桶是空的')).toBeInTheDocument()
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
    expect(await screen.findByRole('menuitem', { name: '下載此筆記' })).toBeInTheDocument()
  })
})

describe('Sidebar sorting', () => {
  const titles = async () => (await screen.findAllByRole('treeitem')).map((el) => el.textContent)
  it('lists notes by name ascending by default, regardless of creation order', async () => {
    vault.createNote({ title: 'Beta', folderId: null })
    vault.createNote({ title: 'Alpha', folderId: null })
    mount()
    expect(await titles()).toEqual(['Alpha', 'Beta'])
  })
  it('follows the sortable preferences (name, descending)', async () => {
    vault.createNote({ title: 'Beta', folderId: null })
    vault.createNote({ title: 'Alpha', folderId: null })
    prefsNow = { ...DEFAULT_PREFS, sidebarSort: 'name', sidebarSortDir: 'desc' }
    mount()
    expect(await titles()).toEqual(['Beta', 'Alpha'])
  })
})

describe('同步到雲端 (3f-2)', () => {
  const unlocked: AccountState = { status: 'unlocked', email: 'a@example.com', vaultId: 'v1' }

  it('is offered only when signed in', async () => {
    vault.createNote({ title: 'Alpha' })
    mount()
    fireEvent.contextMenu(await screen.findByRole('treeitem', { name: /Alpha/ }))
    await screen.findByRole('menuitem', { name: '下載此筆記' })
    expect(screen.queryByRole('menuitem', { name: '同步到雲端' })).toBeNull()
  })

  it('同步到雲端 opens a selection: clicking notes ticks them, 完成 applies; turning off asks first', async () => {
    account = fakeAccount(unlocked)
    const a = vault.createNote({ title: 'Alpha' })
    const b = vault.createNote({ title: 'Beta' })
    const c = vault.createNote({ title: 'Gamma' })
    vault.setNoteSynced(c.id, true)
    mount()
    expect(within(await screen.findByRole('treeitem', { name: /Gamma/ })).getByLabelText('已同步到雲端')).toBeInTheDocument()
    fireEvent.contextMenu(screen.getByRole('treeitem', { name: /Alpha/ }))
    fireEvent.click(await screen.findByRole('menuitem', { name: '同步到雲端' }))

    const box = (t: string) => within(screen.getByRole('treeitem', { name: new RegExp(t) })).getByRole('checkbox')
    expect(box('Alpha')).toHaveAttribute('aria-checked', 'false')
    expect(box('Gamma')).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(screen.getByRole('treeitem', { name: /Alpha/ }))
    fireEvent.click(screen.getByRole('treeitem', { name: /Beta/ }))
    fireEvent.click(screen.getByRole('treeitem', { name: /Beta/ })) // and back
    fireEvent.click(screen.getByRole('treeitem', { name: /Gamma/ }))
    expect(box('Alpha')).toHaveAttribute('aria-checked', 'true')
    expect(useUi.getState().openNoteId).toBeNull() // clicks select, they don't open
    expect(vault.getNote(a.id)!.synced).toBe(false) // nothing applied yet

    fireEvent.click(screen.getByRole('button', { name: '完成' }))
    const dialog = await screen.findByRole('dialog', { name: '停止同步 1 篇筆記？' })
    fireEvent.click(within(dialog).getByRole('button', { name: '取消' }))
    expect(screen.getByRole('button', { name: '完成' })).toBeInTheDocument() // back to selecting
    fireEvent.click(screen.getByRole('button', { name: '完成' }))
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: '停止同步' }))
    expect(vault.getNote(a.id)!.synced).toBe(true)
    expect(vault.getNote(b.id)!.synced).toBe(false)
    expect(vault.getNote(c.id)!.synced).toBe(false)
    expect(screen.queryByRole('checkbox')).toBeNull()
  })

  it('取消 leaves sync as it was; turning only on needs no confirmation', async () => {
    account = fakeAccount(unlocked)
    const a = vault.createNote({ title: 'Alpha' })
    mount()
    fireEvent.contextMenu(await screen.findByRole('treeitem', { name: /Alpha/ }))
    fireEvent.click(await screen.findByRole('menuitem', { name: '同步到雲端' }))
    fireEvent.click(screen.getByRole('treeitem', { name: /Alpha/ }))
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(vault.getNote(a.id)!.synced).toBe(false)

    fireEvent.contextMenu(screen.getByRole('treeitem', { name: /Alpha/ }))
    fireEvent.click(await screen.findByRole('menuitem', { name: '同步到雲端' }))
    fireEvent.click(screen.getByRole('treeitem', { name: /Alpha/ }))
    fireEvent.click(screen.getByRole('button', { name: '完成' }))
    expect(vault.getNote(a.id)!.synced).toBe(true)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('資料夾 can be synced: 同步此資料夾 syncs what is inside and what is put there; 停止同步 asks first', async () => {
    account = fakeAccount(unlocked)
    const f = vault.createFolder({ name: 'Work', parentId: null })
    const inside = vault.createNote({ title: 'Inside', folderId: f.id })
    mount()
    fireEvent.contextMenu(await screen.findByRole('treeitem', { name: /Work/ }))
    fireEvent.click(await screen.findByRole('menuitem', { name: '同步此資料夾' }))
    expect(vault.getNote(inside.id)!.synced).toBe(true)
    expect(vault.createNote({ title: 'Later', folderId: f.id }).synced).toBe(true)
    expect(within(await screen.findByRole('treeitem', { name: /Work/ })).getByLabelText('資料夾已同步到雲端')).toBeInTheDocument()

    fireEvent.contextMenu(screen.getByRole('treeitem', { name: /Work/ }))
    fireEvent.click(await screen.findByRole('menuitem', { name: '停止同步此資料夾' }))
    const dialog = await screen.findByRole('dialog', { name: '停止同步資料夾「Work」？' })
    expect(dialog).toHaveTextContent('2 篇筆記的雲端副本會被刪除')
    fireEvent.click(within(dialog).getByRole('button', { name: '取消' }))
    expect(vault.getNote(inside.id)!.synced).toBe(true)

    fireEvent.contextMenu(screen.getByRole('treeitem', { name: /Work/ }))
    fireEvent.click(await screen.findByRole('menuitem', { name: '停止同步此資料夾' }))
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: '停止同步' }))
    expect(vault.getNote(inside.id)!.synced).toBe(false)
    expect(screen.queryByLabelText('資料夾已同步到雲端')).toBeNull()
  })

  it('the folder item is offered only when signed in', async () => {
    vault.createFolder({ name: 'Work', parentId: null })
    mount()
    fireEvent.contextMenu(await screen.findByRole('treeitem', { name: /Work/ }))
    await screen.findByRole('menuitem', { name: '下載此資料夾' })
    expect(screen.queryByRole('menuitem', { name: '同步此資料夾' })).toBeNull()
  })

  it('the status line shows sync progress and problems, and opens the account settings', async () => {
    const a = fakeAccount(unlocked, { state: 'syncing', issues: [] })
    account = a
    const n = vault.createNote({ title: 'Alpha' })
    vault.setNoteSynced(n.id, true)
    mount()
    expect(await screen.findByRole('button', { name: '同步中…' })).toBeInTheDocument()
    act(() => a.setSync({ state: 'synced', issues: [] }))
    expect(screen.getByRole('button', { name: '已同步' })).toBeInTheDocument()
    act(() => a.setSync({ state: 'error', issues: [{ docId: n.id, kind: 'conflict' }] }))
    fireEvent.click(screen.getByRole('button', { name: '同步有問題' }))
    expect(useUi.getState().settingsOpen).toBe(true)
    expect(useUi.getState().settingsSection).toBe('account')
  })

  it('no status when nothing is synced', async () => {
    account = fakeAccount(unlocked)
    vault.createNote({ title: 'Alpha' })
    mount()
    await screen.findByRole('treeitem', { name: /Alpha/ })
    expect(screen.queryByRole('button', { name: '已同步' })).toBeNull()
  })
})
