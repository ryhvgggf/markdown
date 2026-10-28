import { expect, test } from '@playwright/test'
import { newNote } from './helpers'

test('標題按 ↓ 進入內文第一個區塊開頭；內文第一行按 ↑ 回到標題結尾', async ({ page }) => {
  await page.goto('/')
  const editor = page.locator('.ProseMirror')
  const title = page.getByLabel('筆記標題')
  await editor.click()
  await page.keyboard.type('first line')
  await page.keyboard.press('Enter')
  await page.keyboard.type('second line')
  await title.click()
  await page.keyboard.press('End')
  await page.keyboard.press('ArrowDown')
  await expect(editor).toBeFocused()
  await page.keyboard.type('X')
  await expect(editor.locator('p').first()).toHaveText('Xfirst line')
  await expect(editor.locator('p')).toHaveCount(2)

  await page.keyboard.press('ArrowUp')
  await expect(title).toBeFocused()
  await page.keyboard.type('!')
  await expect(title).toHaveValue('歡迎使用!')
})

test('標題正下方的 / 選單：↑↓ 只移動選單，Enter 插入所選項目', async ({ page }) => {
  await page.goto('/')
  const editor = page.locator('.ProseMirror')
  const title = page.getByLabel('筆記標題')
  await editor.click()
  await page.keyboard.type('/')
  const options = page.locator('[data-slash-menu] [role="option"]')
  await expect(options.first()).toHaveAttribute('aria-selected', 'true')
  await page.keyboard.press('ArrowUp')
  await expect(title).not.toBeFocused()
  await expect(options.last()).toHaveAttribute('aria-selected', 'true')
  await expect(options.last()).toContainText('分隔線') // the 區塊 tab ends with it
  await page.keyboard.press('Enter')
  await expect(editor.locator('hr')).toHaveCount(1)
  await expect(title).toHaveValue('歡迎使用')
})

test('標題正下方的 [[ 選單：↑ 不會跳進標題', async ({ page }) => {
  await page.goto('/')
  await newNote(page, '連結目標') // focus ends in the empty body, right below the title
  const title = page.getByLabel('筆記標題')
  await page.keyboard.type('[[')
  const options = page.locator('[data-link-menu] [role="option"]')
  await expect(options.first()).toBeVisible()
  await page.keyboard.press('ArrowUp')
  await expect(title).not.toBeFocused()
  await expect(options.last()).toHaveAttribute('aria-selected', 'true')
  await page.keyboard.press('Escape')
  await expect(options).toHaveCount(0)
  await expect(title).toHaveValue('連結目標')
})
