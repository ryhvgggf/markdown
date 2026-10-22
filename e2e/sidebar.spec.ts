import { expect, test, type Page } from '@playwright/test'

const item = (page: Page, name: string | RegExp) => page.getByRole('treeitem', { name, exact: typeof name === 'string' })
const levels = async (page: Page) =>
  page.getByRole('treeitem').evaluateAll((els) => els.map((e) => `${e.getAttribute('aria-level')}:${e.getAttribute('aria-label')}`))

async function drag(page: Page, from: string, to: string, at: 'top' | 'middle' | 'bottom') {
  const a = (await item(page, from).boundingBox())!
  const b = (await item(page, to).boundingBox())!
  const y = b.y + b.height * (at === 'top' ? 0.1 : at === 'bottom' ? 0.9 : 0.5)
  await page.mouse.move(a.x + 40, a.y + a.height / 2)
  await page.mouse.down()
  await page.mouse.move(a.x + 40, a.y + a.height / 2 + 10, { steps: 3 })
  await page.mouse.move(b.x + 40, y, { steps: 12 })
  await page.mouse.up()
}

async function newNote(page: Page, title: string) {
  await page.getByRole('button', { name: '新增筆記' }).click()
  const t = page.getByLabel('筆記標題')
  await expect(t).toBeFocused()
  await page.keyboard.type(title)
  await page.keyboard.press('Enter')
  await expect(item(page, title)).toBeVisible()
}

async function newFolder(page: Page, name: string) {
  await page.getByRole('button', { name: '新增資料夾' }).click()
  const input = page.getByRole('textbox', { name: '重新命名' })
  await expect(input).toBeFocused()
  await page.keyboard.type(name)
  await page.keyboard.press('Enter')
  await expect(item(page, name)).toBeVisible()
}

test('資料夾樹：拖曳移入資料夾、同層排序，重新整理後保持', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByLabel('筆記標題')).toHaveValue('歡迎使用')
  await newFolder(page, '專案')
  await newFolder(page, '封存')
  await newNote(page, '乙')
  await newNote(page, '丙')
  expect(await levels(page)).toEqual(['1:專案', '1:封存', '1:歡迎使用', '1:乙', '1:丙'])

  // note → into folder
  await drag(page, '乙', '專案', 'middle')
  await expect(item(page, '專案')).toHaveAttribute('aria-expanded', 'true')
  await expect.poll(() => levels(page)).toEqual(['1:專案', '2:乙', '1:封存', '1:歡迎使用', '1:丙'])

  // reorder among siblings: 丙 above 歡迎使用
  await drag(page, '丙', '歡迎使用', 'top')
  await expect.poll(() => levels(page)).toEqual(['1:專案', '2:乙', '1:封存', '1:丙', '1:歡迎使用'])

  // folder → into folder, and a cycle attempt is ignored
  await drag(page, '封存', '專案', 'middle')
  await expect.poll(() => levels(page)).toEqual(['1:專案', '2:封存', '2:乙', '1:丙', '1:歡迎使用'])
  await drag(page, '專案', '封存', 'middle')
  await expect.poll(() => levels(page)).toEqual(['1:專案', '2:封存', '2:乙', '1:丙', '1:歡迎使用'])

  if (process.env.TREE_SHOT) await page.screenshot({ path: process.env.TREE_SHOT })

  // survives a reload (persistence is async: retry)
  const expected = ['1:專案', '2:封存', '2:乙', '1:丙', '1:歡迎使用']
  await expect(async () => {
    await page.reload()
    await expect(page.getByRole('tree')).toBeVisible()
    expect(await levels(page)).toEqual(expected)
  }).toPass({ timeout: 10000 })
})

test('垃圾桶：移到垃圾桶、還原，並更新已刪除的筆記連結', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByLabel('筆記標題')).toHaveValue('歡迎使用')
  await newNote(page, '目標')
  await item(page, '歡迎使用').click()
  const editor = page.locator('.ProseMirror')
  await editor.click()
  await page.keyboard.press('Control+End')
  await page.keyboard.press('Enter')
  await page.keyboard.type('見 [[目標')
  await page.getByRole('option', { name: /目標/ }).click()
  await expect(editor.getByRole('link', { name: '前往 目標' })).toBeVisible()

  // trash the linked note through the context menu
  await item(page, '目標').click({ button: 'right' })
  await page.getByRole('menuitem', { name: '移到垃圾桶' }).click()
  await expect(item(page, '目標')).toHaveCount(0)
  await expect(editor.getByText('已刪除的筆記')).toBeVisible()

  await page.getByRole('button', { name: /垃圾桶/ }).click()
  const entry = page.getByRole('listitem').filter({ hasText: '目標' })
  await expect(entry).toContainText('30 天後永久刪除')
  if (process.env.TRASH_SHOT) await page.screenshot({ path: process.env.TRASH_SHOT })
  await entry.getByRole('button', { name: '還原' }).click()
  await expect(page.getByText('垃圾桶是空的')).toBeVisible()
  await page.getByRole('button', { name: '返回' }).click()
  await expect(item(page, '目標')).toBeVisible()
  await expect(editor.getByRole('link', { name: '前往 目標' })).toBeVisible()
  await expect(editor.getByText('已刪除的筆記')).toHaveCount(0)
})
