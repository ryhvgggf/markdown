import { expect, test, type Page } from '@playwright/test'

const SHOT = process.env.SHOTS // set to a directory to capture review screenshots

async function body(page: Page) {
  await page.goto('/')
  await expect(page.getByLabel('筆記標題')).toHaveValue('歡迎使用')
  const editor = page.locator('.ProseMirror')
  await editor.click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.press('Backspace')
  return editor
}

test('dividers have no drag grip; other blocks keep theirs', async ({ page }) => {
  const editor = await body(page)
  await page.keyboard.type('above\n---')
  await page.keyboard.type('below')
  const hr = editor.locator('hr')
  await expect(hr).toHaveCount(1)
  const grip = page.getByLabel('拖曳以移動，點擊開啟選單')
  await editor.locator('p', { hasText: 'above' }).hover()
  await expect(grip).toBeVisible()
  const box = (await hr.boundingBox())!
  await page.mouse.move(box.x + 40, box.y + box.height / 2, { steps: 4 })
  await expect(grip).toBeHidden()
  await editor.locator('p', { hasText: 'below' }).hover()
  await expect(grip).toBeVisible()
})
