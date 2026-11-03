import { expect, test } from '@playwright/test'
import { item, newNote } from './helpers'

// Links are kept in localStorage instead of Supabase under automation (src/app/e2e-share.ts), so a second page
// of the same context can open what the first page shared.
test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => localStorage.setItem('notes-v2:e2e-share', '1'))
})

async function share(page: import('@playwright/test').Page, title: string) {
  await item(page, title).click({ button: 'right' })
  await page.getByRole('menuitem', { name: '分享…' }).click()
  const dialog = page.getByRole('dialog', { name: '分享' })
  await dialog.getByRole('button', { name: '建立連結' }).click()
  const url = await dialog.getByLabel('分享連結').inputValue()
  return { dialog, url }
}

test('分享：建立連結、別人開得到唯讀內容、停止後失效', async ({ page, context }) => {
  await page.goto('/')
  await newNote(page, '分享測試')
  await page.keyboard.type('第一版內容')
  await expect(page.locator('.ProseMirror')).toContainText('第一版內容')

  const { dialog, url } = await share(page, '分享測試')
  expect(url).toMatch(/\/s\/[\w-]{22}#[\w-]{43}$/)

  const viewer = await context.newPage()
  await viewer.goto(url)
  await expect(viewer.getByRole('heading', { name: '分享測試' })).toBeVisible()
  const body = viewer.getByLabel('筆記內容')
  await expect(body).toContainText('第一版內容')
  await expect(body).toHaveAttribute('contenteditable', 'false')
  await expect(viewer.locator('meta[name="referrer"]')).toHaveAttribute('content', 'no-referrer')

  // a later edit does not show until the snapshot is updated
  await dialog.press('Escape')
  await page.locator('.ProseMirror').click()
  await page.keyboard.press('Control+End')
  await page.keyboard.type('，第二版')
  await viewer.reload()
  await expect(viewer.getByLabel('筆記內容')).not.toContainText('第二版')
  await item(page, '分享測試').click({ button: 'right' })
  await page.getByRole('menuitem', { name: '分享…' }).click()
  await page.getByRole('button', { name: '更新快照' }).click()
  await viewer.reload()
  await expect(viewer.getByLabel('筆記內容')).toContainText('第二版')

  await page.getByRole('button', { name: '停止分享' }).click()
  await page.getByRole('button', { name: '停止分享' }).last().click()
  await expect(page.getByRole('button', { name: '建立連結' })).toBeVisible()
  await viewer.reload()
  await expect(viewer.getByRole('alert')).toHaveText('連結無效或已停止分享')
})

test('永久刪除筆記時連結一併失效', async ({ page, context }) => {
  await page.goto('/')
  await newNote(page, '要刪除的筆記')
  await page.keyboard.type('內容')
  const { dialog, url } = await share(page, '要刪除的筆記')
  await dialog.press('Escape')

  const viewer = await context.newPage()
  await viewer.goto(url)
  await expect(viewer.getByLabel('筆記內容')).toContainText('內容')

  await item(page, '要刪除的筆記').click({ button: 'right' })
  await page.getByRole('menuitem', { name: '移到垃圾桶' }).click()
  await page.getByRole('button', { name: /垃圾桶/ }).click()
  const entry = page.getByRole('listitem').filter({ hasText: '要刪除的筆記' })
  await entry.getByRole('button', { name: '永久刪除' }).click()
  await entry.getByRole('button', { name: '刪除', exact: true }).click()
  await expect(async () => {
    await viewer.reload()
    await expect(viewer.getByRole('alert')).toHaveText('連結無效或已停止分享')
  }).toPass()
})

test('連結缺少金鑰時顯示無效', async ({ page }) => {
  await page.goto('/s/' + 'a'.repeat(22))
  await expect(page.getByRole('alert')).toHaveText('連結無效或已停止分享')
})
