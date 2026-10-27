import { expect, test, type Page } from '@playwright/test'

const SHOT = process.env.SHOTS // set to a directory to capture review screenshots
const tree = (page: Page, name: string) => page.getByRole('treeitem', { name })

test('反向連結：浮動面板、已連結卡片、提到但未連結、轉為連結、釘選', async ({ page }, testInfo) => {
  await page.goto('/')
  const title = page.getByLabel('筆記標題')
  await expect(title).toHaveValue('歡迎使用')
  const editor = page.locator('.ProseMirror')
  const pill = page.getByRole('button', { name: /^反向連結/ })
  await expect(pill).toHaveCount(0) // nothing links here or mentions it yet
  await editor.click()
  await page.keyboard.press('Control+End')
  await page.keyboard.press('Enter')
  await page.keyboard.type('參考 [[採購流程')
  await page.getByRole('option', { name: '建立新筆記「採購流程」' }).click()
  await expect(editor.getByRole('link', { name: '前往 採購流程' })).toBeVisible()

  // note C mentions the title as plain text
  await page.getByRole('button', { name: '新增筆記' }).click()
  await expect(title).toBeFocused()
  await page.keyboard.type('筆記C')
  await page.keyboard.press('Enter')
  await page.keyboard.type('我們依採購流程處理請購')
  await expect(tree(page, '筆記C')).toBeVisible()

  // open the target: the pill summons the floating panel; the note card does not move or resize
  await tree(page, '採購流程').click()
  await expect(title).toHaveValue('採購流程')
  await expect(pill).toContainText('1', { timeout: 8000 })
  const card = await page.getByRole('main').boundingBox()
  await pill.click()
  const panel = page.getByRole('complementary', { name: '反向連結面板' })
  await expect(panel).toBeVisible()
  expect(await page.getByRole('main').boundingBox()).toEqual(card)
  const linked = panel.getByRole('button', { name: /歡迎使用/ })
  await expect(linked).toBeVisible()
  const convert = panel.getByRole('button', { name: '轉為連結' })
  await expect(convert).toBeVisible({ timeout: 8000 })
  await expect(panel.getByText('筆記C')).toBeVisible()
  if (SHOT && testInfo.project.name === 'chromium') await page.screenshot({ path: `${SHOT}/backlinks-panel.png` })

  await convert.click()
  await expect(convert).toBeHidden()
  await expect(panel.getByRole('button', { name: /筆記C/ })).toBeVisible({ timeout: 8000 })
  await expect(pill).toContainText('2')

  // pointer leaves the panel → it closes after a moment (not pinned)
  await panel.hover()
  await page.mouse.move(300, 500, { steps: 4 })
  await expect(panel).toBeHidden()

  // pinned: stays open when the pointer leaves and across a note switch, with the new note's content
  await pill.click()
  await panel.getByRole('button', { name: '釘選面板' }).click()
  await expect(panel.getByRole('button', { name: '釘選面板' })).toHaveAttribute('aria-pressed', 'true')
  await page.mouse.move(300, 500, { steps: 4 })
  await page.waitForTimeout(700)
  await expect(panel).toBeVisible()
  await tree(page, '歡迎使用').click()
  await expect(title).toHaveValue('歡迎使用')
  await expect(panel).toBeVisible()
  await expect(panel.getByRole('button', { name: /^歡迎使用/ })).toHaveCount(0)

  // a card opens its source; Esc closes the panel (and unpins it)
  await tree(page, '採購流程').click()
  await panel.getByRole('button', { name: /歡迎使用/ }).click()
  await expect(title).toHaveValue('歡迎使用')
  await panel.getByRole('heading', { name: '反向連結' }).click()
  await page.keyboard.press('Escape')
  await expect(panel).toBeHidden()

  // unpinned: switching notes closes it
  await tree(page, '採購流程').click()
  await expect(title).toHaveValue('採購流程')
  await pill.click()
  await expect(panel).toBeVisible()
  await tree(page, '筆記C').click()
  await expect(panel).toBeHidden()

  // keyboard: Enter on the pill moves focus into the panel; Esc returns it to the pill
  await tree(page, '採購流程').click()
  await pill.focus()
  await page.keyboard.press('Enter')
  await expect(panel).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(panel).toBeHidden()
  await expect(pill).toBeFocused()
})

test('大綱：右緣刻度、懸停卡片、點擊跳轉、打字時讓開', async ({ page }, testInfo) => {
  await page.goto('/')
  const title = page.getByLabel('筆記標題')
  await expect(title).toHaveValue('歡迎使用')
  const editor = page.locator('.ProseMirror')
  await editor.click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.press('Backspace')
  const ticks = page.getByRole('button', { name: '大綱' })
  await expect(ticks).toHaveCount(0) // no headings → no ticks
  await page.keyboard.type('# 概觀\n')
  for (let i = 0; i < 12; i++) await page.keyboard.type(`說明第 ${i} 行，讓筆記長到可以捲動。\n`)
  await page.keyboard.type('## 申請\n')
  for (let i = 0; i < 12; i++) await page.keyboard.type(`申請步驟 ${i}\n`)
  await page.keyboard.type('### 核准\n層級')
  await expect(ticks.locator('.outline-tick')).toHaveCount(4) // title + 3 headings
  // typing mode: the ticks step aside until the pointer really moves
  await expect(page.locator('.outline-layer')).toHaveAttribute('data-typing', 'true')
  const tb = (await ticks.boundingBox())!
  await page.mouse.move(tb.x - 80, tb.y + tb.height / 2)
  await page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2, { steps: 5 })
  const card = page.getByRole('navigation', { name: '大綱' })
  await expect(card).toBeVisible()
  await expect(card.getByRole('button')).toHaveText(['歡迎使用', '概觀', '申請', '核准'])
  if (SHOT && testInfo.project.name === 'chromium') await page.screenshot({ path: `${SHOT}/outline-ticks-card.png` })
  await card.getByRole('button', { name: '概觀' }).click()
  await expect(editor.locator('h1', { hasText: '概觀' })).toBeInViewport()
  await expect(card).toBeHidden()
  await page.keyboard.type('X') // the caret moved into the heading
  await expect(editor.locator('h1')).toContainText('X')
  // the card hides once the pointer has left both the ticks and the card
  await page.mouse.move(tb.x - 80, tb.y + tb.height / 2, { steps: 3 })
  await page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2, { steps: 5 })
  await expect(card).toBeVisible()
  await page.mouse.move(200, 300, { steps: 4 })
  await expect(card).toBeHidden()
  // keyboard: the ticks button opens the card; Esc closes it and focus returns
  await ticks.focus()
  await page.keyboard.press('Enter')
  await expect(card).toBeVisible()
  await expect(card.locator('button[aria-current="location"]')).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(card).toBeHidden()
  await expect(ticks).toBeFocused()
})
