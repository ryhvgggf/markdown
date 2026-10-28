import { test, expect } from '@playwright/test'
import { newNote } from './helpers'
test('連結：右鍵（或游標貼著連結按 F2）改名；點連結仍開啟筆記', async ({ page, browserName }) => {
  await page.goto('/')
  await newNote(page, '目標筆記')
  await page.keyboard.type('內容')
  await newNote(page, '來源')
  await page.keyboard.type('見 [[目標')
  await page.keyboard.press('Enter')
  await page.keyboard.press('Enter')
  const editor = page.locator('.ProseMirror')
  const link = editor.getByRole('link', { name: '前往 目標筆記' })
  await expect(link).toBeVisible()
  await link.click({ button: 'right' })
  const input = page.getByLabel('連結名稱')
  await expect(input).toBeFocused()
  await input.fill('這個很重要')
  await input.press('Enter')
  const renamed = editor.getByRole('link', { name: '前往 這個很重要' })
  await expect(renamed).toBeVisible()
  if (browserName === 'chromium') {
    // Caret next to the link (the arrow keys land differently in WebKit): F2 opens the same box.
    await page.keyboard.type('x')
    for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowLeft')
    await page.keyboard.press('F2')
    await expect(page.getByLabel('連結名稱')).toBeFocused()
    await expect(page.getByLabel('連結名稱')).toHaveValue('這個很重要')
    await page.keyboard.press('Escape')
  }
  await renamed.click()
  await expect(page.getByLabel('筆記標題')).toHaveValue('目標筆記')
})
