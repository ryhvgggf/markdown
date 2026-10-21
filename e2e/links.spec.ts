import { expect, test, type Page } from '@playwright/test'

const SHOT = '/home/claude/markdown/.superpowers/sdd/2026-10-21-notes-v2-phase1'

/** Dispatches a paste carrying only text/plain at the editor's caret (works in every engine). */
async function pastePlain(page: Page, text: string) {
  await page.locator('.ProseMirror').evaluate((el, t) => {
    const ev = new Event('paste', { bubbles: true, cancelable: true })
    Object.defineProperty(ev, 'clipboardData', {
      value: { getData: (type: string) => (type === 'text/plain' ? t : ''), types: ['text/plain'], files: [], items: [] },
    })
    el.dispatchEvent(ev)
  }, text)
}

test('筆記連結、區塊連結與標籤', async ({ page, context }, info) => {
  const chromium = info.project.name === 'chromium'
  if (chromium) await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.goto('/')
  const title = page.getByLabel('筆記標題')
  await expect(title).toHaveValue('歡迎使用')
  const editor = page.locator('.ProseMirror')
  await editor.click()
  await page.keyboard.press('Control+End')
  await page.keyboard.press('Enter')

  // [[ → 建立新筆記 creates the target note and links it (no navigation)
  await page.keyboard.type('參考 [[採購流程')
  const create = page.getByRole('option', { name: '建立新筆記「採購流程」' })
  await expect(create).toBeVisible()
  await page.keyboard.press('Enter')
  const noteLink = editor.getByRole('link', { name: '前往 採購流程' })
  await expect(noteLink).toBeVisible()
  await expect(title).toHaveValue('歡迎使用')
  const targetId = await editor.locator('[data-note-link]').first().getAttribute('data-note-id')
  expect(targetId).toBeTruthy()

  // open the target note through its link and write a block, plus a link back
  await noteLink.click()
  await expect(title).toHaveValue('採購流程')
  await editor.click()
  await page.keyboard.type('核准層級依金額決定')
  await page.keyboard.press('Enter')
  await page.keyboard.type('回到 [[歡迎')
  await expect(page.getByRole('option', { name: /歡迎使用/ })).toBeVisible()
  await page.keyboard.press('Enter')
  const block = editor.locator('p', { hasText: '核准層級依金額決定' })
  const blockId = await block.getAttribute('data-block-id')
  expect(blockId).toBeTruthy()
  const token = `[[note:${targetId}#${blockId}]]`

  // grip → 複製區塊連結
  await block.hover()
  await page.getByLabel('拖曳以移動，點擊開啟選單').click()
  await page.getByRole('menuitem', { name: '複製區塊連結' }).click()
  await expect(page.getByRole('menuitem', { name: '複製區塊連結' })).toHaveText('已複製')
  if (chromium) expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(token)
  await expect(page.getByRole('menu')).toBeHidden()

  // back to the first note, paste the block link and add a tag
  await editor.getByRole('link', { name: '前往 歡迎使用' }).click()
  await expect(title).toHaveValue('歡迎使用')
  await editor.locator('p', { hasText: '參考' }).click()
  await page.keyboard.press('End')
  await page.keyboard.type('與 ')
  await pastePlain(page, token)
  const blockLink = editor.getByRole('link', { name: '前往 採購流程 › 核准層級依金額決定' })
  await expect(blockLink).toBeVisible({ timeout: 5000 }) // block text comes from the index (~1 s lag)
  await page.keyboard.type(' #採購 ')
  await expect(editor.locator('[data-tag="採購"]')).toHaveText('#採購')
  await expect(editor).not.toContainText('[[note:')

  if (chromium) {
    await page.keyboard.type('[[採')
    await expect(page.getByRole('listbox')).toBeVisible()
    await page.screenshot({ path: `${SHOT}/task-18-links.png` })
    await page.keyboard.press('Escape')
  }

  // clicking the block link opens the note and flashes the block
  await blockLink.click()
  await expect(title).toHaveValue('採購流程')
  const target = editor.locator(`[data-block-id="${blockId}"]`)
  await expect(target).toHaveAttribute('data-highlight', 'true')
  await expect(target).toBeInViewport()
  await expect(target).not.toHaveAttribute('data-highlight', 'true', { timeout: 3000 })
})
