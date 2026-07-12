import { defineConfig, devices } from '@playwright/test';

const siteDir = process.env.SITE_DIR;
if (!siteDir) throw new Error('SITE_DIR is required.');

export default defineConfig({
  testDir: '../../e2e',
  testMatch: 'app.spec.ts',
  fullyParallel: false,
  forbidOnly: true,
  retries: 1,
  workers: 2,
  reporter: [['line'], ['html', { open: 'never' }]],
  timeout: 30_000,
  expect: { timeout: 8_000 },
  use: {
    baseURL: 'http://127.0.0.1:4173',
    // API-mocked journeys block Service Workers; the dedicated PWA describe
    // in app.spec.ts opts back into real registration and offline behavior.
    serviceWorkers: 'block',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'off'
  },
  webServer: {
    command: 'node scripts/serve-static.mjs',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: false,
    timeout: 120_000
  },
  projects: [
    { name: 'chromium-desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'chromium-android', use: { ...devices['Pixel 7'] } },
    { name: 'firefox-desktop', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit-iphone', use: { ...devices['iPhone 15 Pro'], browserName: 'webkit' } }
  ]
});
