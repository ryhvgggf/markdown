import { expect, test, type Page } from '@playwright/test'
import { item, newNote } from './helpers'

/** Runs `fn` against the app's IndexedDB (raw API: the page has no Dexie handle). */
function idb<T>(page: Page, fn: string): Promise<T> {
  return page.evaluate(
    (body) =>
      new Promise<T>((resolve, reject) => {
        const open = indexedDB.open('notes-v2')
        open.onerror = () => reject(open.error)
        open.onsuccess = () => {
          const db = open.result
          const run = new Function('db', 'done', body) as (db: IDBDatabase, done: (v: T) => void) => void
          run(db, (v) => {
            db.close()
            resolve(v)
          })
        }
      }),
    fn,
  )
}

const isMac = (page: Page) => page.evaluate(() => /Mac|iPhone|iPad/.test(navigator.platform))

test('立即重新整理：標題、內文、連結與索引都會恢復 (I1, I3, M2)', async ({ page }) => {
  await page.goto('/')
  const title = page.getByLabel('筆記標題')
  const editor = page.locator('.ProseMirror')
  await expect(title).toHaveValue('歡迎使用')
  await newNote(page, '斑馬魚目標')

  // a title typed without Enter or blur, then an immediate reload
  await page.getByRole('button', { name: '新增筆記' }).click()
  await expect(title).toBeFocused()
  await page.keyboard.type('BetaTitle')
  await page.reload()
  await expect(item(page, 'BetaTitle')).toBeVisible()
  await expect(title).toHaveValue('BetaTitle')

  // body with a note link, then an immediate reload
  await editor.click()
  await page.keyboard.type('zebrafish 觀察 [[斑馬魚')
  await page.getByRole('option', { name: /斑馬魚目標/ }).click()
  await expect(editor.locator('[data-note-link]')).toHaveCount(1)
  await page.keyboard.type(' quickreload')
  await page.reload()

  await expect(item(page, 'BetaTitle')).toBeVisible()
  await item(page, 'BetaTitle').click()
  await expect(title).toHaveValue('BetaTitle')
  await expect(editor).toContainText('zebrafish 觀察')
  await expect(editor).toContainText('quickreload')
  await expect(editor.locator('[data-note-link]', { hasText: '斑馬魚目標' })).toHaveCount(1)

  // the index catches up after the reload: search finds the body text …
  const mod = (await isMac(page)) ? 'Meta' : 'Control'
  const dialog = page.getByRole('dialog', { name: '快速切換' })
  await expect(async () => {
    await page.keyboard.press(`${mod}+k`)
    await expect(dialog).toBeVisible()
    await page.getByRole('combobox').fill('quickreload')
    await expect(dialog.getByRole('option', { name: /BetaTitle/ })).toBeVisible({ timeout: 1000 })
  }).toPass({ timeout: 15000 })
  await page.keyboard.press('Escape')

  // … and the link target lists the source in its 反向連結
  await item(page, '斑馬魚目標').click()
  await expect(title).toHaveValue('斑馬魚目標')
  await expect(page.getByRole('button', { name: /^反向連結/ })).toContainText('1', { timeout: 10000 })
})

test('一篇損壞的筆記加上索引重建，App 仍能開啟 (C1)', async ({ page }) => {
  await page.goto('/')
  const title = page.getByLabel('筆記標題')
  const editor = page.locator('.ProseMirror')
  await expect(title).toHaveValue('歡迎使用')
  await newNote(page, '健康的筆記')
  await page.keyboard.type('一切正常')
  await newNote(page, 'Victim')
  await page.keyboard.type('即將損壞')
  await expect
    .poll(() => idb<unknown>(page, `const r = db.transaction('meta').objectStore('meta').get('lastNoteId'); r.onsuccess = () => done(r.result?.value)`))
    .toBeTruthy()
  const victim = await idb<string>(page, `const r = db.transaction('meta').objectStore('meta').get('lastNoteId'); r.onsuccess = () => done(r.result.value)`)

  // one garbage update row for Victim, and a forced index rebuild on the next start
  await idb(
    page,
    `const tx = db.transaction(['updates', 'meta'], 'readwrite');
     tx.objectStore('updates').add({ docId: ${JSON.stringify(victim)}, update: new Uint8Array([255, 255, 255, 255]) });
     tx.objectStore('meta').delete('indexVersion');
     tx.oncomplete = () => done(null)`,
  )

  for (let i = 0; i < 2; i++) {
    await page.reload()
    await expect(item(page, 'Victim')).toBeVisible()
    await expect(page.getByText(/無法開啟筆記/)).toHaveCount(0)
    await item(page, 'Victim').click()
    await expect(page.getByText('這篇筆記無法讀取。原始資料已保留，其他筆記不受影響。')).toBeVisible()
    await item(page, '健康的筆記').click()
    await expect(title).toHaveValue('健康的筆記')
    await expect(editor).toContainText('一切正常')
  }
  // the rebuild ran despite the bad note and recorded the index version
  await expect
    .poll(() => idb<unknown>(page, `const r = db.transaction('meta').objectStore('meta').get('indexVersion'); r.onsuccess = () => done(r.result?.value)`), {
      timeout: 10000,
    })
    .toBe(3) // INDEX_VERSION (3 since link snippet tokens carry block ids)
})
