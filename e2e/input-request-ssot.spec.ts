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

async function rememberSaltSticks(page: Page): Promise<void> {
  await searchCatalog(page, SALT_STICKS_GTIN);
  const product = page.getByTestId('catalog-product');
  await expect(product).toHaveAttribute('data-gtin', SALT_STICKS_GTIN);
  const favorite = product.getByRole('button', { name: /Merken|Favorit/ });
  if (await favorite.getAttribute('aria-pressed') !== 'true') await favorite.click();
  await expect(favorite).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Suche zurücksetzen' }).click();
}

test('„24 Salzstangen“ behält die erkannte Menge nach Favoriten-Promotion bis in die Gesamtrechnung', async ({ page }) => {
  await openCatalogApp(page);
  await expectCatalogReady(page);
  await setCatalogOnly(page);
  await rememberSaltSticks(page);

  await searchCatalog(page, '24 Salzstangen');
  const product = page.getByTestId('catalog-product');

  // The async favorite promotion must select the remembered product without
  // reparsing the stripped canonical query "Salzstangen" as amount 1.
  await expect(product).toHaveAttribute('data-gtin', SALT_STICKS_GTIN);
  await expect(product).toHaveAttribute('data-amount', '24');
  await expect(page.getByTestId('catalog-amount-input')).toHaveValue('24');
  await expect(product.getByRole('button', { name: 'Favorit' })).toHaveAttribute('aria-pressed', 'true');

  const selected = page.getByTestId('catalog-unit-select').locator('option:checked');
  const unitBaseValue = await readRequiredNumber(selected, 'data-unit-weight-g');
  const carbohydratesPer100 = await readRequiredNumber(product, 'data-carbs-per-100-g');
  const calculation = page.getByTestId('catalog-calculation');
  await expect(calculation).toHaveAttribute('data-status', 'calculated');
  expect(await readRequiredNumber(calculation, 'data-total-carbs-g'))
    .toBeCloseTo(24 * unitBaseValue * carbohydratesPer100 / 100, 12);

  await page.getByTestId('meal-floating-add').click();
  await expect(page.getByTestId('meal-floating-total')).toContainText('1 Produkt');
  await page.getByTestId('meal-floating-total').click();

  const mealItem = page.getByTestId('meal-item').first();
  await expect(mealItem).toContainText('Salzstangen');
  await expect(mealItem.getByRole('spinbutton', { name: /Salzstangen: Menge/ })).toHaveValue('24');
});

test('Produktvarianten lösen Einheiten neu auf, verändern aber nicht die erkannte Menge', async ({ page }) => {
  await openCatalogApp(page);
  await expectCatalogReady(page);
  await setCatalogOnly(page);
  await searchCatalog(page, '24 Salzstangen');

  const product = page.getByTestId('catalog-product');
  await expect(product).toHaveAttribute('data-amount', '24');
  const variants = page.getByTestId('catalog-variant-select');
  await expect(variants).toBeVisible();
  const options = variants.locator('option');
  expect(await options.count()).toBeGreaterThan(1);

  const current = await variants.inputValue();
  const next = await options.evaluateAll((nodes, selected) =>
    nodes.map((node) => (node as HTMLOptionElement).value).find((value) => value !== selected) ?? null,
  current);
  expect(next).not.toBeNull();
  await variants.selectOption(next ?? '');

  await expect(product).toHaveAttribute('data-amount', '24');
  await expect(page.getByTestId('catalog-amount-input')).toHaveValue('24');
});
