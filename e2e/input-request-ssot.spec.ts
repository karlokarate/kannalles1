import { expect, test, type Page } from '@playwright/test';
import {
  expectCatalogReady,
  openCatalogApp,
  readRequiredNumber,
  searchCatalog
} from './catalog-harness';

const SALT_STICKS_GTIN = '20005627';

async function setCatalogOnly(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Einstellungen', exact: true }).click();
  await page.getByTestId('clinic-mode-select').selectOption('off');
  await page.getByRole('button', { name: 'Rechner', exact: true }).click();
}

async function rememberCurrentProduct(page: Page): Promise<void> {
  const favoriteButton = page.locator('.favorite-button');
  if (await favoriteButton.getAttribute('aria-pressed') !== 'true') {
    await favoriteButton.click();
  }
  await expect(favoriteButton).toHaveAttribute('aria-pressed', 'true');
}

test('„24 Salzstangen“ behält 24 als SSOT, wenn ein Favorit asynchron priorisiert wird', async ({ page }) => {
  await openCatalogApp(page);
  await expectCatalogReady(page);
  await setCatalogOnly(page);

  // Reproduce the exact prerequisite from the user report: the Snack Day item
  // is already a local favorite before the natural-language name search.
  await searchCatalog(page, SALT_STICKS_GTIN);
  await expect(page.getByTestId('catalog-product')).toHaveAttribute('data-gtin', SALT_STICKS_GTIN);
  await rememberCurrentProduct(page);

  await page.getByRole('button', { name: 'Suche zurücksetzen' }).click();
  await searchCatalog(page, '24 Salzstangen');

  const product = page.getByTestId('catalog-product');
  await expect(product).toHaveAttribute('data-gtin', SALT_STICKS_GTIN);
  await expect(product).toHaveAttribute('data-amount', '24');
  await expect(page.locator('.favorite-button')).toHaveAttribute('aria-pressed', 'true');

  // Give the asynchronous favorite-loading effect another turn. The original
  // bug appeared only after that effect reparsed the canonical query.
  await page.waitForTimeout(750);
  await expect(product).toHaveAttribute('data-amount', '24');
  await expect(page.getByTestId('catalog-amount-input')).toHaveValue('24');

  const selected = page.getByTestId('catalog-unit-select').locator('option:checked');
  const unitWeightG = await readRequiredNumber(selected, 'data-unit-weight-g');
  const calculation = page.getByTestId('catalog-calculation');
  await expect(calculation).toHaveAttribute('data-status', 'calculated');
  expect(await readRequiredNumber(calculation, 'data-total-mass-g'))
    .toBeCloseTo(24 * unitWeightG, 12);
});

test('Produktvarianten und Kalibrierung dürfen die erkannte Menge nicht zurück auf 1 setzen', async ({ page }) => {
  await openCatalogApp(page);
  await expectCatalogReady(page);
  await setCatalogOnly(page);
  await searchCatalog(page, '24 Salzstangen');

  const product = page.getByTestId('catalog-product');
  await expect(product).toHaveAttribute('data-amount', '24');

  const variantSelect = page.getByTestId('catalog-variant-select');
  if (await variantSelect.isVisible().catch(() => false)) {
    const options = variantSelect.locator('option');
    if (await options.count() > 1) {
      const current = await variantSelect.inputValue();
      const alternative = await options.evaluateAll((nodes, selected) =>
        nodes.map((node) => (node as HTMLOptionElement).value).find((value) => value !== selected) ?? null,
      current);
      if (alternative) {
        await variantSelect.selectOption(alternative);
        await expect(product).toHaveAttribute('data-amount', '24');
      }
    }
  }

  const calibration = page.getByTestId('catalog-calibration');
  if (await calibration.isVisible().catch(() => false)) {
    const isOpen = await calibration.evaluate((element) => (element as HTMLDetailsElement).open);
    if (!isOpen) await calibration.locator('summary').click();
    await page.getByTestId('catalog-calibration-unit').selectOption('piece');
    await page.getByTestId('catalog-calibration-count').fill('24');
    await page.getByTestId('catalog-calibration-weight').fill('120');
    await expect(calibration).toContainText('5 g je Stück gespeichert.');
    await expect(product).toHaveAttribute('data-amount', '24');
  }
});

test('„13 Salzstangen“ verwendet automatisch die persönliche Standard-Portion mit 0,4 g', async ({ page }) => {
  await openCatalogApp(page);
  await expectCatalogReady(page);
  await setCatalogOnly(page);

  await searchCatalog(page, SALT_STICKS_GTIN);
  const product = page.getByTestId('catalog-product');
  await expect(product).toHaveAttribute('data-gtin', SALT_STICKS_GTIN);
  await rememberCurrentProduct(page);

  const calibration = page.getByTestId('catalog-calibration');
  const isOpen = await calibration.evaluate((element) => (element as HTMLDetailsElement).open);
  if (!isOpen) await calibration.locator('summary').click();
  await page.getByTestId('catalog-calibration-unit').selectOption('portion');
  await page.getByTestId('catalog-calibration-count').fill('10');
  await page.getByTestId('catalog-calibration-weight').fill('4');
  await expect(calibration).toContainText('0,4 g je Portion gespeichert.');

  await page.getByRole('button', { name: 'Suche zurücksetzen' }).click();
  await searchCatalog(page, '13 Salzstangen');

  await expect(product).toHaveAttribute('data-gtin', SALT_STICKS_GTIN);
  await expect(product).toHaveAttribute('data-amount', '13');
  await page.waitForTimeout(750);

  const selected = page.getByTestId('catalog-unit-select').locator('option:checked');
  await expect(selected).toHaveAttribute('data-unit-kind', 'portion');
  await expect(selected).toHaveAttribute('data-unit-provenance', 'user-calibration');
  await expect(selected).toHaveAttribute('data-unit-weight-g', '0.4');
  await expect(page.getByTestId('catalog-amount-input')).toHaveValue('13');

  const calculation = page.getByTestId('catalog-calculation');
  await expect(calculation).toHaveAttribute('data-status', 'calculated');
  expect(await readRequiredNumber(calculation, 'data-total-mass-g'))
    .toBeCloseTo(5.2, 12);
  const carbohydratesPer100 = await readRequiredNumber(product, 'data-carbs-per-100-g');
  expect(await readRequiredNumber(calculation, 'data-total-carbs-g'))
    .toBeCloseTo(5.2 * carbohydratesPer100 / 100, 12);
});
