import { expect, test, type ElementHandle, type Locator, type Page } from '@playwright/test'

const SHOT = process.env.SHOTS // set to a directory to capture review screenshots
const NEAR = 16

type Box = { x: number; y: number; width: number; height: number }

/** Gap between two rectangles on each axis (0 when they overlap on that axis). */
function gap(a: Box, b: Box) {
  return {
    dx: Math.max(0, a.x - (b.x + b.width), b.x - (a.x + a.width)),
    dy: Math.max(0, a.y - (b.y + b.height), b.y - (a.y + a.height)),
  }
}

/** The floating element opens next to its trigger and is still there 300 ms later. */
async function expectAnchored(page: Page, floating: Locator, trigger: ElementHandle) {
  await expect(floating).toBeVisible()
  for (const wait of [0, 300]) {
    await page.waitForTimeout(wait)
    const f = await floating.boundingBox()
    const t = await trigger.boundingBox()
    expect(f, 'floating element has a box').not.toBeNull()
    expect(t, 'trigger is still rendered').not.toBeNull()
    const g = gap(f!, t!)
    expect(g.dx, `horizontal gap after ${wait} ms (menu ${JSON.stringify(f)}, trigger ${JSON.stringify(t)})`).toBeLessThanOrEqual(NEAR)
    expect(g.dy, `vertical gap after ${wait} ms (menu ${JSON.stringify(f)}, trigger ${JSON.stringify(t)})`).toBeLessThanOrEqual(NEAR)
  }
}

async function selectWord(page: Page, text: string) {
  const editor = page.locator('.ProseMirror')
  await editor.click()
  await page.keyboard.press('Control+End')
  await page.keyboard.press('Enter')
  await page.keyboard.type(text)
  await page.keyboard.press('Shift+Control+ArrowLeft')
  await expect(page.getByRole('toolbar', { name: '文字格式' })).toBeVisible()
}

test('格式列的轉為／文字顏色／螢光標記選單貼著按鈕開啟且不跳動，並套用到原選取', async ({ page }, info) => {
  await page.goto('/')
  await selectWord(page, 'menu position check')
  const editor = page.locator('.ProseMirror')

  for (const name of ['文字顏色', '螢光標記', '轉為…']) {
    const trigger = page.getByRole('button', { name })
    const handle = (await trigger.elementHandle())!
    await trigger.click()
    await expectAnchored(page, page.getByRole('menu'), handle)
    if (SHOT && info.project.name === 'chromium') {
      const file = name === '轉為…' ? 'convert-menu' : name === '螢光標記' ? 'highlight-menu' : 'color-menu'
      await page.screenshot({ path: `${SHOT}/${file}.png` })
    }
    if (name !== '轉為…') {
      await page.keyboard.press('Escape')
      await expect(page.getByRole('menu')).toBeHidden()
      await editor.locator('p', { hasText: 'menu position check' }).click()
      await page.keyboard.press('End')
      await page.keyboard.press('Shift+Control+ArrowLeft')
      await expect(page.getByRole('toolbar', { name: '文字格式' })).toBeVisible()
    }
  }
  // the item applies to the selection the toolbar was opened for
  await page.getByRole('menuitem', { name: '標題 2' }).click()
  await expect(editor.locator('h2', { hasText: 'menu position check' })).toBeVisible()
})

test('螢光標記顏色套用到原選取', async ({ page }) => {
  await page.goto('/')
  await selectWord(page, 'highlight me')
  await page.getByRole('button', { name: '螢光標記' }).click()
  await page.getByRole('menu').getByRole('menuitem').first().click()
  await expect(page.locator('.ProseMirror mark')).toHaveText('me')
})

test('拖曳把手選單與「轉換類型」子選單貼著觸發點', async ({ page }) => {
  await page.goto('/')
  const editor = page.locator('.ProseMirror')
  await editor.click()
  await page.keyboard.press('Control+End')
  await page.keyboard.press('Enter')
  await page.keyboard.type('grip menu block')
  await editor.locator('p', { hasText: 'grip menu block' }).hover()
  const grip = page.getByLabel('拖曳以移動，點擊開啟選單')
  const gripHandle = (await grip.elementHandle())!
  await grip.click()
  await expectAnchored(page, page.getByRole('menu').first(), gripHandle)
  const sub = page.getByRole('menuitem', { name: '轉換類型' })
  const subHandle = (await sub.elementHandle())!
  await sub.hover()
  await expect(page.getByRole('menu')).toHaveCount(2)
  await expectAnchored(page, page.getByRole('menu').nth(1), subHandle)
})

test('Slash 與 [[ 建議選單貼著游標', async ({ page }) => {
  await page.goto('/')
  const editor = page.locator('.ProseMirror')
  await editor.click()
  await page.keyboard.press('Control+End')
  await page.keyboard.press('Enter')
  await page.keyboard.type('/')
  await expectAnchored(page, page.locator('[data-slash-menu]'), (await editor.locator('.suggestion').elementHandle())!)
  await page.keyboard.press('Escape')
  await page.keyboard.press('Backspace')
  await page.keyboard.type('[[')
  await expectAnchored(page, page.locator('[data-link-menu]'), (await editor.locator('.suggestion').elementHandle())!)
})

test('側欄右鍵選單貼著該列', async ({ page }) => {
  await page.goto('/')
  const row = page.getByRole('treeitem').first()
  const handle = (await row.elementHandle())!
  await row.click({ button: 'right' })
  await expectAnchored(page, page.getByRole('menu'), handle)
})
