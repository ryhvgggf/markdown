import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { bootstrap, type AppServices } from '@/app/bootstrap'
import { ServicesProvider } from '@/app/services-context'
import { useUi } from '@/app/ui-store'
import { DEFAULT_PREFS } from '@/core/preferences/preferences'
import { Background } from '@/features/shell/Background'
import { AppearanceEffects } from './AppearanceEffects'
import { SettingsDialog } from './SettingsDialog'

vi.mock('./background-busyness', async (orig) => ({
  ...(await orig<typeof import('./background-busyness')>()),
  measureBlobBusyness: vi.fn(async () => 0.8),
}))

let n = 0
async function setup(over: Partial<AppServices> = {}, opts: { open?: boolean } = {}) {
  const base = await bootstrap({ dbName: `settings-${n++}`, forceMemory: true })
  const services = { ...base, ...over } as AppServices
  render(
    <ServicesProvider services={services}>
      <AppearanceEffects />
      <Background />
      <SettingsDialog />
    </ServicesProvider>,
  )
  const user = userEvent.setup()
  if (opts.open === false) return { services, user, dialog: null as never, tab: null as never }
  act(() => useUi.getState().setSettings(true))
  const dialog = await screen.findByRole('dialog', { name: '設定' })
  const tab = (name: string) => user.click(within(dialog).getByRole('tab', { name }))
  return { services, dialog, user, tab }
}

const root = document.documentElement

beforeEach(() => {
  let i = 0
  URL.createObjectURL = vi.fn(() => `blob:fake-${i++}`)
  URL.revokeObjectURL = vi.fn()
})
afterEach(() => {
  act(() => useUi.getState().setSettings(false))
  root.removeAttribute('style')
})

