import { expect, test } from '@playwright/test'

test('點標籤打開該標籤的搜尋；Enter 也可以；不會選取或改動文字', async ({ page }) => {
  await page.goto('/')
  const editor = page.locator('.ProseMirror')
  await editor.click()
  await page.keyboard.type('預算 #採購 結尾')
  const pill = editor.getByRole('button', { name: '搜尋標籤 #採購' })
  await expect(pill).toBeVisible()
  const before = await editor.textContent()
  await page.waitForTimeout(1500) // the tag index is written ~1 s after typing (the switcher does not re-query while open)

  await pill.click()
  const dialog = page.getByRole('dialog', { name: '快速切換' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('combobox').or(dialog.getByLabel('搜尋筆記'))).toHaveValue('#採購')
  await expect(dialog.getByRole('option', { name: /歡迎使用/ })).toBeVisible() // the note carrying the tag
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  expect(await editor.textContent()).toBe(before)

  await pill.click({ modifiers: ['ControlOrMeta'] })
  await expect(dialog).toBeVisible()
  await page.keyboard.press('Escape')

  await pill.focus()
  await page.keyboard.press('Enter')
  await expect(dialog).toBeVisible()
  await page.keyboard.press('Escape')
  expect(await editor.textContent()).toBe(before)
})
