import { defineConfig, devices } from '@playwright/test';

const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined;
const projects = [
  {
    name: 'chromium-desktop',
    use: {
      ...devices['Desktop Chrome'],
      launchOptions: executablePath ? { executablePath } : undefined
    }
  },
  {
    name: 'chromium-android',
    use: {
      ...devices['Pixel 7'],
      launchOptions: executablePath ? { executablePath } : undefined
    }
  },
  {
    name: 'firefox-desktop',
    use: {
      ...devices['Desktop Firefox']
    }
  },
  {
    name: 'webkit-iphone',
    use: {
      ...devices['iPhone 15 Pro'],
      browserName: 'webkit' as const
    }
  }
];

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : 1,
  reporter: process.env.CI ? [['line'], ['html', { open: 'never' }]] : 'line',
  timeout: 30_000,
  expect: { timeout: 8_000 },
  use: {
    baseURL: 'http://127.0.0.1:4173',
    // Deterministic API route mocks: Playwright cannot intercept requests that
    // are handled by a Service Worker. The dedicated PWA block opts back in.
    serviceWorkers: 'block',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'off'
  },
  webServer: {
    command: 'node scripts/start-e2e-preview.mjs',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: false,
    timeout: 120_000
  },
  projects
});
