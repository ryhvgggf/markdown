import { expect, test } from '@playwright/test'

test('歡迎筆記：內文與標題重新整理後仍在', async ({ page }) => {
  await page.goto('/')
  const title = page.getByLabel('筆記標題')
  await expect(title).toHaveValue('歡迎使用')

  const editor = page.locator('.ProseMirror')
  await editor.click()
  await page.keyboard.type('第一行 hello')
  await page.keyboard.press('Enter')
  await page.keyboard.type('第二行 world')

  await title.fill('我的第一篇')
  await title.press('Enter')
  await expect(editor).toBeFocused()

  await page.waitForTimeout(800) // let persistence flush
  await page.reload()
  await expect(page.getByLabel('筆記標題')).toHaveValue('我的第一篇')
  await expect(page.locator('.ProseMirror')).toContainText('第一行 hello')
  await expect(page.locator('.ProseMirror')).toContainText('第二行 world')
})
