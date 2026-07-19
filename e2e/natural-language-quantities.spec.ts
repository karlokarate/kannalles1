import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  expectCatalogReady,
  openCatalogApp,
  readRequiredNumber,
  searchCatalog
} from './catalog-harness';

async function setCatalogOnly(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Einstellungen', exact: true }).click();
  await page.getByTestId('clinic-mode-select').selectOption('off');
  await page.getByRole('button', { name: 'Rechner', exact: true }).click();
}

async function selectedEdibleUnit(page: Page): Promise<Locator | null> {
  const selected = page.getByTestId('catalog-unit-select').locator('option:checked');
  if (!await selected.count()) return null;
  const kind = await selected.getAttribute('data-unit-kind');
  const weight = Number(await selected.getAttribute('data-unit-weight-g'));
  return ['piece', 'bar', 'slice', 'portion'].includes(kind ?? '') && Number.isFinite(weight) && weight > 1
    ? selected
    : null;
}

async function chooseBrötchenWithStructuredUnit(page: Page): Promise<Locator> {
  const product = page.getByTestId('catalog-product');
  if (await product.isVisible().catch(() => false) && await selectedEdibleUnit(page)) return product;

  const results = page.getByTestId('catalog-search-result');
  const count = await results.count();
  for (let index = 0; index < count; index += 1) {
    const candidate = results.nth(index);
    if (await candidate.getAttribute('data-catalog-eligible') !== 'true') continue;
    await candidate.click();
    await expect(product).toBeVisible();
    if (await selectedEdibleUnit(page)) return product;
  }
  throw new Error('Kein Brötchen-Treffer mit belastbarer strukturierter Einzel- oder Portionsmenge gefunden.');
}

test('„Ein halbes Brötchen“ wird als 0,5 der belegten Brötchen-Einheit berechnet', async ({ page }) => {
  await openCatalogApp(page);
  await expectCatalogReady(page);
  await setCatalogOnly(page);
  await searchCatalog(page, 'Ein halbes Brötchen');

  const product = await chooseBrötchenWithStructuredUnit(page);
  await expect(product).toHaveAttribute('data-amount', '0.5');
  await expect(product.getByRole('heading', { level: 2 })).toContainText(/Brötchen/i);
  await expect(product.getByRole('heading', { level: 2 })).not.toContainText(/halbes/i);

  const selected = page.getByTestId('catalog-unit-select').locator('option:checked');
  const unitWeightG = await readRequiredNumber(selected, 'data-unit-weight-g');
  expect(unitWeightG).toBeGreaterThan(1);

  const calculation = page.getByTestId('catalog-calculation');
  await expect(calculation).toHaveAttribute('data-status', 'calculated');
  expect(await readRequiredNumber(calculation, 'data-total-mass-g')).toBeCloseTo(0.5 * unitWeightG, 12);
  const carbsPer100 = await readRequiredNumber(product, 'data-carbs-per-100-g');
  expect(await readRequiredNumber(calculation, 'data-total-carbs-g'))
    .toBeCloseTo(0.5 * unitWeightG * carbsPer100 / 100, 12);
});

test('symbolische und gesprochene Brüche erreichen dieselbe Parsersemantik', async ({ page }) => {
  await openCatalogApp(page);
  await expectCatalogReady(page);
  await setCatalogOnly(page);

  for (const input of ['½ Brötchen', 'null komma fünf Brötchen']) {
    await searchCatalog(page, input);
    const product = await chooseBrötchenWithStructuredUnit(page);
    await expect(product).toHaveAttribute('data-amount', '0.5');
    await page.getByRole('button', { name: 'Suche zurücksetzen' }).click();
  }
});
