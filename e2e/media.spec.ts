import { expect, test } from '@playwright/test'

// 1x1 red PNG
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg=='

test('貼上圖片：顯示 img、可調整寬度，重新整理後仍在', async ({ page, browserName }) => {
  test.skip(browserName === 'webkit', 'Playwright WebKit cannot store Blobs in IndexedDB (environment limitation)')
  await page.goto('/')
  const editor = page.locator('.ProseMirror')
  await editor.click()
  await page.evaluate((b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
    const dt = new DataTransfer()
    dt.items.add(new File([bytes], 'red.png', { type: 'image/png' }))
    document.querySelector('.ProseMirror')!.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
  }, PNG_B64)
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
  const resized = (await img.boundingBox())!.width
  expect(resized).toBeGreaterThanOrEqual(80)
  expect(resized).toBeLessThan(400)
  await page.waitForTimeout(300)
  await img.click()
  await img.scrollIntoViewIfNeeded()
  await page.screenshot({ path: '.superpowers/sdd/2026-10-21-notes-v2-phase1/task-19-media.png' })

  await page.waitForTimeout(800)
  await page.reload()
  const again = page.locator('.ProseMirror img[alt="red.png"]')
  await expect(again).toBeVisible()
  expect(Math.abs((await again.boundingBox())!.width - resized)).toBeLessThan(2)
})
