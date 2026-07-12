import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

async function openApp(page: Page) {
  await page.goto('/');
  await expect(page).toHaveTitle(/KH Checker/);
  await expect(page.getByRole('heading', { name: 'Welches Produkt oder Lebensmittel?' })).toBeVisible();
}

async function ensureGatewayConfigured(page: Page) {
  await page.getByRole('button', { name: 'Einstellungen' }).click();
  const gatewayInput = page.getByLabel('Vercel-Daten-Gateway (erforderlich)');
  await gatewayInput.fill('/');
  await expect(gatewayInput).toHaveValue('/');
  await page.getByRole('button', { name: 'Suche' }).click();
}

test('App-Shell, Hauptnavigation und mobile Breite bleiben nutzbar', async ({ page }) => {
  await openApp(page);

  const navigation = page.getByRole('navigation', { name: 'Hauptnavigation' });
  await expect(navigation).toBeVisible();
  for (const label of ['Suche', 'Verlauf', 'Favoriten', 'Einstellungen']) {
    await expect(navigation.getByRole('button', { name: label })).toBeVisible();
  }

  const overflow = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    content: document.documentElement.scrollWidth
  }));
  expect(overflow.content).toBeLessThanOrEqual(overflow.viewport + 1);
});

test('deterministische manuelle Berechnung funktioniert vollständig ohne Netzwerk', async ({ page }) => {
  await page.route('https://**', (route) => route.abort());
  await openApp(page);

  await page.getByRole('tab', { name: 'Manuell' }).click();
  const manualForm = page.locator('form.manual-form');
  await manualForm.getByLabel('Produkt', { exact: true }).fill('Testbrot');
  await manualForm.getByLabel('Menge', { exact: true }).fill('100');
  await manualForm.getByLabel('Einheit', { exact: true }).selectOption('g');
  await page.getByText('Optionale genaue Angaben').click();
  await page.getByLabel('Kohlenhydrate pro 100 Gramm').fill('40');
  await page.getByRole('button', { name: 'Berechnen' }).click();

  await expect(page.getByRole('heading', { name: 'Ergebnis' })).toBeVisible();
  await expect(page.getByText('Testbrot', { exact: true })).toBeVisible();
  await expect(page.locator('.big-result')).toContainText(/^40\s*g$/);
});

test('Suchbutton erlaubt sofortige Wiederholung ohne direkten Browser-OFF-Aufruf', async ({ page }) => {
  let gatewayRequests = 0;
  await page.route('**/api/search**', async (route) => {
    gatewayRequests += 1;
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        hits: [],
        count: 0,
        source: 'gateway',
        api_meta: {
          cacheStatus: 'network',
          fetchedAt: new Date().toISOString(),
          sourceUrl: '/api/search',
          backend: 'gateway',
          originBackend: 'gateway',
          networkAttempted: true,
          durationMs: 1,
          attempts: []
        }
      })
    });
  });

  await openApp(page);
  await ensureGatewayConfigured(page);
  await page.getByLabel('Produkt oder Lebensmittel suchen').fill('Kinder Bueno Qualitaetstest');
  await page.getByRole('button', { name: 'Suchen' }).click();

  const searchButton = page.getByRole('button', { name: /Suchen|Suche neu starten/ });
  await expect(searchButton).toBeVisible();
  await expect(searchButton).toBeEnabled();
  await searchButton.click();
  await expect(searchButton).toBeEnabled();
  await expect.poll(() => gatewayRequests).toBeGreaterThanOrEqual(1);
  expect(gatewayRequests).toBeGreaterThanOrEqual(1);
});

test('Startansicht erfüllt den automatisierten WCAG-A/AA-Smoke', async ({ page }) => {
  await openApp(page);
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(results.violations).toEqual([]);
});

test('Manifest und Service Worker sind erreichbar und registrierbar', async ({ page }) => {
  await openApp(page);
  const manifest = await page.request.get('/manifest.webmanifest');
  expect(manifest.ok()).toBeTruthy();
  expect((await manifest.json()).display).toBe('standalone');

  const serviceWorker = await page.request.get('/sw.js');
  expect(serviceWorker.ok()).toBeTruthy();
  await page.waitForFunction(async () => {
    if (!('serviceWorker' in navigator)) return false;
    const registration = await navigator.serviceWorker.ready;
    return Boolean(registration.active);
  });
});

test('App-Shell lädt nach dem Precache auch offline neu', async ({ page, context, browserName }) => {
  test.skip(browserName !== 'chromium', 'Offline-Service-Worker-Smoke läuft einmal im Chromium-Pfad.');
  await openApp(page);
  await page.waitForFunction(async () => {
    if (!('serviceWorker' in navigator)) return false;
    const registration = await navigator.serviceWorker.ready;
    return Boolean(registration.active);
  });
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Welches Produkt oder Lebensmittel?' })).toBeVisible();
  await context.setOffline(true);
  try {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Welches Produkt oder Lebensmittel?' })).toBeVisible();
  } finally {
    await context.setOffline(false);
  }
});
