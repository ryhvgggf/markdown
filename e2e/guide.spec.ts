import { expect, test } from '@playwright/test'

const SHOT = process.env.SHOTS // set to a directory to capture review screenshots

test.use({ storageState: { cookies: [], origins: [] } }) // a real first start: the guide is seeded

test('第一次開啟：建立「功能導覽」資料夾並打開歡迎使用', async ({ page }, info) => {
  await page.goto('/')
  await expect(page.getByLabel('筆記標題')).toHaveValue('歡迎使用')
  await expect(page.getByRole('treeitem', { name: '功能導覽' })).toBeVisible()
  for (const title of ['編輯與格式', '區塊與 / 選單', '連結、標籤與反向連結', '圖片與附件', '整理筆記', '搜尋與快速切換', '外觀設定']) {
    await expect(page.getByRole('treeitem', { name: title, exact: true })).toBeVisible()
  }
  const editor = page.locator('.ProseMirror')
  await expect(editor).toContainText('本機優先')
  await expect(editor.getByRole('link', { name: '前往 編輯與格式' })).toBeVisible()
  await expect(editor.locator('[data-note-link][data-state="deleted-note"]')).toHaveCount(0)
  if (SHOT && info.project.name === 'chromium') await page.screenshot({ path: `${SHOT}/guide-welcome.png` })

  // links work, block links resolve to their block text, the demo image loads
  await editor.getByRole('link', { name: '前往 連結、標籤與反向連結' }).click()
  await expect(page.getByLabel('筆記標題')).toHaveValue('連結、標籤與反向連結')
  await expect(editor.locator('[data-note-link][data-target-block]').first()).toBeVisible()
  await expect(editor.locator('[data-note-link][data-state="deleted-note"], [data-note-link][data-state="deleted-block"]')).toHaveCount(0)
  if (SHOT && info.project.name === 'chromium') await page.screenshot({ path: `${SHOT}/guide-links.png` })
  await page.getByRole('treeitem', { name: '圖片與附件' }).click()
  const img = editor.getByRole('img', { name: '範例圖片.png' })
  await expect(img).toBeVisible()
  await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBe(192)

  // 整理筆記 mentions 搜尋與快速切換 in plain text → 提到但未連結 on that note
  await page.getByRole('treeitem', { name: '搜尋與快速切換' }).click()
  await page.getByRole('button', { name: /^反向連結/ }).click()
  await expect(page.getByRole('heading', { name: '提到但未連結' })).toBeVisible()
  await expect(page.getByRole('button', { name: '轉為連結' }).first()).toBeVisible()

  // a reload does not seed a second copy
  await page.reload()
  await expect(page.getByLabel('筆記標題')).toBeVisible()
  await expect(page.getByRole('treeitem', { name: /^功能導覽/ })).toHaveCount(1)
})
