import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createDb, type NotesDb } from '@/adapters/storage/db'
import { MemoryStorage } from '@/adapters/storage/memory-storage'
import { writeZip } from '@/adapters/zip/zip'
import type { AppServices } from '@/app/bootstrap'
import { ServicesProvider } from '@/app/services-context'
import { createTransferServices, type TransferServices } from '@/app/transfer-services'
import { useUi } from '@/app/ui-store'
import { NoteDocCache } from '@/core/note-doc/cache'
import { Vault } from '@/core/vault/vault'
import { ExportSection } from './ExportSection'
import { ImportDialog } from './ImportDialog'

vi.mock('./download', async (orig) => ({ ...(await orig<typeof import('./download')>()), downloadBlob: vi.fn() }))
const { downloadBlob } = await import('./download')

const channelFactory = () =>
  ({ postMessage() {}, close() {}, onmessage: null, addEventListener() {}, removeEventListener() {} }) as unknown as BroadcastChannel

let vault: Vault
let db: NotesDb
let transfer: TransferServices
beforeEach(async () => {
  vault = await Vault.open(new MemoryStorage(), 'v', { channelFactory })
  const storage = new MemoryStorage()
  db = createDb('ui-' + Math.random().toString(36).slice(2))
  transfer = createTransferServices({ vault, storage, db, notes: new NoteDocCache(storage), indexer: { catchUp: async () => ({ failed: [] }) as never } })
  useUi.setState({ importFiles: null, openNoteId: null })
})
afterEach(() => {
  cleanup()
  db.close()
})

const mount = (ui: React.ReactNode) =>
  render(<ServicesProvider services={{ vault, db, transfer } as unknown as AppServices}>{ui}</ServicesProvider>)
const file = (name: string, text: string) => new File([text], name, { type: 'text/markdown' })

describe('import dialog', () => {
  it('previews, imports into 「匯入 日期」 and reports renames with links to the notes', async () => {
    vault.createNote({ title: 'A' })
    mount(<ImportDialog />)
    act(() => useUi.getState().openImport([file('A.md', '[[B]]'), file('B.md', '# B'), file('C.md', '[[不存在]]')]))
    expect(await screen.findByText('將匯入 3 篇筆記、0 個資料夾、0 個附件。')).toBeInTheDocument()
    expect(screen.getByText(/1 篇標題和現有筆記重複/)).toBeInTheDocument()
    expect(screen.getByText('1 個連結找不到對應的筆記，會保留為文字。')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '匯入' }))
    expect(await screen.findByText('已匯入 3 篇筆記、0 個資料夾、0 個附件。')).toBeInTheDocument()
    expect(vault.listFolders().map((f) => f.name)[0]).toMatch(/^匯入 \d{4}-\d{2}-\d{2}$/)
    fireEvent.click(screen.getByRole('button', { name: 'A (2)' }))
    expect(useUi.getState().openNoteId).toBe(vault.listNotes().find((n) => n.title === 'A (2)')!.id)
    expect(useUi.getState().importFiles).toBeNull()
  })

  it('a backup with notes already here: neither choice is preselected and 匯入 waits for one', async () => {
    const n = vault.createNote({ title: '一' })
    await transfer.docs.write(n.id, { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '舊' }] }] })
    const { blob } = await transfer.exportFile({ kind: 'vault' }, { includeUnusedAttachments: false })
    mount(<ImportDialog />)
    act(() => useUi.getState().openImport([new File([blob], 'backup.zip')]))
    expect(await screen.findByText('備份中有 1 篇筆記已存在這個知識庫。')).toBeInTheDocument()
    const go = screen.getByRole('button', { name: '匯入' })
    expect(screen.getByRole('radio', { name: /覆蓋/ })).not.toBeChecked()
    expect(screen.getByRole('radio', { name: '建立副本' })).not.toBeChecked()
    expect(go).toBeDisabled()
    fireEvent.click(screen.getByRole('radio', { name: '建立副本' }))
    expect(go).toBeEnabled()
    fireEvent.click(go)
    await screen.findByText(/已匯入 1 篇筆記/)
    expect(vault.listNotes().map((x) => x.title).sort()).toEqual(['一', '一 (2)'])
  })

  it('files without notes say so', async () => {
    const zip = await writeZip((async function* () {})())
    mount(<ImportDialog />)
    act(() => useUi.getState().openImport([new File([zip], 'empty.zip')]))
    expect(await screen.findByText('這些檔案裡沒有 Markdown 筆記。')).toBeInTheDocument()
  })
})

describe('export section', () => {
  it('downloads 我的知識庫-日期.zip', async () => {
    vault.createNote({ title: 'x' })
    mount(<ExportSection />)
    fireEvent.click(screen.getByRole('button', { name: '匯出 ZIP' }))
    await waitFor(() => expect(downloadBlob).toHaveBeenCalled())
    expect(vi.mocked(downloadBlob).mock.calls[0][1]).toMatch(/^我的知識庫-\d{4}-\d{2}-\d{2}\.zip$/)
  })
})
