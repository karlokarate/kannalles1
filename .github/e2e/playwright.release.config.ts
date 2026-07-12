import { defineConfig, devices } from '@playwright/test';

const siteDir = process.env.SITE_DIR;
if (!siteDir) throw new Error('SITE_DIR is required.');

export default defineConfig({
  testDir: '.',
  testMatch: 'release.spec.ts',
  fullyParallel: false,
  forbidOnly: true,
  retries: 1,
  workers: 2,
  reporter: [['line'], ['html', { open: 'never' }]],
  timeout: 30_000,
  expect: { timeout: 8_000 },
  use: {
    baseURL: 'http://127.0.0.1:4173',
    serviceWorkers: 'allow',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'off'
  },
  webServer: {
    command: `python3 -m http.server 4173 --bind 127.0.0.1 --directory "${siteDir}"`,
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: false,
    timeout: 120_000
  },
  projects: [
    { name: 'chromium-desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'chromium-android', use: { ...devices['Pixel 7'] } },
    { name: 'webkit-iphone', use: { ...devices['iPhone 15 Pro'], browserName: 'webkit' } }
  ]
});
