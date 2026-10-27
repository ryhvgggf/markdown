import { expect, test, type Page } from '@playwright/test'
import { newNote } from './helpers'

// Every Markdown shortcut and keyboard shortcut the built-in guide documents
// (src/features/guide/guide-content.ts, 「編輯與格式」). `ControlOrMeta` = Ctrl on Windows/Linux, ⌘ on macOS.

async function clearBody(page: Page) {
  const editor = page.locator('.ProseMirror')
  await editor.click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.press('Backspace')
  await expect(editor.locator('> *')).toHaveCount(1)
  await expect(editor.locator('> p')).toHaveCount(1)
  return editor
}

// Long multi-step flows: WebKit on the 2-core CI box needs ~30 s for some of them.
test.describe.configure({ timeout: 90_000 })

test('導覽寫的 Markdown 區塊快捷輸入都有效', async ({ page }) => {
  await page.goto('/')
  const cases: Array<[string, string]> = [
    ['# ', 'h1'], ['## ', 'h2'], ['### ', 'h3'], ['- ', 'ul'], ['* ', 'ul'], ['1. ', 'ol'],
    ['[] ', '[data-type="taskList"]'], ['[x] ', 'li[data-checked="true"]'], ['> ', 'blockquote'], ['``` ', 'pre'], ['---', 'hr'],
  ]
  for (const [input, sel] of cases) {
    const editor = await clearBody(page)
    await page.keyboard.type(input)
    await expect(editor.locator(sel), JSON.stringify(input)).toHaveCount(1)
  }
  const editor = await clearBody(page)
  await page.keyboard.type('```abap ')
  await expect(editor.locator('pre code.language-abap, pre[data-language="abap"], pre:has(code.language-abap)').first()).toBeVisible()
})

test('導覽寫的行內 Markdown 與格式快捷鍵都有效', async ({ page }) => {
  await page.goto('/')
  const inline: Array<[string, string]> = [
    ['**粗體** ', 'strong'], ['*斜體* ', 'em'], ['_斜體_ ', 'em'], ['~~刪除~~ ', 's'], ['`code` ', 'code'], ['==螢光== ', 'mark'],
  ]
  for (const [input, sel] of inline) {
    const editor = await clearBody(page)
    await page.keyboard.type(input)
    await expect(editor.locator(sel), input).toHaveCount(1)
  }
  const marks: Array<[string, string]> = [
    ['ControlOrMeta+b', 'strong'], ['ControlOrMeta+i', 'em'], ['ControlOrMeta+u', 'u'], ['ControlOrMeta+Shift+s', 's'],
    ['ControlOrMeta+e', 'code'], ['ControlOrMeta+Shift+h', 'mark'],
  ]
  for (const [key, sel] of marks) {
    const editor = await clearBody(page)
    await page.keyboard.type('word')
    await page.keyboard.press('Shift+Home')
    await expect(page.getByRole('toolbar', { name: '文字格式' })).toBeVisible() // the editor has seen the selection
    await page.keyboard.press(key)
    await expect(editor.locator(sel), key).toHaveText('word')
  }
  const blocks: Array<[string, string]> = [
    ['ControlOrMeta+Alt+1', 'h1'], ['ControlOrMeta+Alt+2', 'h2'], ['ControlOrMeta+Alt+3', 'h3'], ['ControlOrMeta+Shift+7', 'ol'],
    ['ControlOrMeta+Shift+8', 'ul'], ['ControlOrMeta+Shift+9', '[data-type="taskList"]'], ['ControlOrMeta+Shift+b', 'blockquote'],
    ['ControlOrMeta+Alt+c', 'pre'],
  ]
  for (const [key, sel] of blocks) {
    const editor = await clearBody(page)
    await page.keyboard.type('line')
    await page.keyboard.press(key)
    await expect(editor.locator(sel), key).toHaveCount(1)
  }
})

