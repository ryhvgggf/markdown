import { expect, type Page } from '@playwright/test'

export const item = (page: Page, name: string | RegExp) => page.getByRole('treeitem', { name, exact: typeof name === 'string' })

/** Creates a note from the sidebar and gives it a title; focus ends in the editor body. */
export async function newNote(page: Page, title: string) {
  await page.getByRole('button', { name: '新增筆記' }).click()
  await expect(page.getByLabel('筆記標題')).toBeFocused()
  await page.keyboard.type(title)
  await page.keyboard.press('Enter')
  await expect(item(page, title)).toBeVisible()
  await expect(page.locator('.ProseMirror')).toBeFocused() // Enter hands focus over once the editor has loaded
}
