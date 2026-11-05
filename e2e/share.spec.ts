import { expect, test } from '@playwright/test'
import { item, newNote } from './helpers'

// Links are kept in localStorage instead of Supabase under automation (src/app/e2e-share.ts), so a second page
// of the same context can open what the first page shared.
test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => localStorage.setItem('notes-v2:e2e-share', '1'))
})

async function share(page: import('@playwright/test').Page, title: string) {
  await item(page, title).click()
  await page.getByRole('button', { name: '分享', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '分享' })
  await dialog.getByRole('button', { name: '建立連結' }).click()
  const url = await dialog.getByLabel('分享連結').inputValue()
  return { dialog, url }
}

test('分享：建立連結、別人開得到唯讀內容、停止後失效', async ({ page, context }) => {
  await page.goto('/')
  await newNote(page, '分享測試')
  await page.keyboard.type('第一版內容')
  await expect(page.locator('.ProseMirror')).toContainText('第一版內容')

  const { dialog, url } = await share(page, '分享測試')
  expect(url).toMatch(/\/s\/[\w-]{22}#[\w-]{43}$/)

  const viewer = await context.newPage()
  await viewer.goto(url)
  await expect(viewer.getByRole('heading', { name: '分享測試' })).toBeVisible()
  const body = viewer.getByLabel('筆記內容')
  await expect(body).toContainText('第一版內容')
  await expect(body).toHaveAttribute('contenteditable', 'false')
  await expect(viewer.locator('meta[name="referrer"]')).toHaveAttribute('content', 'no-referrer')

  // a later edit does not show until the snapshot is updated
  await dialog.press('Escape')
  await page.locator('.ProseMirror').click()
  await page.keyboard.press('Control+End')
  await page.keyboard.type('，第二版')
  await viewer.reload()
  await expect(viewer.getByLabel('筆記內容')).not.toContainText('第二版')
  await page.getByRole('button', { name: '分享', exact: true }).click()
  await page.getByRole('button', { name: '更新快照' }).click()
  await viewer.reload()
  await expect(viewer.getByLabel('筆記內容')).toContainText('第二版')

  await page.getByRole('button', { name: '停止分享' }).click()
  await page.getByRole('button', { name: '停止分享' }).last().click()
  await expect(page.getByRole('button', { name: '建立連結' })).toBeVisible()
  await viewer.reload()
  await expect(viewer.getByRole('alert')).toHaveText('連結無效或已停止分享')
})

test('永久刪除筆記時連結一併失效', async ({ page, context }) => {
  await page.goto('/')
  await newNote(page, '要刪除的筆記')
  await page.keyboard.type('內容')
  const { dialog, url } = await share(page, '要刪除的筆記')
  await dialog.press('Escape')

  const viewer = await context.newPage()
  await viewer.goto(url)
  await expect(viewer.getByLabel('筆記內容')).toContainText('內容')

  await item(page, '要刪除的筆記').click({ button: 'right' })
  await page.getByRole('menuitem', { name: '移到垃圾桶' }).click()
  await page.getByRole('button', { name: /垃圾桶/ }).click()
  const entry = page.getByRole('listitem').filter({ hasText: '要刪除的筆記' })
  await entry.getByRole('button', { name: '永久刪除' }).click()
  await entry.getByRole('button', { name: '刪除', exact: true }).click()
  await expect(async () => {
    await viewer.reload()
    await expect(viewer.getByRole('alert')).toHaveText('連結無效或已停止分享')
  }).toPass()
})

test('連結缺少金鑰時顯示無效', async ({ page }) => {
  await page.goto('/s/' + 'a'.repeat(22))
  await expect(page.getByRole('alert')).toHaveText('連結無效或已停止分享')
})

test('分享：到期、密碼（錯誤／正確／改密碼後舊密碼失效）、換新連結', async ({ page, context }) => {
  await page.goto('/')
  await newNote(page, '加鎖的筆記')
  await page.keyboard.type('機密內容')
  const { dialog, url } = await share(page, '加鎖的筆記')

  await dialog.getByLabel('密碼', { exact: true }).check()
  await dialog.getByLabel('設定密碼').fill('first-pass')
  await dialog.getByRole('button', { name: '儲存' }).click()
  await expect(dialog.getByText('已設定密碼')).toBeVisible()

  const viewer = await context.newPage()
  await viewer.goto(url)
  await expect(viewer.getByText('此文件受到密碼保護。請輸入密碼以開啟文件。')).toBeVisible()
  await viewer.getByLabel('密碼').fill('nope-nope')
  await viewer.getByRole('button', { name: '開啟' }).click()
  await expect(viewer.getByText('密碼錯誤')).toBeVisible()
  await viewer.getByLabel('密碼').fill('first-pass')
  await viewer.getByRole('button', { name: '開啟' }).click()
  await expect(viewer.getByLabel('筆記內容')).toContainText('機密內容')

  // changing the password: the old one stops working
  await dialog.getByRole('button', { name: '變更' }).click()
  await dialog.getByLabel('設定密碼').fill('second-pass')
  await dialog.getByRole('button', { name: '儲存' }).click()
  await expect(dialog.getByRole('button', { name: '變更' })).toBeVisible()
  await viewer.reload()
  await viewer.getByLabel('密碼').fill('first-pass')
  await viewer.getByRole('button', { name: '開啟' }).click()
  await expect(viewer.getByText('密碼錯誤')).toBeVisible()
  await viewer.getByLabel('密碼').fill('second-pass')
  await viewer.getByRole('button', { name: '開啟' }).click()
  await expect(viewer.getByLabel('筆記內容')).toContainText('機密內容')

  // expiry
  await dialog.getByRole('button', { name: '到期' }).click()
  await page.getByRole('menuitem', { name: /1 天/ }).click()
  await expect(dialog.getByText(/到期時間/)).toBeVisible()

  // renew: the old link dies, the new one keeps the password
  await dialog.getByRole('button', { name: '換新連結' }).click()
  await dialog.getByRole('button', { name: '換新連結' }).last().click()
  await expect(dialog.getByLabel('分享連結')).not.toHaveValue(url)
  const fresh = await dialog.getByLabel('分享連結').inputValue()
  await viewer.reload()
  await expect(viewer.getByRole('alert')).toHaveText('連結無效或已停止分享')
  await viewer.goto(fresh)
  await viewer.getByLabel('密碼').fill('second-pass')
  await viewer.getByRole('button', { name: '開啟' }).click()
  await expect(viewer.getByLabel('筆記內容')).toContainText('機密內容')
})

test('分享管理：一條連結分享多篇、別人可切換、重新整理停在同一篇、停止後失效', async ({ page, context }) => {
  await page.goto('/')
  await newNote(page, '甲篇')
  await page.keyboard.type('甲的內容')
  await newNote(page, '乙篇')
  await page.keyboard.type('乙的內容')
  await expect(page.locator('.ProseMirror')).toContainText('乙的內容')

  await page.getByRole('button', { name: '分享管理' }).click()
  await page.getByRole('button', { name: '建立多篇連結' }).click()
  await expect(page.getByRole('button', { name: '建立連結' })).toBeDisabled()
  await page.getByRole('checkbox', { name: '甲篇' }).check()
  await page.getByRole('checkbox', { name: '乙篇' }).check()
  await expect(page.getByText(/已選 2／30/)).toBeVisible()
  await page.getByRole('button', { name: '建立連結' }).click()
  const url = await page.getByLabel('分享連結').inputValue()
  expect(url).toMatch(/\/s\/[\w-]{22}#[\w-]{43}$/)

  const viewer = await context.newPage()
  await viewer.goto(url)
  const nav = viewer.getByRole('navigation', { name: '筆記清單' })
  await expect(nav.getByRole('button')).toHaveText(['甲篇', '乙篇'])
  await expect(viewer.getByLabel('筆記內容')).toContainText('甲的內容')
  await nav.getByRole('button', { name: '乙篇' }).click()
  await expect(viewer.getByLabel('筆記內容')).toContainText('乙的內容')
  await expect(viewer).toHaveURL(/\?n=n1#/)
  await viewer.reload()
  await expect(viewer.getByLabel('筆記內容')).toContainText('乙的內容')
  await expect(viewer.getByRole('heading', { name: '乙篇' })).toBeVisible()

  await page.getByRole('button', { name: '停止分享' }).click()
  await page.getByRole('button', { name: '停止分享' }).last().click()
  await expect(page.getByText('目前沒有分享中的筆記')).toBeVisible()
  await viewer.goto(url)
  await expect(viewer.getByRole('alert')).toHaveText('連結無效或已停止分享')
})

// 1x1 red PNG
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg=='

test('分享附件：圖片顯示、檔案可下載、更新快照、停止後失效', async ({ page, context, browserName }) => {
  test.skip(browserName === 'webkit', 'WebKit 的合成貼上沒有 clipboardData')
  await page.goto('/')
  await newNote(page, '有附件的筆記')
  await page.keyboard.type('看圖')
  await page.evaluate(
    ({ b64 }) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
      const dt = new DataTransfer()
      dt.items.add(new File([bytes], 'red.png', { type: 'image/png' }))
      dt.items.add(new File(['hello'], 'note.txt', { type: 'text/plain' }))
      document.querySelector('.ProseMirror')!.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
    },
    { b64: PNG_B64 },
  )
  await expect(page.locator('.ProseMirror img[alt="red.png"]')).toBeVisible()

  const { dialog, url } = await share(page, '有附件的筆記')
  await expect(dialog.getByLabel('分享連結')).toBeVisible()

  const viewer = await context.newPage()
  await viewer.goto(url)
  const img = viewer.getByLabel('筆記內容').locator('img[alt="red.png"]')
  await expect(img).toBeVisible()
  await expect(img).toHaveAttribute('src', /^blob:/)
  await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBe(1)
  const download = viewer.waitForEvent('download')
  await viewer.getByRole('button', { name: '下載 note.txt' }).click()
  expect((await download).suggestedFilename()).toBe('note.txt')

  await dialog.press('Escape')
  await page.getByRole('button', { name: '分享', exact: true }).click()
  await page.getByRole('button', { name: '更新快照' }).click()
  await viewer.reload()
  await expect(viewer.getByLabel('筆記內容').locator('img[alt="red.png"]')).toBeVisible()

  await page.getByRole('button', { name: '停止分享' }).click()
  await page.getByRole('button', { name: '停止分享' }).last().click()
  await expect(page.getByRole('button', { name: '建立連結' })).toBeVisible()
  await viewer.reload()
  await expect(viewer.getByRole('alert')).toHaveText('連結無效或已停止分享')
})