test('導覽寫的復原／重做、Shift+Enter、Ctrl+K 與 Ctrl+\\ 都有效', async ({ page }) => {
  await page.goto('/')
  const editor = await clearBody(page)
  await page.keyboard.type('a')
  await page.keyboard.press('Shift+Enter')
  await page.keyboard.type('b')
  await expect(editor.locator('p br')).toHaveCount(1)
  await page.waitForTimeout(600) // a separate undo step
  await page.keyboard.type('XYZ')
  await page.keyboard.press('ControlOrMeta+z')
  await expect(editor).not.toContainText('XYZ')
  await page.keyboard.press('ControlOrMeta+Shift+z')
  await expect(editor).toContainText('XYZ')
  await page.keyboard.press('ControlOrMeta+z')
  await page.keyboard.press('ControlOrMeta+y')
  await expect(editor).toContainText('XYZ')

  await page.keyboard.press('ControlOrMeta+k')
  await expect(page.getByRole('dialog', { name: '快速切換' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: '快速切換' })).toBeHidden()

  const rail = page.getByRole('navigation', { name: '主要功能' })
  await page.keyboard.press('ControlOrMeta+\\')
  await expect(rail.getByRole('button', { name: '設定' })).toBeVisible()
})

test('導覽寫的表格操作、最後一格 Tab 新增列與點標籤搜尋都有效', async ({ page }) => {
  await page.goto('/')
  const editor = await clearBody(page)
  await page.keyboard.type('/表格')
  await page.keyboard.press('Enter')
  await page.getByRole('button', { name: '表格操作' }).click()
  for (const label of ['上方插入列', '下方插入列', '左側插入欄', '右側插入欄', '刪除列', '刪除欄', '刪除表格']) {
    await expect(page.getByRole('menuitem', { name: label })).toBeVisible()
  }
  await page.keyboard.press('Escape')
  await expect(page.getByRole('menu')).toBeHidden()
  // keyboard: Shift+F10 with the caret in a cell opens it, arrows + Enter pick an item
  await editor.locator('td').first().click()
  await page.keyboard.press('Shift+F10')
  await expect(page.getByRole('menuitem', { name: '下方插入列' })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: '上方插入列' })).toBeFocused() // keys now go to the menu
  await page.keyboard.press('ArrowDown')
  await expect(page.getByRole('menuitem', { name: '下方插入列' })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(editor.locator('tr')).toHaveCount(4)
  await page.getByRole('button', { name: '表格操作' }).click()
  await page.getByRole('menuitem', { name: '刪除列' }).click()
  await expect(editor.locator('tr')).toHaveCount(3)
  await editor.locator('td').last().click()
  await page.keyboard.type('z')
  await expect(editor.locator('td').last()).toHaveText('z')
  await page.keyboard.press('Tab')
  await expect(editor.locator('tr')).toHaveCount(4)

  await clearBody(page)
  await page.keyboard.type('#導覽 ')
  await editor.getByRole('button', { name: '搜尋標籤 #導覽' }).click()
  await expect(page.getByRole('dialog', { name: '快速切換' }).getByLabel('搜尋筆記')).toHaveValue('#導覽')
})

test('導覽寫的大綱短線與反向連結面板都如所述', async ({ page }) => {
  await page.goto('/')
  const editor = await clearBody(page)
  await page.keyboard.type('# 第一節\n內容\n## 第二節\n更多')
  // 「用鍵盤時，按 Tab 移到「大綱」再按 Enter」
  const ticks = page.getByRole('button', { name: '大綱', exact: true })
  await expect(ticks.locator('.outline-tick')).toHaveCount(3)
  await ticks.focus()
  await page.keyboard.press('Enter')
  const card = page.getByRole('navigation', { name: '大綱' })
  await expect(card.getByRole('button')).toHaveText(['歡迎使用', '第一節', '第二節'])
  await card.getByRole('button', { name: '第二節' }).click()
  await page.keyboard.type('!')
  await expect(editor.locator('h2')).toContainText('!')
  // 「右上角會出現「反向連結 N」」 once another note links here; 📌 keeps it open across notes
  const pill = page.getByRole('button', { name: /^反向連結/ })
  await expect(pill).toHaveCount(0)
  await newNote(page, '來源')
  await page.keyboard.type('[[歡迎')
  await page.getByRole('option', { name: /歡迎使用/ }).first().click()
  await page.getByRole('treeitem', { name: '歡迎使用', exact: true }).click()
  await expect(pill).toContainText('1', { timeout: 8000 })
  await pill.click()
  const panel = page.getByRole('complementary', { name: '反向連結面板' })
  await expect(panel.getByRole('heading', { name: /^已連結/ })).toBeVisible()
  await panel.getByRole('button', { name: '釘選面板' }).click()
  await page.getByRole('treeitem', { name: '來源', exact: true }).click()
  await expect(panel).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(panel).toBeHidden()
})
