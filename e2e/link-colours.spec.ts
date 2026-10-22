import { expect, test, type Locator } from '@playwright/test'

const SHOT = process.env.SHOTS // set to a directory to capture review screenshots

const color = (l: Locator) => l.evaluate((el) => getComputedStyle(el).color)
const after = (l: Locator) => l.evaluate((el) => getComputedStyle(el, '::after').content)

test('筆記連結、區塊連結、外部連結各有顏色；外部連結帶 ↗', async ({ page }, info) => {
  await page.goto('/')
  const editor = page.locator('.ProseMirror')
  await editor.click()
  await page.keyboard.type('[[顏色目標')
  await page.getByRole('option', { name: '建立新筆記「顏色目標」' }).click()

  // give the target a block, then link to that block via [[title#
  await editor.getByRole('link', { name: '前往 顏色目標' }).click()
  await expect(page.getByLabel('筆記標題')).toHaveValue('顏色目標')
  await editor.click()
  await page.keyboard.type('被連結的段落')
  await page.waitForTimeout(1500) // block index (~1 s debounce) feeds the [[title# list
  await page.getByRole('treeitem', { name: '歡迎使用' }).click()
  await editor.locator('p').first().click()
  await page.keyboard.press('End')
  await page.keyboard.type(' 區塊 [[顏色目標#被連結')
  await page.getByRole('option', { name: /被連結的段落/ }).click()
  await page.keyboard.type('外部 https://example.com ')

  const note = editor.locator('[data-note-link]:not([data-target-block])')
  const block = editor.locator('[data-note-link][data-target-block]')
  const external = editor.locator('a[href="https://example.com"]')
  await expect(note).toBeVisible()
  await expect(block).toBeVisible()
  await expect(external).toBeVisible()

  expect(await color(note)).toBe('rgb(0, 122, 255)')
  expect(await color(block)).toBe('rgb(175, 82, 222)')
  expect(await color(external)).toBe('rgb(14, 154, 167)')
  expect(await after(external)).toContain('↗')
  await expect(external).toHaveText('https://example.com') // the glyph is not text content

  if (SHOT && info.project.name === 'chromium') await page.screenshot({ path: `${SHOT}/link-colours.png` })

  // a link to a trashed note keeps the muted strike-through look
  await page.getByRole('treeitem', { name: '顏色目標' }).click({ button: 'right' })
  await page.getByRole('menuitem', { name: '移到垃圾桶' }).click()
  await page.getByRole('treeitem', { name: '歡迎使用' }).click()
  const deleted = editor.locator('[data-note-link][data-state="deleted-note"]').first()
  await expect(deleted).toBeVisible()
  expect(await color(deleted)).toBe('rgb(134, 134, 139)')
  expect(await deleted.evaluate((el) => getComputedStyle(el).textDecorationLine)).toContain('line-through')
})
