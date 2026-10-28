import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { bootstrap, type AppServices } from '@/app/bootstrap'
import { ServicesProvider } from '@/app/services-context'
import { useUi } from '@/app/ui-store'
import { DEFAULT_PREFS } from '@/core/preferences/preferences'
import { Background } from '@/features/shell/Background'
import { NoteCardBackground } from '@/features/shell/NoteCardBackground'
import { AppearanceEffects } from './AppearanceEffects'
import { DataDialog } from './DataDialog'
import { SettingsDialog } from './SettingsDialog'

let n = 0
async function setup(over: Partial<AppServices> = {}, opts: { open?: boolean } = {}) {
  const base = await bootstrap({ dbName: `settings-${n++}`, forceMemory: true, seedGuide: false })
  const services = { ...base, ...over } as AppServices
  render(
    <ServicesProvider services={services}>
      <AppearanceEffects />
      <Background />
      <NoteCardBackground />
      <SettingsDialog />
      <DataDialog />
    </ServicesProvider>,
  )
  const user = userEvent.setup()
  if (opts.open === false) return { services, user, dialog: null as never, tab: null as never }
  act(() => useUi.getState().setSettings(true))
  const dialog = await screen.findByRole('dialog', { name: '設定' })
  const tab = (name: string) => user.click(within(dialog).getByRole('tab', { name }))
  return { services, dialog, user, tab }
}

/** The 資料 window (opened from the rail's 資料 button). */
async function setupData(over: Partial<AppServices> = {}) {
  const r = await setup(over, { open: false })
  act(() => useUi.getState().setData(true))
  const dialog = await screen.findByRole('dialog', { name: '資料' })
  return { ...r, dialog }
}

const root = document.documentElement

beforeEach(() => {
  let i = 0
  URL.createObjectURL = vi.fn(() => `blob:fake-${i++}`)
  URL.revokeObjectURL = vi.fn()
})
afterEach(() => {
  act(() => {
    useUi.getState().setSettings(false)
    useUi.getState().setData(false)
  })
  root.removeAttribute('style')
})

