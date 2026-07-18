import { defineConfig, devices } from '@playwright/test';

const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined;

export default defineConfig({
  testDir: '.',
  testMatch: 'pwa-update.spec.ts',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI
    ? [['line'], ['html', { open: 'never', outputFolder: 'playwright-report-pwa-update' }]]
    : 'line',
  timeout: 180_000,
  expect: { timeout: 45_000 },
  use: {
    baseURL: 'http://127.0.0.1:4174',
    serviceWorkers: 'allow',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure'
  },
  webServer: {
    command: 'node e2e/start-pwa-update-preview.mjs',
    url: 'http://127.0.0.1:4174/__pwa_test__/state',
    reuseExistingServer: false,
    timeout: 120_000
  },
  projects: [
    {
      name: 'chromium-pwa-update',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: executablePath ? { executablePath } : undefined
      }
    }
  ]
});
