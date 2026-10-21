import { expect, test } from '@playwright/test'

test('ABAP 程式碼區塊：語法高亮與 Tab 縮排', async ({ page }) => {
  await page.goto('/')
  const editor = page.locator('.ProseMirror')
  await editor.click()
  await page.keyboard.press('Control+End')
  await page.keyboard.press('Enter')
  await page.keyboard.type('```abap ')
  await page.keyboard.type('* 取得採購單\nSELECT SINGLE * FROM ekko INTO @DATA(ls_ekko) WHERE ebeln = @lv_ebeln.')
  const code = editor.locator('.code-block')
  await expect(code.locator('.hljs-keyword').first()).toHaveText('SELECT')
  await expect(code.locator('.hljs-comment').first()).toContainText('取得採購單')
  await expect(code.getByLabel('程式語言')).toHaveValue('abap')
  await page.keyboard.press('Tab')
  await expect(code.locator('code')).toContainText('lv_ebeln.  ')
})
