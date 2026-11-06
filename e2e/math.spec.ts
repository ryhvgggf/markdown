import { expect, test } from '@playwright/test'

test('公式：$x$ 變成行內公式、$$ 變成區塊公式，點一下可以改', async ({ page }) => {
  await page.goto('/')
  const editor = page.locator('.ProseMirror')
  await editor.click()
  await page.keyboard.press('Control+End')
  await page.keyboard.press('Enter')
  await page.keyboard.type('質能 $E=mc^2$ 式')
  const inline = editor.locator('.math-inline')
  await expect(inline.locator('.katex')).toBeVisible()
  await expect(editor).toContainText('式')

  await page.keyboard.press('Enter')
  await page.keyboard.type('$$')
  const area = editor.locator('.math-block textarea')
  await expect(area).toBeFocused()
  await page.keyboard.type('\\frac{1}{2}')
  await expect(editor.locator('.math-block .math-preview .katex')).toBeVisible()
  await page.keyboard.press('Control+Enter')
  await expect(editor.locator('.math-block .katex-display')).toBeVisible()

  // A real click in the middle of the formula (KaTeX's struts confuse Playwright's own hit check).
  const box = (await inline.locator('.math-render').boundingBox())!
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  const input = inline.locator('input')
  await expect(input).toHaveValue('E=mc^2')
  await input.fill('a+b')
  await page.keyboard.press('Enter')
  await expect(inline.locator('.katex')).toContainText('a')
  await expect(inline.locator('input')).toHaveCount(0)
})
