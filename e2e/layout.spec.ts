import { expect, test, type Page } from '@playwright/test'

async function boot(page: Page, width: number, height = 900) {
  await page.setViewportSize({ width, height })
  await page.goto('/')
  await expect(page.getByRole('main')).toBeVisible()
}
async function box(page: Page, name: string | 'main') {
  const loc = name === 'main' ? page.getByRole('main') : page.getByRole('complementary', { name })
  const b = await loc.boundingBox()
  if (!b) throw new Error(`no box for ${name}`)
  return b
}
const overlaps = (a: { x: number; width: number }, b: { x: number; width: number }) =>
  a.x < b.x + b.width && b.x < a.x + a.width

test('wide: right card sits beside the note card', async ({ page }) => {
  await boot(page, 1500)
  await page.getByRole('button', { name: '大綱', exact: true }).click()
  const panel = page.getByRole('complementary', { name: '筆記資訊' })
  await expect(panel).toBeVisible()
  await expect(panel).not.toHaveAttribute('data-overlay', 'true')
  expect(overlaps(await box(page, '筆記資訊'), await box(page, 'main'))).toBe(false)
})

test('medium: right card overlays the note card', async ({ page }) => {
  await boot(page, 1200)
  await page.getByRole('button', { name: '大綱', exact: true }).click()
  const panel = page.getByRole('complementary', { name: '筆記資訊' })
  await expect(panel).toHaveAttribute('data-overlay', 'true')
  expect(overlaps(await box(page, '筆記資訊'), await box(page, 'main'))).toBe(true)
})

test('narrow: sidebar hidden until 檔案 is clicked', async ({ page }) => {
  await boot(page, 1000, 800)
  await expect(page.getByRole('complementary', { name: '資料夾' })).toHaveCount(0)
  await page.mouse.move(200, 400)
  await page.mouse.move(3, 400, { steps: 4 })
  await expect(page.getByRole('navigation', { name: '主要功能' })).toHaveAttribute('data-open', 'true')
  await page.getByRole('button', { name: '檔案' }).click()
  await expect(page.getByRole('complementary', { name: '資料夾' })).toBeVisible()
})

test('dragging the sidebar edge resizes it, capped at 360px', async ({ page }) => {
  await boot(page, 1500)
  const handle = page.getByRole('separator', { name: '調整側欄寬度' })
  const hb = (await handle.boundingBox())!
  const y = hb.y + hb.height / 2
  const x = hb.x + hb.width / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + 40, y, { steps: 5 })
  await page.mouse.up()
  const w1 = (await box(page, '資料夾')).width
  expect(w1).toBeGreaterThan(280)
  const hb2 = (await handle.boundingBox())!
  await page.mouse.move(hb2.x + hb2.width / 2, y)
  await page.mouse.down()
  await page.mouse.move(hb2.x + 400, y, { steps: 8 })
  await page.mouse.up()
  expect((await box(page, '資料夾')).width).toBeLessThanOrEqual(360)
})

test('rail closes on leave even after clicking a rail button', async ({ page }) => {
  await boot(page, 1500)
  const nav = page.getByRole('navigation', { name: '主要功能' })
  await page.mouse.move(300, 450)
  await page.mouse.move(3, 450, { steps: 4 })
  await expect(nav).toHaveAttribute('data-open', 'true')
  await page.getByRole('button', { name: '檔案' }).click()
  await page.mouse.move(700, 450, { steps: 6 })
  await expect(nav).toHaveAttribute('data-open', 'false')
})

test('screenshots', async ({ page }, info) => {
  test.skip(info.project.name !== 'chromium' || !process.env.SHOTS)
  const dir = process.env.SHOTS!
  await boot(page, 1500)
  await page.getByRole('button', { name: '大綱', exact: true }).click()
  await page.mouse.move(3, 450)
  await page.waitForTimeout(500)
  await page.screenshot({ path: `${dir}/task-12-wide.png` })
  await boot(page, 1000, 800)
  await page.mouse.move(3, 400)
  await page.getByRole('button', { name: '檔案' }).click()
  await page.waitForTimeout(500)
  await page.screenshot({ path: `${dir}/task-12-narrow.png` })
})
