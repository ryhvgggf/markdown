import { expect, test } from '@playwright/test'

test('首頁語言為 zh-Hant', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-Hant')
})
