import { expect, test, type Page } from '@playwright/test'

const SHOT = process.env.SHOTS // set to a directory to capture review screenshots

async function insertTable(page: Page) {
  await page.goto('/')
  const editor = page.locator('.ProseMirror')
  await editor.click()
  await page.keyboard.type('/表格')
  await page.keyboard.press('Enter')
  await expect(editor.locator('table')).toHaveCount(1)
  return editor
}
const shape = (page: Page) =>
  page.locator('.ProseMirror table').evaluate((t: HTMLTableElement) => ({ rows: t.rows.length, cols: t.rows[0]?.cells.length ?? 0 }))

test('表格操作選單：插入／刪除列與欄、刪除表格；選單貼著按鈕，游標留在儲存格', async ({ page }, info) => {
  const editor = await insertTable(page)
  expect(await shape(page)).toEqual({ rows: 3, cols: 3 })
  await page.keyboard.type('A1')
  const button = page.getByRole('button', { name: '表格操作' })
  await expect(button).toBeVisible()
  // the button sits in the caret's cell
  const cell = editor.locator('th', { hasText: 'A1' })
  const [b, c] = [await button.boundingBox(), await cell.boundingBox()]
  expect(b!.x).toBeGreaterThanOrEqual(c!.x)
  expect(b!.x + b!.width).toBeLessThanOrEqual(c!.x + c!.width + 1)
  expect(b!.y).toBeGreaterThanOrEqual(c!.y - 1)

  const handle = (await button.elementHandle())!
  await button.click()
  const menu = page.getByRole('menu')
  await expect(menu).toBeVisible()
  for (const wait of [0, 300]) {
    await page.waitForTimeout(wait)
    const [m, t] = [await menu.boundingBox(), await handle.boundingBox()]
    expect(t, 'trigger still rendered').not.toBeNull()
    expect(Math.max(0, m!.y - (t!.y + t!.height), t!.y - (m!.y + m!.height))).toBeLessThanOrEqual(16)
    expect(Math.max(0, m!.x - (t!.x + t!.width), t!.x - (m!.x + m!.width))).toBeLessThanOrEqual(16)
  }
  if (SHOT && info.project.name === 'chromium') await page.screenshot({ path: `${SHOT}/table-menu.png` })

  await page.getByRole('menuitem', { name: '下方插入列' }).click()
  expect(await shape(page)).toEqual({ rows: 4, cols: 3 })
  await page.keyboard.type('!') // the caret is still in the cell
  await expect(cell).toHaveText('A1!')

  const run = async (label: string) => {
    await button.click()
    await page.getByRole('menuitem', { name: label }).click()
  }
  await run('右側插入欄')
  expect(await shape(page)).toEqual({ rows: 4, cols: 4 })
  await run('左側插入欄')
  expect(await shape(page)).toEqual({ rows: 4, cols: 5 })
  await run('上方插入列')
  expect(await shape(page)).toEqual({ rows: 5, cols: 5 })
  await run('刪除列')
  expect(await shape(page)).toEqual({ rows: 4, cols: 5 })
  await run('刪除欄')
  expect(await shape(page)).toEqual({ rows: 4, cols: 4 })
  await expect(editor.locator('th', { hasText: 'A1!' })).toHaveCount(0) // the caret's column was removed

  // the structure is stored: a reload keeps it
  await page.waitForTimeout(300)
  await page.reload()
  await expect(page.locator('.ProseMirror table')).toHaveCount(1)
  expect(await shape(page)).toEqual({ rows: 4, cols: 4 })

  await page.locator('.ProseMirror td').first().click()
  await run('刪除表格')
  await expect(page.locator('.ProseMirror table')).toHaveCount(0)
})

test('最後一格按 Tab 新增一列；結構變更即時同步到另一個分頁', async ({ page, context }) => {
  const editor = await insertTable(page)
  const other = await context.newPage()
  await other.goto('/')
  await expect(other.locator('.ProseMirror table')).toHaveCount(1)
  await editor.locator('td').last().click()
  await page.keyboard.type('last')
  await expect(editor.locator('td').last()).toHaveText('last') // the editor has the caret in the last cell
  await page.keyboard.press('Tab')
  await expect.poll(() => shape(page)).toEqual({ rows: 4, cols: 3 })
  await page.keyboard.type('new row')
  await expect(editor.locator('tr').last()).toContainText('new row')
  await expect.poll(() => other.locator('.ProseMirror table tr').count()).toBe(4)
  await expect(other.locator('.ProseMirror tr').last()).toContainText('new row')
})

test('拖曳欄的邊線調整欄寬', async ({ page }, info) => {
  const editor = await insertTable(page)
  const first = editor.locator('th').first()
  const box = (await first.boundingBox())!
  const edgeX = box.x + box.width + 1 // on the border between the first two columns
  await page.mouse.move(edgeX, box.y + box.height - 8)
  await expect(editor.locator('.column-resize-handle').first()).toBeVisible() // drawn down the whole column
  if (SHOT && info.project.name === 'chromium') await page.screenshot({ path: `${SHOT}/table-resize-handle.png` })
  await page.mouse.down()
  await page.mouse.move(edgeX + 80, box.y + box.height - 8, { steps: 6 })
  await page.mouse.up()
  const after = (await first.boundingBox())!
  expect(after.width).toBeGreaterThan(box.width + 40)
  await expect(first).toHaveAttribute('colwidth', /\d+/)
})