describe('SettingsDialog', () => {
  it('lists the six sections and closes on Esc', async () => {
    const { dialog, user } = await setup()
    for (const name of ['背景', '色彩', '文字', '版面', '動態', '資料']) {
      expect(within(dialog).getByRole('tab', { name })).toBeInTheDocument()
    }
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

    it('uploads an image: stores the blob, shows it, and replaces the previous one', async () => {
      const { dialog, user, services } = await setup()
      const input = within(dialog).getByLabelText('上傳圖片') as HTMLInputElement
      expect(input).toHaveAttribute('accept', 'image/*')
      await user.upload(input, png())
      await waitFor(() => expect(services.prefs.get().backgroundBlobId).not.toBeNull())
      const first = services.prefs.get().backgroundBlobId!
      expect(await services.storage.getBlob(first)).toBeTruthy()
      await waitFor(() => expect(screen.getByTestId('background').innerHTML).toContain('blob:fake-'))
      await user.upload(input, png(20))
      await waitFor(() => expect(services.prefs.get().backgroundBlobId).not.toBe(first))
      await waitFor(async () => expect(await services.storage.getBlob(first)).toBeFalsy())
    })

    it('rejects images over 20 MB', async () => {
      const { dialog, user, services } = await setup()
      const big = png(1)
      Object.defineProperty(big, 'size', { value: 20 * 1024 * 1024 + 1 })
      await user.upload(within(dialog).getByLabelText('上傳圖片'), big)
      expect(await within(dialog).findByText('圖片超過 20 MB，請選擇較小的檔案。')).toBeInTheDocument()
      expect(services.prefs.get().backgroundBlobId).toBeNull()
    })

    it('raises applied blur and dim for busy images but keeps stored sliders', async () => {
      const { dialog, user, services } = await setup()
      await user.upload(within(dialog).getByLabelText('上傳圖片'), png())
      await waitFor(() => expect(screen.getByTestId('background').innerHTML).toContain('blur(24px)'))
      expect(screen.getByTestId('background').innerHTML).toContain('rgba(255, 255, 255, 0.3)')
      expect(services.prefs.get().backgroundBlur).toBe(DEFAULT_PREFS.backgroundBlur)
    })

    it('has blur and dim sliders 0–1 step 0.05', async () => {
      const { dialog } = await setup()
      for (const name of ['模糊度', '淡化程度']) {
        const s = within(dialog).getByRole('slider', { name })
        expect(s).toHaveAttribute('min', '0')
        expect(s).toHaveAttribute('max', '1')
        expect(s).toHaveAttribute('step', '0.05')
      }
    })

    it('恢復預設 clears the image and resets sliders', async () => {
      const { dialog, user, services } = await setup()
      await user.upload(within(dialog).getByLabelText('上傳圖片'), png())
      await waitFor(() => expect(services.prefs.get().backgroundBlobId).not.toBeNull())
      const id = services.prefs.get().backgroundBlobId!
      services.prefs.set({ backgroundBlur: 0.9, backgroundDim: 0.7 })
      await user.click(within(dialog).getByRole('button', { name: '恢復預設' }))
      await waitFor(() => expect(services.prefs.get().backgroundBlobId).toBeNull())
      expect(services.prefs.get().backgroundBlur).toBe(DEFAULT_PREFS.backgroundBlur)
      expect(services.prefs.get().backgroundDim).toBe(DEFAULT_PREFS.backgroundDim)
      await waitFor(async () => expect(await services.storage.getBlob(id)).toBeFalsy())
    })
  })

  describe('data', () => {
    it('rebuilds the index with progress copy and disables while running', async () => {
      const { dialog, user, tab, services } = await setup()
      let finish!: () => void
      services.indexer.rebuildAll = vi.fn(() => new Promise<{ failed: string[] }>((r) => (finish = () => r({ failed: [] }))))
      await tab('資料')
      await user.click(within(dialog).getByRole('button', { name: '重建索引' }))
      const running = within(dialog).getByRole('button', { name: '正在重建…' })
      expect(running).toBeDisabled()
      await act(async () => finish())
      expect(await within(dialog).findByText('已完成')).toBeInTheDocument()
    })

    it('shows rebuild errors inline in plain Chinese, without the technical message', async () => {
      const { dialog, user, tab, services } = await setup()
      services.indexer.rebuildAll = vi.fn().mockRejectedValue(new Error('boom'))
      await tab('資料')
      await user.click(within(dialog).getByRole('button', { name: '重建索引' }))
      expect(await within(dialog).findByText('重建失敗，請稍後再試。')).toBeInTheDocument()
      expect(within(dialog).queryByText(/boom/)).toBeNull()
    })

    it('skips unreadable notes and says how many were skipped (M9)', async () => {
      const { dialog, user, tab, services } = await setup()
      services.indexer.rebuildAll = vi.fn(async () => ({ failed: ['a', 'b'] }))
      await tab('資料')
      await user.click(within(dialog).getByRole('button', { name: '重建索引' }))
      expect(await within(dialog).findByText('已完成，有 2 篇筆記無法讀取，已略過。')).toBeInTheDocument()
    })

    it.each([
      ['granted', '瀏覽器已同意長期保存這些資料。'],
      ['denied', '瀏覽器可能在空間不足時清除資料。之後開啟同步或自動備份可以保護你的筆記。'],
      ['unsupported', '這個瀏覽器不支援長期保存設定。'],
    ] as const)('persistence %s copy', async (persistence, copy) => {
      const { dialog, tab } = await setup({ persistence, storageMode: 'persistent' })
      await tab('資料')
      expect(within(dialog).getByText(copy)).toBeInTheDocument()
    })

    it('shows the memory warning instead in memory mode', async () => {
      const { dialog, tab } = await setup({ persistence: 'granted', storageMode: 'memory' })
      await tab('資料')
      expect(within(dialog).getByText('目前的瀏覽器模式無法保存資料，關閉視窗後內容會消失。')).toBeInTheDocument()
      expect(within(dialog).queryByText('瀏覽器已同意長期保存這些資料。')).toBeNull()
    })
  })
})
