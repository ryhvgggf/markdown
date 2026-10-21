import { expect, test } from '@playwright/test'

test('待辦項目：鍵盤輸入 123 順序正確，勾選後顯示刪除線', async ({ page }) => {
  await page.goto('/')
  const editor = page.locator('.ProseMirror')
  await editor.click()
  await page.keyboard.press('Control+End')
  await page.keyboard.press('Enter')
  await page.keyboard.type('[] ')
  await page.keyboard.type('123')

  const item = editor.locator('li[data-type="taskItem"]').first()
  await expect(item).toContainText('123')
  await expect(item.locator('.task-content')).toHaveText('123')

  const box = item.getByRole('checkbox', { name: '完成' })
  await expect(box).not.toBeChecked()
  await box.check()
  await expect(item).toHaveAttribute('data-checked', 'true')
  await expect(item.locator('.task-content p')).toHaveCSS('text-decoration-line', 'line-through')

  await page.keyboard.type('4')
  await expect(item.locator('.task-content')).toHaveText('1234')
})

test('多層有序清單依深度顯示 1. a. i.', async ({ page }) => {
  await page.goto('/')
  const editor = page.locator('.ProseMirror')
  await editor.click()
  await page.keyboard.press('Control+End')
  await page.keyboard.press('Enter')
  await page.keyboard.type('1. one')
  await page.keyboard.press('Enter')
  await page.keyboard.press('Tab')
  await page.keyboard.type('two')
  await page.keyboard.press('Enter')
  await page.keyboard.press('Tab')
  await page.keyboard.type('three')
  const styles = await editor.locator('ol').evaluateAll((els) => els.map((e) => e.getAttribute('data-list-style')))
  expect(styles).toEqual(['decimal', 'alpha', 'roman'])
})
