import { expect, test, type Page } from '@playwright/test'

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
    ['ControlOrMeta+Shift+8', 'ul'], ['ControlOrMeta+Shift+9', '[data-type="taskList"]'],
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
