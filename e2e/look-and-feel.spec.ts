import { expect, test, type Page } from '@playwright/test'

async function body(page: Page) {
  await page.goto('/')
  await expect(page.getByLabel('筆記標題')).toHaveValue('歡迎使用')
  const editor = page.locator('.ProseMirror')
  await editor.click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.press('Backspace')
  return editor
}

test('dividers have no drag grip; other blocks keep theirs', async ({ page }) => {
  const editor = await body(page)
  await page.keyboard.type('above\n---')
  await page.keyboard.type('below')
  const hr = editor.locator('hr')
  await expect(hr).toHaveCount(1)
  const grip = page.getByLabel('拖曳以移動，點擊開啟選單')
  await editor.locator('p', { hasText: 'above' }).hover()
  await expect(grip).toBeVisible()
  const box = (await hr.boundingBox())!
  await page.mouse.move(box.x + 40, box.y + box.height / 2, { steps: 4 })
  await expect(grip).toBeHidden()
  await editor.locator('p', { hasText: 'below' }).hover()
  await expect(grip).toBeVisible()
})

test('typing mode: the grip steps aside while typing and comes back on real pointer movement', async ({ page }) => {
  const editor = await body(page)
  await page.keyboard.type('first block')
  const block = editor.locator('p', { hasText: 'first block' })
  const b = (await block.boundingBox())!
  await page.mouse.move(b.x + 30, b.y + b.height / 2, { steps: 3 })
  const grip = page.getByLabel('拖曳以移動，點擊開啟選單')
  await expect(grip).toBeVisible()
  await page.keyboard.type(' more')
  await expect(grip).toBeHidden()
  await page.mouse.move(b.x + 31, b.y + b.height / 2 + 1) // jitter (≤ 2 px) does not end typing mode
  await page.waitForTimeout(150)
  await expect(grip).toBeHidden()
  await page.mouse.move(b.x + 60, b.y + b.height / 2, { steps: 3 })
  await expect(grip).toBeVisible()
})

test('long notes: selection, scrolling a far block into view and the grip still work', async ({ page }) => {
  const editor = await body(page)
  for (let i = 0; i < 80; i++) {
    await page.keyboard.insertText(`段落 ${i} 的內容。`)
    await page.keyboard.press('Enter')
  }
  await page.keyboard.insertText('段落 80 結尾')
  await page.keyboard.press('ControlOrMeta+Home')
  await page.keyboard.press('ControlOrMeta+Shift+End') // select across off-screen blocks
  expect(await page.evaluate(() => document.getSelection()?.toString().includes('段落 79'))).toBe(true)
  await expect(editor.locator('> p')).toHaveCount(81)
  await page.keyboard.press('ControlOrMeta+End')
  await page.keyboard.press('ControlOrMeta+Home')
  await expect(editor.locator('p', { hasText: '段落 0 的' })).toBeInViewport()
  await page.keyboard.press('ControlOrMeta+End')
  const last = editor.locator('p', { hasText: '段落 80 結尾' })
  await expect(last).toBeInViewport()
  const b = (await last.boundingBox())!
  await page.mouse.move(b.x + 20, b.y + b.height / 2, { steps: 4 })
  await expect(page.getByLabel('拖曳以移動，點擊開啟選單')).toBeVisible()
})

test('note switch fades the old page out and the new one in', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByLabel('筆記標題')).toHaveValue('歡迎使用')
  await page.getByRole('button', { name: '新增筆記' }).click()
  await page.keyboard.type('第二篇')
  await page.keyboard.press('Enter')
  await page.getByRole('treeitem', { name: '歡迎使用', exact: true }).click()
  await expect(page.locator('.note-ghost')).toHaveCount(1) // the old page, fading out (inert)
  await expect(page.locator('[data-note-page]')).toHaveAttribute('data-entering', 'true')
  await expect(page.locator('.note-ghost')).toHaveCount(0)
  await expect(page.locator('.ProseMirror')).toHaveCount(1)
})

test('tooltips close when the pointer leaves the trigger, even onto the tooltip', async ({ page }) => {
  await page.goto('/')
  const add = page.getByRole('button', { name: '新增筆記' })
  await add.hover()
  const tip = page.getByRole('tooltip')
  await expect(tip).toBeVisible()
  const t = (await tip.boundingBox())!
  await page.mouse.move(t.x + t.width / 2, t.y + t.height / 2, { steps: 3 })
  await expect(tip).toBeHidden()
})

test('screenshots', async ({ page }, info) => {
  test.skip(info.project.name !== 'chromium' || !process.env.SHOTS)
  const dir = process.env.SHOTS!
  await page.setViewportSize({ width: 1440, height: 900 })
  const editor = await body(page)
  await page.keyboard.type('# 採購流程\n這份筆記整理從申請到驗收的流程，選取這段文字看格式工具列。\n## 申請\n由需求單位建立請購單。\n## 核准\n依金額分級簽核。')
  // format toolbar with a submenu open
  await editor.locator('p', { hasText: '這份筆記' }).dblclick()
  const bar = page.getByRole('toolbar', { name: '文字格式' })
  await expect(bar).toBeVisible()
  await bar.getByRole('button', { name: '文字顏色' }).click()
  await expect(page.getByRole('menu')).toBeVisible()
  await page.waitForTimeout(400)
  await page.screenshot({ path: `${dir}/format-toolbar-submenu.png` })
  await page.keyboard.press('Escape')
  // slash menu
  await editor.locator('p', { hasText: '依金額' }).click()
  await page.keyboard.press('End')
  await page.keyboard.press('Enter')
  await page.keyboard.type('/')
  await expect(page.locator('[data-slash-menu]')).toBeVisible()
  await page.waitForTimeout(400)
  await page.screenshot({ path: `${dir}/slash-menu.png` })
  await page.keyboard.press('Escape')
  // rail with a tooltip
  await page.mouse.move(300, 450)
  await page.mouse.move(3, 450, { steps: 4 })
  const rail = page.getByRole('navigation', { name: '主要功能' })
  await expect(rail).toHaveAttribute('data-open', 'true')
  await rail.getByRole('button', { name: '搜尋' }).hover()
  await expect(page.getByRole('tooltip')).toBeVisible()
  await page.waitForTimeout(400)
  await page.screenshot({ path: `${dir}/rail-tooltip.png` })
  // a settings view
  await rail.getByRole('button', { name: '設定' }).click()
  await expect(page.getByRole('dialog', { name: '設定' })).toBeVisible()
  await page.waitForTimeout(500)
  await page.screenshot({ path: `${dir}/settings.png` })
})
