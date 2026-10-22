import { expect, test, type Page } from '@playwright/test'

const SHOT = '/home/claude/markdown/.superpowers/sdd/2026-10-21-notes-v2-phase1'
const tree = (page: Page, name: string) => page.getByRole('treeitem', { name })

test('反向連結：已連結卡片、提到但未連結、轉為連結；大綱', async ({ page }, info) => {
  await page.goto('/')
  const title = page.getByLabel('筆記標題')
  await expect(title).toHaveValue('歡迎使用')
  const editor = page.locator('.ProseMirror')
  await editor.click()
  await page.keyboard.press('Control+End')
  await page.keyboard.press('Enter')
  await page.keyboard.type('參考 [[採購流程')
  await page.getByRole('option', { name: '建立新筆記「採購流程」' }).click()
  await expect(editor.getByRole('link', { name: '前往 採購流程' })).toBeVisible()

  // note C mentions the title as plain text
  await page.getByRole('button', { name: '新增筆記' }).click()
  await expect(title).toBeFocused()
  await page.keyboard.type('筆記C')
  await page.keyboard.press('Enter')
  await page.keyboard.type('我們依採購流程處理請購')
  await expect(tree(page, '筆記C')).toBeVisible()

  // open the target, then 反向連結 N
  await tree(page, '採購流程').click()
  await expect(title).toHaveValue('採購流程')
  const pill = page.getByRole('button', { name: /^反向連結/ })
  await expect(pill).toContainText('1', { timeout: 8000 })
  await pill.click()
  const panel = page.getByRole('complementary', { name: '筆記資訊' })
  await expect(panel.getByRole('tab', { name: '反向連結' })).toHaveAttribute('aria-selected', 'true')
  const linked = panel.getByRole('button', { name: /歡迎使用/ })
  await expect(linked).toBeVisible()
  const convert = panel.getByRole('button', { name: '轉為連結' })
  await expect(convert).toBeVisible({ timeout: 8000 })
  await expect(panel.getByText('筆記C')).toBeVisible()
  if (info.project.name === 'chromium') await page.screenshot({ path: `${SHOT}/task-21-backlinks.png` })

  await convert.click()
  await expect(convert).toBeHidden()
  await expect(panel.getByRole('button', { name: /筆記C/ })).toBeVisible({ timeout: 8000 })
  await expect(pill).toContainText('2')

  // clicking a card opens its source
  await panel.getByRole('button', { name: /歡迎使用/ }).click()
  await expect(title).toHaveValue('歡迎使用')

  // outline of a note with 3 headings
  await tree(page, '採購流程').click()
  await expect(title).toHaveValue('採購流程')
  await editor.click()
  await page.keyboard.type('# 概觀\n')
  await page.keyboard.type('說明\n## 申請\n')
  await page.keyboard.type('步驟\n### 核准\n')
  await page.keyboard.type('層級')
  await panel.getByRole('tab', { name: '大綱' }).click()
  const nav = panel.getByRole('navigation', { name: '大綱' })
  await expect(nav.getByRole('button')).toHaveText(['概觀', '申請', '核准'])
  if (info.project.name === 'chromium') await page.screenshot({ path: `${SHOT}/task-21-outline.png` })
  await nav.getByRole('button', { name: '核准' }).click()
  await expect(editor.locator('h3', { hasText: '核准' })).toBeInViewport()

  // Esc inside the panel closes it
  await nav.getByRole('button', { name: '申請' }).focus()
  await page.keyboard.press('Escape')
  await expect(panel).toBeHidden()
})
