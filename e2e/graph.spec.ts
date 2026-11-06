import { expect, test, type Page } from '@playwright/test'
import { newNote } from './helpers'

async function openGraph(page: Page) {
  await page.mouse.move(300, 450)
  await page.mouse.move(3, 450, { steps: 4 })
  await expect(page.getByRole('navigation', { name: '主要功能' })).toHaveAttribute('data-open', 'true')
  await page.getByRole('button', { name: '關聯' }).click()
  const layer = page.getByRole('dialog', { name: '關聯' })
  await expect(layer).toBeVisible()
  return layer
}

type Dot = { id: string; label: string; x: number; y: number }
/** Where the canvas has drawn each node (published only under automation), once the layout stops moving. */
async function settledDots(page: Page): Promise<Dot[]> {
  const canvas = page.getByTestId('graph-canvas')
  let last = ''
  await expect
    .poll(async () => {
      const raw = (await canvas.getAttribute('data-nodes')) ?? ''
      const now = raw.replace(/(\d+)\.\d+/g, '$1') // whole pixels: ignore the last tiny drift
      const same = now !== '' && now === last
      last = now
      return same
    }, { timeout: 20_000, intervals: [400] })
    .toBe(true)
  return JSON.parse((await canvas.getAttribute('data-nodes')) ?? '[]') as Dot[]
}

test('關聯：兩篇互連 → 開關聯 → 點節點開那篇筆記', async ({ page }) => {
  await page.goto('/')
  await newNote(page, '甲筆記')
  await page.keyboard.type('連到 [[乙筆記')
  await page.getByRole('option', { name: '建立新筆記「乙筆記」' }).click()
  await expect(page.locator('.ProseMirror').getByRole('link', { name: '前往 乙筆記' })).toBeVisible()

  const layer = await openGraph(page)
  await expect(layer.getByRole('complementary', { name: '清單' }).getByRole('button', { name: '乙筆記' }).first()).toBeVisible()
  const dots = await settledDots(page)
  const target = dots.find((d) => d.label === '乙筆記')!
  const box = (await page.getByTestId('graph-canvas').boundingBox())!
  await page.mouse.click(box.x + target.x, box.y + target.y)
  await expect(layer).toHaveCount(0)
  await expect(page.getByLabel('筆記標題')).toHaveValue('乙筆記')
})

test('關聯：兩篇用同一個公式 → 公式視圖看到共用並列出兩篇；Esc 關閉', async ({ page }) => {
  await page.goto('/')
  await newNote(page, '公式甲')
  await page.keyboard.type('式 $x^2$ ')
  await expect(page.locator('.ProseMirror .math-inline .katex')).toBeVisible()
  await newNote(page, '公式乙')
  await page.keyboard.type('式 $x^2$ ')
  await expect(page.locator('.ProseMirror .math-inline .katex')).toBeVisible()

  const layer = await openGraph(page)
  await layer.getByRole('button', { name: '全部' }).click()
  await layer.getByRole('button', { name: /公式$/ }).click()
  const list = layer.getByRole('complementary', { name: '清單' })
  // The index catches up a moment after typing; the layer refreshes itself.
  await expect(list.getByRole('button', { name: '∑ x^2' }).first()).toBeVisible({ timeout: 15_000 })
  await list.getByRole('button', { name: '∑ x^2' }).first().click()
  const used = layer.getByRole('region', { name: '用到這個公式的筆記' })
  await expect(used.getByRole('button', { name: '公式甲' })).toBeVisible()
  await expect(used.getByRole('button', { name: '公式乙' })).toBeVisible()

  await page.keyboard.press('Escape')
  await expect(layer).toHaveCount(0)
})
