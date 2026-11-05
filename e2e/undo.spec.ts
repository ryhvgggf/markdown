import { expect, test, type Page } from '@playwright/test'

const items = (page: Page) =>
  page.locator('.ProseMirror').evaluate((el) =>
    Array.from(el.querySelectorAll('li')).map((li) => {
      let depth = 0
      for (let n = li.parentElement; n && n !== el; n = n.parentElement) if (n.tagName === 'OL' || n.tagName === 'UL') depth++
      return `${depth}:${li.querySelector(':scope > p')?.textContent ?? ''}`
    }),
  )

test('清單：Enter 新增的項目、Tab、Shift+Tab 都能一步一步 Ctrl+Z 還原', async ({ page }) => {
  await page.goto('/')
  await page.locator('.ProseMirror').click()
  await page.keyboard.press('Control+End')
  await page.keyboard.press('Enter')
  const step = async (act: () => Promise<void>) => {
    await page.waitForTimeout(700) // past the 500 ms merge window → separate undo steps
    await act()
  }
  await page.keyboard.type('1. AAA')
  await page.keyboard.press('Enter')
  await page.keyboard.type('BBB')
  await step(() => page.keyboard.press('Enter'))
  expect(await items(page)).toEqual(['1:AAA', '1:BBB', '1:'])
  await step(() => page.keyboard.press('Tab'))
  expect(await items(page)).toEqual(['1:AAA', '1:BBB', '2:'])
  await step(() => page.keyboard.type('CCC'))
  await step(() => page.keyboard.press('Enter'))
  expect(await items(page)).toEqual(['1:AAA', '1:BBB', '2:CCC', '2:'])
  await step(() => page.keyboard.press('Shift+Tab'))
  expect(await items(page)).toEqual(['1:AAA', '1:BBB', '2:CCC', '1:'])

  await page.keyboard.press('Control+z')
  expect(await items(page)).toEqual(['1:AAA', '1:BBB', '2:CCC', '2:'])
  await page.keyboard.press('Control+z') // the Enter: the empty item itself goes away
  expect(await items(page)).toEqual(['1:AAA', '1:BBB', '2:CCC'])
  await page.keyboard.press('Control+z')
  expect(await items(page)).toEqual(['1:AAA', '1:BBB', '2:'])
  await page.keyboard.press('Control+z')
  expect(await items(page)).toEqual(['1:AAA', '1:BBB', '1:'])
  await page.keyboard.press('Control+z')
  expect(await items(page)).toEqual(['1:AAA', '1:BBB'])

  await page.keyboard.press('Control+y')
  expect(await items(page)).toEqual(['1:AAA', '1:BBB', '1:'])
})

test('一般段落：Enter 新增的空段落可以 Ctrl+Z 還原', async ({ page }) => {
  await page.goto('/')
  await page.locator('.ProseMirror').click()
  await page.keyboard.press('Control+End')
  await page.keyboard.press('Enter')
  await page.keyboard.type('aaa')
  await page.waitForTimeout(700)
  const count = () => page.locator('.ProseMirror > p').count()
  const before = await count()
  await page.keyboard.press('Enter')
  expect(await count()).toBe(before + 1)
  await page.keyboard.press('Control+z')
  expect(await count()).toBe(before)
})

test('重新開啟有內容的筆記後按 Ctrl+Z，不會把已存在的內容復原掉', async ({ page }) => {
  await page.goto('/')
  const editor = page.locator('.ProseMirror')
  await editor.click()
  await page.keyboard.press('Control+End')
  await page.keyboard.press('Enter')
  await page.keyboard.type('keep me')
  await page.waitForTimeout(1500) // let it persist
  await page.reload()
  await expect(editor).toContainText('keep me')
  await editor.click()
  await page.keyboard.press('Control+z')
  await expect(editor).toContainText('keep me')
})
