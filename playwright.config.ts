import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://localhost:4173',
    // Specs start from an empty vault (one blank 歡迎使用 note): skip the built-in guide (honoured only
    // under automation, see src/main.tsx). guide.spec.ts opts back in.
    storageState: { cookies: [], origins: [{ origin: 'http://localhost:4173', localStorage: [{ name: 'notes-v2:e2e-no-guide', value: '1' }] }] },
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
  webServer: {
    // CI builds in an earlier step; locally the suite builds first.
    command: process.env.CI ? 'npx vite preview --port 4173 --strictPort' : 'npm run build && npx vite preview --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
  },
})
