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

// Where Chinese titles sort relative to Latin ones depends on the browser's locale data: leave the welcome note out.
const lv = async (page: Page) => (await levels(page)).filter((x) => !x.endsWith(':歡迎使用'))

test('資料夾樹：自動排序（名稱），拖曳只能移入資料夾，重新整理後保持', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByLabel('筆記標題')).toHaveValue('歡迎使用')
  await newFolder(page, 'Projects')
  await newFolder(page, 'Archive')
  await newNote(page, 'C')
  await newNote(page, 'B')
  // folders first, then notes, each by name — not by creation order
  await expect.poll(() => lv(page)).toEqual(['1:Archive', '1:Projects', '1:B', '1:C'])

  // note → into folder
  await drag(page, 'B', 'Projects', 'middle')
  await expect(item(page, 'Projects')).toHaveAttribute('aria-expanded', 'true')
  await expect.poll(() => lv(page)).toEqual(['1:Archive', '1:Projects', '2:B', '1:C'])

  // dropping beside a sibling does not reorder
  await drag(page, 'C', '歡迎使用', 'top')
  await expect.poll(() => lv(page)).toEqual(['1:Archive', '1:Projects', '2:B', '1:C'])

  // folder → into folder, and a cycle attempt is ignored
  await drag(page, 'Archive', 'Projects', 'middle')
  await expect.poll(() => lv(page)).toEqual(['1:Projects', '2:Archive', '2:B', '1:C'])
  await drag(page, 'Projects', 'Archive', 'middle')
  await expect.poll(() => lv(page)).toEqual(['1:Projects', '2:Archive', '2:B', '1:C'])

  if (process.env.TREE_SHOT) await page.screenshot({ path: process.env.TREE_SHOT })

  // survives a reload (persistence is async: retry)
  const expected = ['1:Projects', '2:Archive', '2:B', '1:C']
  await expect(async () => {
    await page.reload()
    await expect(page.getByRole('tree')).toBeVisible()
    expect(await lv(page)).toEqual(expected)
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
