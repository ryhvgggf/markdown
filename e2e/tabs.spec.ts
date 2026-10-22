import { expect, test } from '@playwright/test'
import { item } from './helpers'

test('同一瀏覽器兩個分頁：輸入即時同步，新增筆記同步到側欄', async ({ context }) => {
  const a = await context.newPage()
  await a.goto('/')
  await expect(a.getByLabel('筆記標題')).toHaveValue('歡迎使用')
  const b = await context.newPage()
  await b.goto('/')
  await expect(b.getByLabel('筆記標題')).toHaveValue('歡迎使用')
  const edA = a.locator('.ProseMirror')
  const edB = b.locator('.ProseMirror')
  await expect(edB).toHaveAttribute('contenteditable', 'true')

  // text typed in A shows up in B within a second
  await edA.click()
  await a.keyboard.press('Control+End')
  await a.keyboard.press('Enter')
  const text = '跨分頁同步測試'
  const t0 = Date.now()
  await a.keyboard.type(text)
  await expect(edB).toContainText(text, { timeout: 3000 })
  expect(Date.now() - t0).toBeLessThan(1000 + 500 /* typing time itself */)

  // a note created in B appears in A's sidebar
  await b.getByRole('button', { name: '新增筆記' }).click()
  await expect(b.getByLabel('筆記標題')).toBeFocused()
  await b.keyboard.type('來自B的筆記')
  await b.keyboard.press('Enter')
  await expect(item(b, '來自B的筆記')).toBeVisible()
  await expect(item(a, '來自B的筆記')).toBeVisible({ timeout: 3000 })
})