describe('SettingsDialog', () => {
  it('lists the five sections (資料 has its own window) and closes on Esc', async () => {
    const { dialog, user } = await setup()
    for (const name of ['背景', '色彩', '文字', '版面', '動態']) {
      expect(within(dialog).getByRole('tab', { name })).toBeInTheDocument()
    }
    expect(within(dialog).queryByRole('tab', { name: '資料' })).toBeNull()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('returns focus to the element that opened it', async () => {
    const { user } = await setup({}, { open: false })
    const btn = document.createElement('button')
    document.body.append(btn)
    btn.focus()
    act(() => useUi.getState().setSettings(true))
    await screen.findByRole('dialog')
    await user.keyboard('{Escape}')
    await waitFor(() => expect(btn).toHaveFocus())
    btn.remove()
  })

  it('applies the accent immediately when a swatch is chosen', async () => {
    const { dialog, user, tab, services } = await setup()
    await tab('色彩')
    const group = within(dialog).getByRole('radiogroup', { name: '強調色' })
    expect(within(group).getAllByRole('radio')).toHaveLength(8)
    await user.click(within(group).getByRole('radio', { name: '青' }))
    expect(services.prefs.get().accent).toBe('#0B7A75')
    await waitFor(() => expect(root.style.getPropertyValue('--accent')).toBe('#0B7A75'))
  })

  it('changes text size, line height and editor width', async () => {
    const { dialog, user, tab } = await setup()
    await tab('文字')
    await user.click(within(within(dialog).getByRole('radiogroup', { name: '字級' })).getByRole('radio', { name: '大' }))
    await user.click(within(within(dialog).getByRole('radiogroup', { name: '行距' })).getByRole('radio', { name: '寬鬆' }))
    await user.click(within(within(dialog).getByRole('radiogroup', { name: '編輯區寬度' })).getByRole('radio', { name: '窄' }))
    await waitFor(() => expect(root.style.getPropertyValue('--font-size-body')).toBe('18px'))
    expect(root.style.getPropertyValue('--line-height-body')).toBe('2')
    expect(root.style.getPropertyValue('--editor-width')).toBe('600px')
  })

  it('sets rail mode and sidebar width', async () => {
    const { dialog, user, tab, services } = await setup()
    await tab('版面')
    await user.click(within(dialog).getByRole('radio', { name: '固定顯示' }))
    expect(services.prefs.get().railMode).toBe('pinned')
    const slider = within(dialog).getByRole('slider', { name: '側欄寬度' })
    expect(slider).toHaveAttribute('min', '220')
    expect(slider).toHaveAttribute('max', '360')
    expect(slider).toHaveAttribute('step', '4')
  })

  it('motion and transparency follow the system unless overridden', async () => {
    const { dialog, user, tab } = await setup()
    await tab('動態')
    await user.click(within(within(dialog).getByRole('radiogroup', { name: '減少動態效果' })).getByRole('radio', { name: '開啟' }))
    await waitFor(() => expect(root.dataset.reduceMotion).toBe('true'))
    await user.click(within(within(dialog).getByRole('radiogroup', { name: '減少透明度' })).getByRole('radio', { name: '關閉' }))
    await waitFor(() => expect(root.dataset.reduceTransparency).toBe('false'))
  })

  describe('background', () => {
    const png = (size = 10) => new File([new Uint8Array(size)], 'bg.png', { type: 'image/png' })

    it('the page background stays fixed, with no image controls for it', async () => {
      const { dialog } = await setup()
      expect(screen.getByTestId('background')).toHaveStyle({ background: 'var(--page-background)' })
      expect(within(dialog).queryByText('模糊度')).toBeNull()
      expect(within(dialog).queryByText('淡化程度')).toBeNull()
    })

    it('uploads an image for the note card: stores the blob, shows it, and replaces the previous one', async () => {
      const { dialog, user, services } = await setup()
      const input = within(dialog).getByLabelText('背景圖片檔案') as HTMLInputElement
      expect(input).toHaveAttribute('accept', 'image/*')
      await user.upload(input, png())
      await waitFor(() => expect(services.prefs.get().noteBackgroundBlobId).not.toBeNull())
      const first = services.prefs.get().noteBackgroundBlobId!
      expect(await services.storage.getBlob(first)).toBeTruthy()
      await waitFor(() => expect(screen.getByTestId('note-card-background').style.backgroundImage).toContain('blob:fake-'))
      await user.upload(input, png(20))
      await waitFor(() => expect(services.prefs.get().noteBackgroundBlobId).not.toBe(first))
      await waitFor(async () => expect(await services.storage.getBlob(first)).toBeFalsy())
    })

    it('labels the upload button 上傳圖片 and rejects SVG (M6, M7)', async () => {
      const { dialog, user, services } = await setup()
      expect(within(dialog).getByRole('button', { name: '上傳圖片' })).toBeInTheDocument()
      await user.upload(within(dialog).getByLabelText('背景圖片檔案'), new File(['<svg/>'], 'a.svg', { type: 'image/svg+xml' }))
      expect(await within(dialog).findByText('不支援 SVG 圖片，請改用 PNG、JPEG 或 GIF。')).toBeInTheDocument()
      expect(services.prefs.get().noteBackgroundBlobId).toBeNull()
    })

    it('concurrent uploads keep only the winning blob (M7)', async () => {
      const { dialog, user, services } = await setup()
      const put = services.storage.putBlob.bind(services.storage)
      const ids: string[] = []
      let call = 0
      services.storage.putBlob = async (id, blob) => {
        ids.push(id)
        if (call++ === 0) await new Promise((r) => setTimeout(r, 50)) // first upload is slow
        return put(id, blob)
      }
      const input = within(dialog).getByLabelText('背景圖片檔案')
      await user.upload(input, png())
      await user.upload(input, png(20))
      await waitFor(() => expect(ids).toHaveLength(2))
      await new Promise((r) => setTimeout(r, 120))
      const current = services.prefs.get().noteBackgroundBlobId
      expect(ids).toContain(current)
      const loser = ids.find((x) => x !== current)!
      await waitFor(async () => expect(await services.storage.getBlob(loser)).toBeFalsy())
    })

    it('rejects images over 20 MB', async () => {
      const { dialog, user, services } = await setup()
      const big = png(1)
      Object.defineProperty(big, 'size', { value: 20 * 1024 * 1024 + 1 })
      await user.upload(within(dialog).getByLabelText('背景圖片檔案'), big)
      expect(await within(dialog).findByText('圖片超過 20 MB，請選擇較小的檔案。')).toBeInTheDocument()
      expect(services.prefs.get().noteBackgroundBlobId).toBeNull()
    })

    it('the opacity slider shows the image through at the set level, left entirely to the user', async () => {
      const { dialog, user, services } = await setup()
      await user.upload(within(dialog).getByLabelText('背景圖片檔案'), png())
      await waitFor(() => expect(screen.getByTestId('note-card-background')).toHaveStyle({ opacity: '1' }))
      services.prefs.set({ noteBackgroundOpacity: 0.4 })
      await waitFor(() => expect(screen.getByTestId('note-card-background')).toHaveStyle({ opacity: '0.4' }))
    })

    it('has a 透明度 slider 0–1 step 0.05', async () => {
      const { dialog } = await setup()
      const s = within(dialog).getByRole('slider', { name: '透明度' })
      expect(s).toHaveAttribute('min', '0')
      expect(s).toHaveAttribute('max', '1')
      expect(s).toHaveAttribute('step', '0.05')
    })

    it('恢復預設 clears the image and resets opacity', async () => {
      const { dialog, user, services } = await setup()
      await user.upload(within(dialog).getByLabelText('背景圖片檔案'), png())
      await waitFor(() => expect(services.prefs.get().noteBackgroundBlobId).not.toBeNull())
      const id = services.prefs.get().noteBackgroundBlobId!
      services.prefs.set({ noteBackgroundOpacity: 0.3 })
      await user.click(within(dialog).getByRole('button', { name: '恢復預設' }))
      await waitFor(() => expect(services.prefs.get().noteBackgroundBlobId).toBeNull())
      expect(services.prefs.get().noteBackgroundOpacity).toBe(DEFAULT_PREFS.noteBackgroundOpacity)
      await waitFor(async () => expect(await services.storage.getBlob(id)).toBeFalsy())
    })
  })

  describe('data', () => {
    it('加入功能導覽筆記 adds the guide folder (again, with suffixed titles) and opens its first note', async () => {
      const { dialog, user, services } = await setupData()
      await user.click(within(dialog).getByRole('button', { name: '加入功能導覽筆記' }))
      expect(await within(dialog).findByText('已加入「功能導覽」資料夾。')).toBeInTheDocument()
      const first = services.vault.listFolders().find((f) => f.name === '功能導覽')!
      // the vault already holds the plain 歡迎使用 note, so the guide's copy gets the usual suffix
      expect(services.vault.getNote(useUi.getState().openNoteId!)).toMatchObject({ title: '歡迎使用 (2)', folderId: first.id })
      await user.click(within(dialog).getByRole('button', { name: '加入功能導覽筆記' }))
      await waitFor(() => expect(services.vault.listFolders().map((f) => f.name)).toEqual(['功能導覽', '功能導覽 (2)']))
      await waitFor(() => expect(services.vault.getNote(useUi.getState().openNoteId!)?.title).toBe('歡迎使用 (3)'))
    })

    it('rebuilds the index with progress copy and disables while running', async () => {
      const { dialog, user, services } = await setupData()
      let finish!: () => void
      services.indexer.rebuildAll = vi.fn(() => new Promise<{ failed: string[] }>((r) => (finish = () => r({ failed: [] }))))
      await user.click(within(dialog).getByRole('button', { name: '重建索引' }))
      const running = within(dialog).getByRole('button', { name: '正在重建…' })
      expect(running).toBeDisabled()
      await act(async () => finish())
      expect(await within(dialog).findByText('已完成')).toBeInTheDocument()
    })

    it('shows rebuild errors inline in plain Chinese, without the technical message', async () => {
      const { dialog, user, services } = await setupData()
      services.indexer.rebuildAll = vi.fn().mockRejectedValue(new Error('boom'))
      await user.click(within(dialog).getByRole('button', { name: '重建索引' }))
      expect(await within(dialog).findByText('重建失敗，請稍後再試。')).toBeInTheDocument()
      expect(within(dialog).queryByText(/boom/)).toBeNull()
    })

    it('skips unreadable notes and says how many were skipped (M9)', async () => {
      const { dialog, user, services } = await setupData()
      services.indexer.rebuildAll = vi.fn(async () => ({ failed: ['a', 'b'] }))
      await user.click(within(dialog).getByRole('button', { name: '重建索引' }))
      expect(await within(dialog).findByText('已完成，有 2 篇筆記無法讀取，已略過。')).toBeInTheDocument()
    })

    it('says nothing about storage once the browser keeps the data', async () => {
      const { dialog } = await setupData({ persistence: 'granted', storageMode: 'persistent' })
      expect(within(dialog).queryByText('儲存空間')).toBeNull()
      expect(within(dialog).queryByText('瀏覽器已同意長期保存這些資料。')).toBeNull()
    })

    it.each([
      ['denied', '瀏覽器可能在空間不足時清除資料。之後開啟同步或自動備份可以保護你的筆記。'],
      ['unsupported', '這個瀏覽器不支援長期保存設定。'],
    ] as const)('persistence %s copy', async (persistence, copy) => {
      const { dialog } = await setupData({ persistence, storageMode: 'persistent' })
      expect(within(dialog).getByText(copy)).toBeInTheDocument()
    })

    it('shows the memory warning instead in memory mode', async () => {
      const { dialog } = await setupData({ persistence: 'granted', storageMode: 'memory' })
      expect(within(dialog).getByText('目前的瀏覽器模式無法保存資料，關閉視窗後內容會消失。')).toBeInTheDocument()
      expect(within(dialog).queryByText('瀏覽器已同意長期保存這些資料。')).toBeNull()
    })
  })
})
