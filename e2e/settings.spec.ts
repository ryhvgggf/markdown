import { expect, test, type Page } from '@playwright/test'

async function openSettings(page: Page) {
  await page.mouse.move(300, 450)
  await page.mouse.move(3, 450, { steps: 4 })
  await expect(page.getByRole('navigation', { name: '主要功能' })).toHaveAttribute('data-open', 'true')
  await page.getByRole('button', { name: '設定' }).click()
  const dialog = page.getByRole('dialog', { name: '設定' })
  await expect(dialog).toBeVisible()
  return dialog
}

test('設定：強調色與字級立即套用並在重新載入後保留', async ({ page }) => {
  await page.goto('/')
  const title = page.getByLabel('筆記標題')
  await expect(title).toHaveValue('歡迎使用')
  const editor = page.locator('.ProseMirror')
  await editor.click()
  await page.keyboard.press('Control+End')
  await page.keyboard.press('Enter')
  await page.keyboard.type('參考 [[採購流程')
  await page.getByRole('option', { name: '建立新筆記「採購流程」' }).click()
  const link = editor.getByRole('link', { name: '前往 採購流程' })
  await expect(link).toBeVisible()
  const linkEl = editor.locator('.note-link').first()
  const linkColor = () => linkEl.evaluate((el) => getComputedStyle(el).color)
  // accent-coloured UI (links have their own fixed colours since Task 25)
  await page.evaluate(() => {
    const probe = document.createElement('span')
    probe.id = 'accent-probe'
    probe.className = 'text-accent'
    document.body.appendChild(probe)
  })
  const accentColor = () => page.locator('#accent-probe').evaluate((el) => getComputedStyle(el).color)
  const before = await accentColor()

  const dialog = await openSettings(page)
  await dialog.getByRole('tab', { name: '色彩' }).click()
  await dialog.getByTitle('青').click()
  await expect.poll(() => page.evaluate(() => document.documentElement.style.getPropertyValue('--accent'))).toBe('#0B7A75')
  await expect.poll(accentColor).not.toBe(before)
  await expect.poll(accentColor).toBe('rgb(11, 122, 117)')
  expect(await linkColor()).toBe('rgb(0, 122, 255)') // note links keep systemBlue whatever the accent

  await dialog.getByRole('tab', { name: '文字' }).click()
  await dialog.getByRole('radiogroup', { name: '字級' }).getByText('大').click()
  await expect(editor).toHaveCSS('font-size', '18px')

  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(page.getByRole('button', { name: '設定' })).toBeFocused()

  await page.reload() // no wait: unsaved updates are stashed synchronously on pagehide
  await expect(page.locator('.ProseMirror')).toHaveCSS('font-size', '18px')
  expect(await page.evaluate(() => document.documentElement.style.getPropertyValue('--accent'))).toBe('#0B7A75')
})

test('screenshots', async ({ page }, info) => {
  test.skip(info.project.name !== 'chromium' || !process.env.SHOTS)
  const dir = process.env.SHOTS!
  await page.goto('/')
  await expect(page.getByLabel('筆記標題')).toHaveValue('歡迎使用')
  const dialog = await openSettings(page)
  await dialog.getByRole('tab', { name: '背景' }).click()
  await page.waitForTimeout(400)
  await page.screenshot({ path: `${dir}/task-23-background.png` })
  await dialog.getByRole('tab', { name: '色彩' }).click()
  await page.waitForTimeout(300)
  await page.screenshot({ path: `${dir}/task-23-color.png` })
})
