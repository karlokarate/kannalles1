import { defineConfig, devices } from '@playwright/test';

const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined;
const matrixTest = '**/browser-matrix.spec.ts';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI
    ? [['line'], ['html', { open: 'never' }]]
    : 'line',
  timeout: 180_000,
  expect: { timeout: 30_000 },
  use: {
    baseURL: 'http://127.0.0.1:4173',
    serviceWorkers: 'block',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  webServer: {
    command: 'node e2e/start-real-preview.mjs',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: false,
    timeout: 240_000,
  },
  projects: [
    {
      name: 'chromium-desktop',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: executablePath ? { executablePath } : undefined,
      },
    },
    {
      name: 'chromium-android',
      testMatch: matrixTest,
      use: {
        ...devices['Pixel 7'],
        launchOptions: executablePath ? { executablePath } : undefined,
      },
    },
    {
      name: 'firefox-desktop',
      testMatch: matrixTest,
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit-iphone',
      testMatch: matrixTest,
      use: {
        ...devices['iPhone 15 Pro'],
        browserName: 'webkit' as const,
      },
    },
  ],
});
