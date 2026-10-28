import { expect, test, type Page } from '@playwright/test'
import { newNote } from './helpers'

async function openData(page: Page) {
  await page.mouse.move(300, 450)
  await page.mouse.move(3, 450, { steps: 4 })
  await expect(page.getByRole('navigation', { name: '主要功能' })).toHaveAttribute('data-open', 'true')
  await page.getByRole('button', { name: '資料', exact: true }).click()
  return page.getByRole('dialog', { name: '資料' })
}

/** Text of a file in the origin-private file system (the stand-in for the picked folder), or null. */
const opfsText = (page: Page, path: string) =>
  page.evaluate(async (p) => {
    let dir = await navigator.storage.getDirectory()
    const parts = p.split('/')
    try {
      for (const part of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(part)
      return await (await (await dir.getFileHandle(parts.at(-1)!)).getFile()).text()
    } catch {
      return null
    }
  }, path)

test.describe('同步到資料夾', () => {
  test('Chrome / Edge：選資料夾後，停止輸入幾秒內寫成 .md；改名時舊檔移除', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'File System Access 只有 Chromium')
    test.setTimeout(60_000)
    await page.addInitScript(() => {
      ;(window as unknown as { showDirectoryPicker: () => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker = () => navigator.storage.getDirectory()
    })
    await page.goto('/')
    await expect(page.getByLabel('筆記標題')).toHaveValue('歡迎使用')
    const settings = await openData(page)
    await settings.getByRole('button', { name: '選擇資料夾' }).click()
    await expect(settings.getByRole('status').filter({ hasText: '已同步' })).toBeVisible()
    await page.keyboard.press('Escape')

    await newNote(page, '鏡像測試')
    await page.keyboard.type('第一行內容')
    // Spec: written within 3 s after typing stops. Read once at that point (reading OPFS while the app
    // writes the same file makes the write wait, so no tight polling here).
    await page.waitForTimeout(3000)
    expect(await opfsText(page, '鏡像測試.md')).toBe('第一行內容\n')

    await page.getByLabel('筆記標題').click()
    await page.keyboard.press('Control+A')
    await page.keyboard.type('改過的名字')
    await page.keyboard.press('Enter')
    await page.waitForTimeout(3000)
    expect(await opfsText(page, '改過的名字.md')).toBe('第一行內容\n')
    expect(await opfsText(page, '鏡像測試.md')).toBeNull()

    // A second tab waits instead of writing over the first.
    const other = await page.context().newPage()
    await other.goto('/')
    await expect(other.getByLabel('筆記標題')).toBeVisible()
    const s2 = await openData(other)
    await expect(s2.getByRole('status').filter({ hasText: '另一個分頁正在同步' })).toBeVisible()
  })

  test('Safari / Firefox：說明請改用匯出', async ({ page, browserName }) => {
    test.skip(browserName === 'chromium', '只有不支援的瀏覽器顯示')
    await page.goto('/')
    await expect(page.getByLabel('筆記標題')).toHaveValue('歡迎使用')
    const settings = await openData(page)
    await expect(settings.getByText('此瀏覽器無法自動同步到資料夾，請使用匯出。', { exact: false })).toBeVisible()
  })
})
