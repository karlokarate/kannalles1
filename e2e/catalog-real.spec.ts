import { expect, test } from '@playwright/test';
import {
  BUENO_GTIN,
  collectForbiddenProductRequests,
  expectCatalogReady,
  openCatalogApp,
  readRequiredNumber,
  searchCatalog,
} from './catalog-harness';

test.describe.configure({ mode: 'serial' });

test('installiert den echten Katalog einmal, öffnet ihn erneut und erhält die SQLite-Sortierung', async ({ page }) => {
  const forbidden = collectForbiddenProductRequests(page);
  let databaseDownloads = 0;
  page.on('request', (request) => {
    if (/\/catalog\/kh-checker-dach\.sqlite(?:\?|$)/u.test(request.url())) databaseDownloads += 1;
  });

  await openCatalogApp(page);
  const firstStatus = await expectCatalogReady(page);
  const firstVersion = await firstStatus.getAttribute('data-catalog-version');
  const firstSlot = await firstStatus.getAttribute('data-active-slot');
  await expect.poll(() => databaseDownloads, { timeout: 120_000 }).toBe(1);

  await searchCatalog(page, 'Kinder Bueno');
  const results = page.getByTestId('catalog-search-result');
  await expect(results.first()).toContainText(/Kinder Bueno/i);
  const ordinals = await results.evaluateAll((nodes) =>
    nodes.map((node) => Number(node.getAttribute('data-rank-ordinal'))),
  );
  expect(ordinals.every(Number.isFinite)).toBe(true);

  await page.reload({ waitUntil: 'domcontentloaded' });
  const reopenedStatus = await expectCatalogReady(page);
  await expect(reopenedStatus).toHaveAttribute('data-catalog-version', firstVersion ?? '');
  await expect(reopenedStatus).toHaveAttribute('data-active-slot', firstSlot ?? '');
  expect(databaseDownloads).toBe(1);
  forbidden.assertNone();
});

test('löst den Bueno-Barcode auf die kleinste bewiesene Einheit auf und rechnet ohne Zwischenrundung', async ({ page }) => {
  const forbidden = collectForbiddenProductRequests(page);
  await openCatalogApp(page);
  await expectCatalogReady(page);
  await searchCatalog(page, BUENO_GTIN);

  const product = page.getByTestId('catalog-product');
  await expect(product).toBeVisible();
  await expect(product).toHaveAttribute('data-gtin', BUENO_GTIN);
  await expect(product).toContainText(/Kinder Bueno/i);

  const unitSelect = page.getByTestId('catalog-unit-select');
  const selected = unitSelect.locator('option:checked');
  await expect(selected).toHaveAttribute('data-unit-kind', 'bar');
  await expect(selected).toContainText(/Riegel/i);
  await expect(selected).toHaveAttribute(
    'data-unit-provenance',
    /^(?:explicit-single-unit|explicit-multipack|count-and-net-weight|user-calibration)$/,
  );
  const availableUnitKinds = await unitSelect.locator('option').evaluateAll((options) =>
    options.map((option) => option.getAttribute('data-unit-kind')),
  );
  expect(availableUnitKinds[0]).toBe('bar');
  expect(availableUnitKinds).toContain('package');
  expect(availableUnitKinds).toContain('g');

  const amount = await readRequiredNumber(product, 'data-amount');
  const unitWeight = await readRequiredNumber(selected, 'data-unit-weight-g');
  const carbsPer100 = await readRequiredNumber(product, 'data-carbs-per-100-g');
  const calculation = page.getByTestId('catalog-calculation');
  const actualTotal = await readRequiredNumber(calculation, 'data-total-carbs-g');
  const expectedTotal = amount * unitWeight * carbsPer100 / 100;
  expect(Math.abs(actualTotal - expectedTotal)).toBeLessThan(1e-9);
  forbidden.assertNone();
});

test('öffnet den bereits installierten Katalog offline und führt Text- sowie Barcodeabfragen aus', async ({ page, context }) => {
  const forbidden = collectForbiddenProductRequests(page);
  await openCatalogApp(page);
  await expectCatalogReady(page);

  await context.setOffline(true);
  try {
    await page.reload({ waitUntil: 'domcontentloaded' });
    const status = await expectCatalogReady(page);
    await expect(status).toHaveAttribute('data-installed-from-network', 'false');
    await searchCatalog(page, 'Vollkornbrot');
    await expect(page.getByTestId('catalog-search-result').first()).toContainText(/Vollkornbrot/i);
    await searchCatalog(page, BUENO_GTIN);
    await expect(page.getByTestId('catalog-product')).toHaveAttribute('data-gtin', BUENO_GTIN);
  } finally {
    await context.setOffline(false);
  }
  forbidden.assertNone();
});

test('verwirft ein korruptes Update im inaktiven Slot und behält den letzten gültigen Katalog aktiv', async ({ page }) => {
  const forbidden = collectForbiddenProductRequests(page);
  await openCatalogApp(page);
  const initial = await expectCatalogReady(page);
  const stableVersion = await initial.getAttribute('data-catalog-version');
  const stableSlot = await initial.getAttribute('data-active-slot');

  const manifestResponse = await page.request.get('/catalog/manifest.json');
  expect(manifestResponse.ok()).toBe(true);
  const manifest = await manifestResponse.json();
  const corrupted = Buffer.from('sentinel-corrupt-sqlite-update', 'utf8');
  let corruptDatabaseRequests = 0;

  await page.route('**/catalog/manifest.json', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ...manifest,
        catalogVersion: `${manifest.catalogVersion}-sentinel-corrupt`,
        database: {
          ...manifest.database,
          bytes: corrupted.byteLength,
          sha256: '0'.repeat(64),
        },
      }),
    });
  });
  await page.route('**/catalog/kh-checker-dach.sqlite', async (route) => {
    corruptDatabaseRequests += 1;
    await route.fulfill({ status: 200, contentType: 'application/vnd.sqlite3', body: corrupted });
  });

  await page.reload({ waitUntil: 'domcontentloaded' });
  const recovered = await expectCatalogReady(page);
  await expect(recovered).toHaveAttribute('data-catalog-version', stableVersion ?? '');
  await expect(recovered).toHaveAttribute('data-active-slot', stableSlot ?? '');
  await expect(page.getByTestId('catalog-issue')).toHaveAttribute(
    'data-error-code',
    /^(?:CATALOG_HASH_MISMATCH|CATALOG_INTEGRITY_FAILED|CATALOG_ROLLBACK)$/,
  );
  expect(corruptDatabaseRequests).toBeGreaterThan(0);

  await searchCatalog(page, BUENO_GTIN);
  await expect(page.getByTestId('catalog-product')).toHaveAttribute('data-gtin', BUENO_GTIN);
  forbidden.assertNone();
});
