import { expect, test, type Page } from '@playwright/test'

async function pasteText(page: Page, text: string) {
  await page.evaluate((t) => {
    const dt = new DataTransfer()
    dt.setData('text/plain', t)
    document.querySelector('.ProseMirror')!.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
  }, text)
}

test('選取文字顯示格式列，粗體套用到選取', async ({ page }) => {
  await page.goto('/')
  const editor = page.locator('.ProseMirror')
  await editor.click()
  await page.keyboard.press('Control+End')
  await page.keyboard.press('Enter')
  await page.keyboard.type('hello world')
  await expect(page.getByRole('button', { name: '粗體' })).toBeHidden()
  await page.keyboard.press('Shift+Control+ArrowLeft')
  const bold = page.getByRole('button', { name: '粗體' })
  await expect(bold).toBeVisible()
  if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/task-16-toolbar.png` })
  await bold.click()
  await expect(editor.locator('strong')).toHaveText('world')
  await expect(page.getByRole('button', { name: '粗體' })).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: '文字顏色' }).click()
  await expect(page.getByRole('menuitem', { name: '紅' })).toBeVisible()
  if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/task-16-toolbar.png` })
  await page.getByRole('menuitem', { name: '紅' }).click()
  await expect(editor.locator('strong span, span strong').first()).toBeVisible()
})

test('貼上 Markdown 轉成標題與項目清單', async ({ page }) => {
  await page.goto('/')
  const editor = page.locator('.ProseMirror')
  await editor.click()
  await page.keyboard.press('Control+End')
  await page.keyboard.press('Enter')
  await pasteText(page, '# 貼上標題\n\n- a\n- b')
  await expect(editor.locator('h1', { hasText: '貼上標題' })).toBeVisible()
  await expect(editor.locator('ul li')).toHaveCount(2)
})
