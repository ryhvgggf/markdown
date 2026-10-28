import { expect, test, type Page } from '@playwright/test'
import { item, newNote } from './helpers'

// Without a UTF-8 locale headless Chromium names CJK downloads "download" (this file checks the ZIP name).
test.use({ launchOptions: { env: { ...process.env, LANG: process.env.LANG || 'C.UTF-8' } } })

async function openData(page: Page) {
  await page.mouse.move(300, 450)
  await page.mouse.move(3, 450, { steps: 4 })
  await expect(page.getByRole('navigation', { name: '主要功能' })).toHaveAttribute('data-open', 'true')
  await page.getByRole('button', { name: '資料', exact: true }).click()
  return page.getByRole('dialog', { name: '資料' })
}

async function importZip(page: Page, path: string) {
  const settings = await openData(page)
  await settings.getByRole('button', { name: '匯入…' }).click()
  const dialog = page.getByRole('dialog', { name: '匯入' })
  const chooser = page.waitForEvent('filechooser')
  await dialog.getByRole('button', { name: '選擇 ZIP' }).click()
  await (await chooser).setFiles(path)
  return dialog
}

test('匯出 ZIP → 在另一個瀏覽器設定檔匯入 → 筆記與連結還原；再匯入一次要選覆蓋或副本', async ({ page, browser }, info) => {
  test.setTimeout(90_000) // two browser profiles, a full export and import
  await page.goto('/')
  await newNote(page, '目標筆記')
  await page.keyboard.type('目標的內容')
  await newNote(page, '來源筆記')
  await page.keyboard.type('參考 [[目標筆記')
  await page.getByRole('option', { name: '目標筆記' }).first().click()
  await expect(page.locator('.ProseMirror').getByRole('link', { name: '前往 目標筆記' })).toBeVisible()
  await page.waitForTimeout(1500) // let the edit reach storage

  const settings = await openData(page)
  const download = page.waitForEvent('download')
  await settings.getByRole('button', { name: '匯出 ZIP' }).click()
  const zipPath = info.outputPath('backup.zip')
  await (await download).saveAs(zipPath)
  expect((await download).suggestedFilename()).toMatch(/^我的知識庫-\d{4}-\d{2}-\d{2}\.zip$/)

  const other = await (await browser.newContext()).newPage()
  await other.goto('/')
  await expect(other.getByLabel('筆記標題')).toHaveValue('歡迎使用')
  const dialog = await importZip(other, zipPath)
  await expect(dialog.getByText(/將匯入 \d+ 篇筆記/)).toBeVisible()
  await dialog.getByRole('button', { name: '匯入' }).click()
  await expect(dialog.getByText(/已匯入 \d+ 篇筆記/)).toBeVisible()
  await dialog.getByRole('button', { name: '完成' }).click()
  await expect(other.getByRole('dialog')).toHaveCount(0)

  await other.mouse.move(900, 400) // away from the rail it was opened from
  await item(other, /^匯入 \d{4}-\d{2}-\d{2}$/).click()
  await item(other, '來源筆記').click()
  const link = other.locator('.ProseMirror').getByRole('link', { name: '前往 目標筆記' })
  await expect(link).toBeVisible()
  await link.click()
  await expect(other.getByLabel('筆記標題')).toHaveValue('目標筆記')
  await expect(other.locator('.ProseMirror')).toContainText('目標的內容')

  const again = await importZip(other, zipPath)
  await expect(again.getByText(/備份中有 \d+ 篇筆記已存在這個知識庫/)).toBeVisible()
  await expect(again.getByRole('button', { name: '匯入' })).toBeDisabled()
})

test('側欄「資料」：區段依序為匯出、匯入、同步到資料夾、從備份還原、維護（只有標題，沒有說明）', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByLabel('筆記標題')).toHaveValue('歡迎使用')
  const dialog = await openData(page)
  const headings = (await dialog.getByRole('heading', { level: 3 }).allTextContents()).filter((t) => t !== '儲存空間') // shown only when the browser may clear data
  expect(headings).toEqual(['匯出', '匯入', '同步到資料夾', '從備份還原', '維護'])
  await expect(dialog.getByText('Obsidian')).toHaveCount(0)
})
