import { expect, test, type Page } from '@playwright/test'
import { item, newNote } from './helpers'

/** Dispatches a paste carrying only text/plain at the editor's caret (works in every engine). */
async function pastePlain(page: Page, text: string) {
  await page.locator('.ProseMirror').evaluate((el, t) => {
    const ev = new Event('paste', { bubbles: true, cancelable: true })
    Object.defineProperty(ev, 'clipboardData', {
      value: { getData: (type: string) => (type === 'text/plain' ? t : ''), types: ['text/plain'], files: [], items: [] },
    })
    el.dispatchEvent(ev)
  }, text)
}

// Long multi-step flows: WebKit on the 2-core CI box needs ~30 s for some of them.
test.describe.configure({ timeout: 90_000 })

test('核心流程：建立、連結、區塊、重新整理、反向連結、改名、垃圾桶', async ({ page, context }, info) => {
  const chromium = info.project.name === 'chromium'
  if (chromium) await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.goto('/')
  const title = page.getByLabel('筆記標題')
  const editor = page.locator('.ProseMirror')
  await expect(title).toHaveValue('歡迎使用')

  // target note with a block to link to
  await newNote(page, '採購流程')
  await page.keyboard.type('核准層級依金額決定')
  const targetBlock = editor.locator('p', { hasText: '核准層級依金額決定' })
  const blockId = await targetBlock.getAttribute('data-block-id')
  expect(blockId).toBeTruthy()

  // source note: title, body, note link, block link
  await newNote(page, '年度計畫')
  await page.keyboard.type('預算請見 [[採購')
  await page.getByRole('option', { name: /採購流程/ }).click()
  const noteLink = editor.getByRole('link', { name: '前往 採購流程' })
  await expect(noteLink).toBeVisible()
  const noteId = await editor.locator('[data-note-link]').first().getAttribute('data-note-id')
  expect(noteId).toBeTruthy()
  await page.keyboard.press('End')
  await page.keyboard.type(' 另見 ')
  await pastePlain(page, `[[note:${noteId}#${blockId}]]`)
  const blockLink = editor.getByRole('link', { name: '前往 採購流程 › 核准層級依金額決定' })
  await expect(blockLink).toBeVisible({ timeout: 8000 }) // block text comes from the index (~1 s lag)

  // table, code block, task list through the slash menu
  await page.keyboard.press('End')
  await page.keyboard.press('Enter')
  await page.keyboard.type('/表格')
  await page.getByRole('option', { name: /表格/ }).first().click()
  await expect(editor.locator('table')).toBeVisible()
  await page.keyboard.type('儲存格甲')
  await page.keyboard.press('Control+End')
  await page.keyboard.press('Enter')
  await page.keyboard.type('/待辦')
  await page.getByRole('option', { name: /待辦/ }).first().click()
  await page.keyboard.type('寄出申請單')
  await expect(editor.locator('li[data-type="taskItem"]')).toContainText('寄出申請單')
  await page.keyboard.press('Enter')
  await page.keyboard.press('Enter')
  await page.keyboard.type('/程式碼')
  await page.getByRole('option', { name: /程式碼/ }).first().click()
  await expect(editor.locator('pre')).toBeVisible()
  await page.keyboard.type('const answer = 42')
  await page.keyboard.press('Control+End')

  // the indexer lags ~1 s behind edits: wait for the index before reloading
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            new Promise<boolean>((resolve) => {
              const open = indexedDB.open('notes-v2')
              open.onsuccess = () => {
                const db = open.result
                const req = db.transaction('noteText').objectStore('noteText').getAll()
                req.onsuccess = () => {
                  const rows = req.result as Array<{ text?: string }>
                  db.close()
                  resolve(rows.some((r) => r.text?.includes('const answer = 42')))
                }
                req.onerror = () => resolve(false)
              }
              open.onerror = () => resolve(false)
            }),
        ),
      { timeout: 15000 },
    )
    .toBe(true)

  // everything survives a reload
  await expect(async () => {
    await page.reload()
    await expect(title).toHaveValue('年度計畫')
    await expect(editor.locator('[data-note-link]', { hasText: '採購流程' }).first()).toBeVisible()
    await expect(editor.locator('table')).toContainText('儲存格甲')
    await expect(editor.locator('pre')).toContainText('const answer = 42')
    await expect(editor.locator('li[data-type="taskItem"]')).toContainText('寄出申請單')
    await expect(editor.locator('[data-note-link]')).toHaveCount(2)
  }).toPass({ timeout: 15000 })

  // the target's 反向連結 lists the source
  await item(page, '採購流程').click()
  await expect(title).toHaveValue('採購流程')
  const pill = page.getByRole('button', { name: /^反向連結/ })
  await expect(pill).toContainText('1', { timeout: 10000 })
  await pill.click()
  const panel = page.getByRole('complementary', { name: '反向連結面板' })
  await expect(panel.getByRole('button', { name: /年度計畫/ })).toBeVisible()
  await panel.getByRole('button', { name: '關閉面板' }).click()

  // rename the target: link text in the source follows
  await title.fill('採購管理')
  await title.press('Enter')
  await expect(item(page, '採購管理')).toBeVisible()
  await item(page, '年度計畫').click()
  await expect(title).toHaveValue('年度計畫')
  await expect(editor.locator('[data-note-link]', { hasText: '採購管理' }).first()).toBeVisible()

  // trash the target, then restore it: links break and recover
  await item(page, '採購管理').click({ button: 'right' })
  await page.getByRole('menuitem', { name: '移到垃圾桶' }).click()
  await expect(item(page, '採購管理')).toHaveCount(0)
  await expect(editor.getByText('已刪除的筆記').first()).toBeVisible()
  await page.getByRole('button', { name: /垃圾桶/ }).click()
  await page.getByRole('listitem').filter({ hasText: '採購管理' }).getByRole('button', { name: '還原' }).click()
  await page.getByRole('button', { name: '返回' }).click()
  await expect(item(page, '採購管理')).toBeVisible()
  await expect(editor.getByText('已刪除的筆記')).toHaveCount(0)
  await expect(editor.locator('[data-note-link]', { hasText: '採購管理' }).first()).toBeVisible()
})
