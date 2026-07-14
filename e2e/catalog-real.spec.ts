import { expect, test } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import {
  BUENO_GTIN,
  CATALOG_DATABASE_FILENAME,
  collectForbiddenProductRequests,
  expectCatalogReady,
  openCatalogApp,
  readRequiredNumber,
  searchCatalog,
} from './catalog-harness';

test.describe.configure({ mode: 'serial' });

test('installiert den manifestbenannten echten Katalog einmal, öffnet ihn erneut und erhält die SQLite-Sortierung', async ({ page }) => {
  const forbidden = collectForbiddenProductRequests(page);
  let databaseDownloads = 0;
  page.on('request', (request) => {
    if (request.url().includes(`/catalog/${CATALOG_DATABASE_FILENAME}`)) databaseDownloads += 1;
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

test('sammelt mehrere Produkte, hält die Summe schwebend und unterstützt Bearbeiten, Details sowie Reset', async ({ page }) => {
  await openCatalogApp(page);
  await expectCatalogReady(page);
  await page.getByRole('button', { name: 'Einstellungen', exact: true }).click();
  await page.getByTestId('clinic-mode-select').selectOption('off');
  await page.getByRole('button', { name: 'Rechner', exact: true }).click();

  await searchCatalog(page, 'Reis');
  await expect(page.getByTestId('catalog-product')).toContainText('Reis, gekocht');
  await page.getByTestId('meal-floating-add').click();
  await expect(page.getByTestId('meal-floating-total')).toContainText('1 Produkt');
  await expect(page.getByTestId('catalog-search-input')).toHaveValue('');

  await searchCatalog(page, 'Kartoffeln');
  await expect(page.getByTestId('catalog-product')).toContainText('Kartoffeln, gekocht');
  await page.getByRole('button', { name: '+ Zur Gesamtrechnung' }).click();
  await expect(page.getByTestId('meal-floating-total')).toContainText('2 Produkte');
  await page.getByTestId('meal-floating-total').click();

  const summary = page.getByTestId('meal-summary');
  await expect(summary).toBeVisible();
  await expect(page.getByTestId('meal-item')).toHaveCount(2);
  const totalBefore = Number(await page.getByTestId('meal-total').getAttribute('data-total-carbs-g'));
  await page.getByLabel('Reis, gekocht: Menge').fill('100');
  await expect.poll(async () => Number(await page.getByTestId('meal-total').getAttribute('data-total-carbs-g'))).toBeLessThan(totalBefore);

  await page.getByRole('button', { name: 'Reis, gekocht: Details öffnen' }).click();
  await expect(page.getByTestId('catalog-product')).toContainText('Reis, gekocht');
  await expect(page.getByTestId('meal-floating-total')).toBeVisible();
  await page.getByTestId('meal-floating-total').click();
  await page.getByRole('button', { name: 'Kartoffeln, gekocht aus der Gesamtrechnung entfernen' }).click();
  await expect(page.getByTestId('meal-item')).toHaveCount(1);

  await page.getByRole('button', { name: 'Einstellungen', exact: true }).click();
  await page.getByTestId('diabetes-profile-toggle').check();
  await page.getByTestId('diabetes-factor-correctionFactorMgDl').locator('summary').click();
  await page.getByTestId('diabetes-factor-targetGlucoseMgDl').locator('summary').click();
  for (const input of await page.getByTestId('carbohydrate-ratio-input').all()) await input.fill('10');
  for (const input of await page.getByTestId('correction-factor-input').all()) await input.fill('50');
  for (const input of await page.getByTestId('target-glucose-input').all()) await input.fill('100');
  await page.getByRole('button', { name: 'Verlauf', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Gespeicherte Rechnungen' })).toBeVisible();
  await page.getByRole('button', { name: 'Öffnen & verwenden' }).click();
  await expect(page.getByTestId('meal-item')).toHaveCount(1);
  await expect(page.getByText(/Bitte gib deinen aktuellen Blutzucker ein/)).toBeVisible();
  await expect(page.getByTestId('current-glucose-input')).toBeFocused();
  await expect(page.getByTestId('current-glucose-input')).toHaveValue('');
  await page.getByTestId('current-glucose-input').fill('200');
  await expect(page.getByTestId('total-bolus')).not.toHaveText('–');
  await page.getByRole('button', { name: '+ Weiteres Produkt' }).click();
  await searchCatalog(page, 'Kartoffeln');
  await page.getByTestId('meal-floating-add').click();
  await page.getByTestId('meal-floating-total').click();
  await expect(page.getByTestId('meal-item')).toHaveCount(2);

  await page.getByRole('button', { name: 'Zur Produktsuche' }).click();
  await page.getByTestId('catalog-search-input').fill('Nur ein Testtext');
  await page.getByRole('button', { name: 'Suche zurücksetzen' }).click();
  await expect(page.getByTestId('catalog-search-input')).toHaveValue('');
  await page.getByTestId('meal-floating-total').click();
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Aktuelle Rechnung zurücksetzen' }).click();
  await expect(page.getByTestId('meal-floating-total')).toBeHidden();
  await expect(page.getByTestId('catalog-search-input')).toBeVisible();
});

test('zeigt Trefferbilder, nutzt Sprache für gekochten Reis und speichert eine eigene Riegel-Einheit automatisch', async ({ page }) => {
  await page.addInitScript(() => {
    class FakeSpeechRecognition {
      lang = '';
      interimResults = false;
      continuous = false;
      onresult: ((event: unknown) => void) | null = null;
      onerror: ((event: unknown) => void) | null = null;
      onend: (() => void) | null = null;
      start() {
        setTimeout(() => {
          this.onresult?.({ results: [[{ transcript: 'Reis' }]] });
          this.onend?.();
        }, 0);
      }
    }
    Object.defineProperty(window, 'SpeechRecognition', { configurable: true, value: FakeSpeechRecognition });
  });
  await openCatalogApp(page);
  await expectCatalogReady(page);

  await page.getByRole('button', { name: 'Einstellungen', exact: true }).click();
  await page.getByTestId('clinic-mode-select').selectOption('off');
  await page.getByRole('button', { name: 'Rechner', exact: true }).click();

  await page.getByTestId('catalog-speech-search').click();
  const generic = page.getByTestId('catalog-product');
  await expect(generic).toContainText('Reis, gekocht');
  await expect(generic).toContainText('BLS 4.0 · C352032');
  await expect(generic).toHaveAttribute('data-carbs-per-100-g', '24.8');
  await expect(generic).toHaveAttribute('data-amount', '200');
  await expect(page.getByTestId('catalog-calculation')).toHaveAttribute('data-total-carbs-g', '49.6');
  await expect(page.getByTestId('catalog-amount-slider')).toHaveValue('200');
  await page.getByTestId('catalog-amount-slider').fill('250');
  await expect(generic).toHaveAttribute('data-amount', '250');

  await searchCatalog(page, 'Kinder Bueno');
  await expect(page.getByTestId('catalog-search-results').locator('img').first()).toBeVisible();
  await expect(page.getByTestId('catalog-product')).toBeVisible();
  await expect(page.getByTestId('catalog-product').locator('h2')).not.toContainText(/mini/i);
  await expect(page.getByTestId('catalog-unit-select').locator('option:checked')).toHaveAttribute('data-unit-kind', 'bar');
  await expect(page.getByTestId('catalog-variant-select')).toBeVisible();
  const amountInput = page.getByTestId('catalog-amount-input');
  await amountInput.fill('');
  await expect(amountInput).toHaveValue('');
  await amountInput.fill('3');
  await expect(amountInput).toHaveValue('3');

  await searchCatalog(page, BUENO_GTIN);
  await expect(page.getByTestId('catalog-calibration')).not.toHaveAttribute('open', '');
  await page.getByTestId('catalog-calibration').locator('summary').click();
  await page.getByTestId('catalog-calibration-unit').selectOption('bar');
  await page.getByTestId('catalog-calibration-count').fill('10');
  await page.getByTestId('catalog-calibration-weight').fill('200');
  await expect(page.getByTestId('catalog-calibration')).toContainText('20 g je Riegel gespeichert.');
  await searchCatalog(page, BUENO_GTIN);
  await expect(page.getByTestId('catalog-unit-select').locator('option:checked')).toHaveAttribute('data-unit-provenance', 'user-calibration');
  await expect(page.getByTestId('catalog-unit-select').locator('option:checked')).toHaveAttribute('data-unit-weight-g', '20');
});

test('priorisiert Klinikwerte im Hybridmodus und paginiert Klinik- sowie Gesamtkatalog', async ({ page }) => {
  await openCatalogApp(page);
  await expectCatalogReady(page);

  await page.getByRole('button', { name: 'Einstellungen', exact: true }).click();
  await expect(page.getByTestId('clinic-mode-select')).toHaveValue('hybrid');
  await page.getByRole('button', { name: 'Rechner', exact: true }).click();
  await searchCatalog(page, 'Grahambrot');
  await expect(page.getByTestId('catalog-product')).toContainText(/Klinikwert/i);
  await expect(page.getByTestId('catalog-product').getByAltText('Klinikum Leverkusen')).toBeVisible();
  await page.getByTestId('catalog-product-photo').setInputFiles(fileURLToPath(new URL('../public-template/generic-foods/rice-cooked.png', import.meta.url)));
  await expect(page.locator('.product-photo-message')).toContainText('Produktfoto lokal gespeichert');
  await expect(page.getByTestId('catalog-product').getByAltText('Grahambrot')).toHaveAttribute('src', /^data:image\//);
  await page.getByTestId('catalog-calibration-unit').selectOption('portion');
  await page.getByTestId('catalog-calibration-count').fill('2');
  await page.getByTestId('catalog-calibration-weight').fill('100');
  await expect(page.getByTestId('catalog-calibration')).toContainText('50 g je Portion gespeichert.');
  await searchCatalog(page, 'Grahambrot');
  await expect(page.getByTestId('catalog-unit-select').locator('option:checked')).toHaveAttribute('data-unit-provenance', 'user-calibration');
  await expect(page.getByTestId('catalog-product')).toHaveAttribute('data-amount', '1');

  await searchCatalog(page, 'Reis');
  await expect(page.getByTestId('catalog-product')).toContainText(/Klinikwert/i);
  await expect(page.getByTestId('catalog-product').getByAltText('Milchreis')).toBeVisible();
  await expect(page.getByTestId('catalog-search-results')).toHaveAttribute('data-result-count', '20');
  const pagination = page.getByRole('navigation', { name: 'Weitere passende Produkte' });
  await expect(pagination.getByRole('button', { name: 'Weiter →' })).toBeEnabled();
  await pagination.getByRole('button', { name: 'Weiter →' }).click();
  await expect(pagination).toContainText('Seite 2');
  await expect(page.getByTestId('catalog-unit-select')).not.toContainText('Kilogramm');

  await page.getByRole('button', { name: 'Einstellungen', exact: true }).click();
  await page.getByTestId('clinic-mode-select').selectOption('clinic-only');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expectCatalogReady(page);
  await expect(page.getByTestId('clinic-catalog-browser')).toContainText('105 Einträge');
  await expect(page.getByTestId('clinic-catalog-browser').getByRole('button')).toHaveCount(22);
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
  expect(manifest.database.file).toBe(CATALOG_DATABASE_FILENAME);
  const corrupted = Buffer.from('sentinel-corrupt-sqlite-update', 'utf8');
  let corruptDatabaseRequests = 0;

  await page.route('**/catalog/manifest.json', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ...manifest,
        database: {
          ...manifest.database,
          bytes: corrupted.byteLength,
          sha256: '0'.repeat(64),
        },
      }),
    });
  });
  await page.route(`**/catalog/${CATALOG_DATABASE_FILENAME}`, async (route) => {
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
