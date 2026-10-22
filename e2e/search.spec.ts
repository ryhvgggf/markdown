import { expect, test } from '@playwright/test'

const SHOT = '/home/claude/markdown/.superpowers/sdd/2026-10-21-notes-v2-phase1'

test('快速切換：Ctrl/⌘+K 搜尋內文並開啟，找不到時可新增', async ({ page }, info) => {
  await page.goto('/')
  const title = page.getByLabel('筆記標題')
  await expect(title).toHaveValue('歡迎使用')

  await page.getByRole('button', { name: '新增筆記' }).click()
  await expect(title).toBeFocused()
  await page.keyboard.type('採購筆記')
  await page.keyboard.press('Enter')
  await expect(page.locator('.ProseMirror')).toBeFocused() // Enter hands focus over once the editor has loaded
  await page.keyboard.type('請先建立採購申請再送簽')
  await expect(page.getByRole('treeitem', { name: '採購筆記' })).toBeVisible()

  // focus is inside the editor; the shortcut still opens the switcher
  const isMacLike = await page.evaluate(() => /Mac|iPhone|iPad/.test(navigator.platform))
  await page.keyboard.press(`${isMacLike ? 'Meta' : 'Control'}+k`)
  const dialog = page.getByRole('dialog', { name: '快速切換' })
  await expect(dialog).toBeVisible()
  const box = page.getByRole('combobox')
  await expect(box).toBeFocused()

  // the indexer debounces edits by 1 s before the text becomes searchable: retype until it is
  const hit = dialog.getByRole('option', { name: /採購筆記/ })
  await expect(async () => {
    await box.fill('')
    await box.fill('購申')
    await expect(hit).toContainText('內文提到「', { timeout: 500 })
  }).toPass({ timeout: 10000 })
  await expect(hit).toContainText('內文提到「')
  await expect(hit).toContainText('建立採購申請')
  await expect(dialog.getByRole('option', { name: '新增筆記「購申」' })).toBeVisible()
  if (info.project.name === 'chromium') await page.screenshot({ path: `${SHOT}/task-22-switcher.png` })

  // open another note first so Enter's effect is observable
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await page.getByRole('treeitem', { name: '歡迎使用' }).click()
  await expect(title).toHaveValue('歡迎使用')

  await page.keyboard.press(`${isMacLike ? 'Meta' : 'Control'}+k`)
  await box.fill('購申')
  await expect(dialog.getByRole('option', { name: /採購筆記/ })).toBeVisible()
  await page.keyboard.press('Enter')
  await expect(dialog).toBeHidden()
  await expect(title).toHaveValue('採購筆記')

  // create from the switcher
  await page.keyboard.press(`${isMacLike ? 'Meta' : 'Control'}+k`)
  await box.fill('全新主題')
  await dialog.getByRole('option', { name: '新增筆記「全新主題」' }).click()
  await expect(title).toHaveValue('全新主題')
})
