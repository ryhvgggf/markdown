import { expect, test, type Page } from '@playwright/test'

// 1x1 red PNG
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg=='

async function pastePng(page: Page, name: string) {
  await page.evaluate(
    ({ b64, name }) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
      const dt = new DataTransfer()
      dt.items.add(new File([bytes], name, { type: 'image/png' }))
      document.querySelector('.ProseMirror')!.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
    },
    { b64: PNG_B64, name },
  )
}

/** Slash item -> hidden file input -> file chooser (WebKit ignores clipboardData on synthetic paste events). */
async function pickPng(page: Page, name: string) {
  await page.keyboard.press('Control+End')
  await page.keyboard.press('Enter')
  await page.keyboard.type('/')
  await expect(page.getByRole('listbox')).toBeVisible()
  await page.keyboard.type('圖片')
  await expect(page.getByRole('option')).toHaveCount(1)
  const chooser = page.waitForEvent('filechooser')
  await page.keyboard.press('Enter')
  await (await chooser).setFiles({ name, mimeType: 'image/png', buffer: Buffer.from(PNG_B64, 'base64') })
}

test('加入圖片：顯示 img、可調整寬度，重新整理後仍在', async ({ page, browserName }) => {
  await page.goto('/')
  const editor = page.locator('.ProseMirror')
  await editor.click()
  if (browserName === 'webkit') await pickPng(page, 'red.png')
  else await pastePng(page, 'red.png')
  const img = editor.locator('img[alt="red.png"]')
  await expect(img).toBeVisible()

  await img.click()
  const handle = page.getByRole('slider', { name: '調整圖片寬度' })
  await expect(handle).toBeVisible()
  await handle.scrollIntoViewIfNeeded()
  const box = (await handle.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x - 400, box.y + box.height / 2, { steps: 5 })
  await page.mouse.up()
  await expect.poll(async () => (await img.boundingBox())!.width).toBeLessThan(400)
  const resized = (await img.boundingBox())!.width
  expect(resized).toBeGreaterThanOrEqual(80)

  if (process.env.MEDIA_SHOT) {
    await img.click()
    await page.screenshot({ path: process.env.MEDIA_SHOT })
  }

  // Persistence is asynchronous: reload until the image and its width survive.
  await expect(async () => {
    await page.reload()
    const again = page.locator('.ProseMirror img[alt="red.png"]')
    await expect(again).toBeVisible({ timeout: 2000 })
    expect(Math.abs((await again.boundingBox())!.width - resized)).toBeLessThan(2)
  }).toPass({ timeout: 15000 })
})
