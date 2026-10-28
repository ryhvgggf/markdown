import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryStorage } from '@/adapters/storage/memory-storage'
import { createDb, type NotesDb } from '@/adapters/storage/db'
import { ServicesProvider } from '@/app/services-context'
import { useUi } from '@/app/ui-store'
import type { AppServices } from '@/app/bootstrap'
import { INDEX_VERSION, INDEX_VERSION_KEY } from '@/core/maintenance/maintenance'
import { Vault } from '@/core/vault/vault'
import { Sidebar } from './Sidebar'
import { formatBytes } from './AttachmentsView'

const channelFactory = () =>
  ({ postMessage() {}, close() {}, onmessage: null, addEventListener() {}, removeEventListener() {} }) as unknown as BroadcastChannel

let vault: Vault
let db: NotesDb
let storage: MemoryStorage
let maintenance: { purge: ReturnType<typeof vi.fn>; purgeAttachment: ReturnType<typeof vi.fn> }

const mount = () =>
  render(
    <ServicesProvider services={{ vault, db, storage, maintenance, storageMode: 'persistent' } as unknown as AppServices}>
      <Sidebar />
    </ServicesProvider>,
  )
const add = (name: string, size = 2048, mimeType = 'image/png') => vault.addAttachment({ filename: name, mimeType, size })

beforeEach(async () => {
  vault = await Vault.open(new MemoryStorage(), 'v', { channelFactory })
  storage = new MemoryStorage()
  db = createDb('att-' + Math.random().toString(36).slice(2))
  await db.meta.put({ key: INDEX_VERSION_KEY, value: INDEX_VERSION })
  maintenance = {
    purge: vi.fn(async () => true),
    purgeAttachment: vi.fn(async (id: string) => {
      vault.removeAttachment(id)
      return true
    }),
  }
  useUi.setState({ openNoteId: null, sidebarView: 'attachments' })
})
afterEach(() => {
  cleanup()
  db.close()
})

const row = (name: string) => screen.getByText(name).closest('li') as HTMLElement

describe('Attachments view', () => {
  it('formats sizes', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(2048)).toBe('2.0 KB')
    expect(formatBytes(3 * 1024 * 1024)).toBe('3.0 MB')
  })

  it('lists every attachment with where it is used, and filters used / unused', async () => {
    const used = add('used.png')
    const unused = add('unused.png', 1024 * 1024, 'video/mp4')
    const onlyTrash = add('old.png')
    const n = vault.createNote({ title: '採購流程' })
    const t = vault.createNote({ title: '舊的' })
    vault.trashNote(t.id)
    await db.attachmentRefs.bulkPut([
      { noteId: n.id, attachmentId: used.id },
      { noteId: t.id, attachmentId: onlyTrash.id },
    ])
    mount()
    expect(screen.getByText('共 3 個 · 1.0 MB')).toBeInTheDocument()
    await waitFor(() => expect(within(row('used.png')).getByRole('button', { name: '採購流程' })).toBeInTheDocument())
    expect(within(row('unused.png')).getByText('未使用')).toBeInTheDocument()
    expect(within(row('old.png')).getByText('未使用（只在垃圾桶中的筆記）')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('radio', { name: '使用中 1' }))
    expect(screen.queryByText('unused.png')).toBeNull()
    expect(screen.getByText('used.png')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('radio', { name: '未使用 2' }))
    expect(screen.queryByText('used.png')).toBeNull()
    expect(screen.getByText(unused.filename)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('radio', { name: '全部 3' }))
    fireEvent.click(within(row('used.png')).getByRole('button', { name: '採購流程' }))
    expect(useUi.getState().openNoteId).toBe(n.id)
  })

  it('hides usage while the index is being rebuilt (no guessed 未使用)', async () => {
    add('a.png')
    await db.meta.put({ key: INDEX_VERSION_KEY, value: INDEX_VERSION - 1 })
    mount()
    expect(await screen.findByText('正在整理附件的使用狀況…')).toBeInTheDocument()
    expect(screen.queryByText('未使用')).toBeNull()
    expect(screen.queryByRole('radiogroup', { name: '篩選附件' })).toBeNull()
  })

  it('moves an unused attachment to the trash at once, whatever its age', async () => {
    const a = add('fresh.png')
    mount()
    await screen.findByText('未使用')
    fireEvent.click(screen.getByRole('button', { name: '把 fresh.png 移到垃圾桶' }))
    expect(vault.getAttachment(a.id)?.deletedAt).toEqual(expect.any(Number))
    expect(screen.queryByText('fresh.png')).toBeNull()
  })

  it('asks before trashing an attachment that notes still use', async () => {
    const a = add('used.png')
    const n = vault.createNote({ title: 'A' })
    await db.attachmentRefs.put({ noteId: n.id, attachmentId: a.id })
    mount()
    await screen.findByRole('button', { name: 'A' })
    fireEvent.click(screen.getByRole('button', { name: '把 used.png 移到垃圾桶' }))
    expect(screen.getByText(/仍有 1 篇筆記使用這個附件/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(vault.getAttachment(a.id)?.deletedAt).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '把 used.png 移到垃圾桶' }))
    fireEvent.click(screen.getByRole('button', { name: '移到垃圾桶' }))
    expect(vault.getAttachment(a.id)?.deletedAt).toEqual(expect.any(Number))
  })

  it('trashed attachments appear in the trash, count toward it, and restore or purge from there', async () => {
    const a = add('pic.png')
    const b = add('clip.png')
    vault.trashAttachment(a.id)
    vault.trashAttachment(b.id)
    useUi.setState({ sidebarView: 'tree' })
    mount()
    const trashBtn = screen.getByRole('button', { name: /垃圾桶/ })
    expect(within(trashBtn).getByText('2')).toBeInTheDocument()
    fireEvent.click(trashBtn)
    const items = screen.getAllByRole('listitem')
    expect(items.map((i) => i.getAttribute('data-kind'))).toEqual(['attachment', 'attachment'])
    fireEvent.click(within(row('pic.png')).getByRole('button', { name: '還原' }))
    expect(vault.getAttachment(a.id)?.deletedAt).toBeNull()
    fireEvent.click(within(row('clip.png')).getByRole('button', { name: '永久刪除' }))
    await act(async () => void fireEvent.click(screen.getByRole('button', { name: '刪除' })))
    expect(maintenance.purgeAttachment).toHaveBeenCalledWith(b.id)
    expect(screen.getByText('垃圾桶是空的')).toBeInTheDocument()
  })

  it('返回 goes back to the folder tree', async () => {
    mount()
    expect(screen.getByText(/還沒有附件/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '返回' }))
    expect(useUi.getState().sidebarView).toBe('tree')
  })
})
