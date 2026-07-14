import { expect, test } from '@playwright/test';
import { expectCatalogReady, openCatalogApp, searchCatalog } from './catalog-harness';

test.describe.configure({ mode: 'serial' });

test('alternative product variants resolve their own serving and accept cleared and stepped amounts', async ({ page }) => {
  await openCatalogApp(page);
  await expectCatalogReady(page);
  await searchCatalog(page, 'Kinder Bueno');

  const results = page.getByTestId('catalog-search-result');
  await expect.poll(() => results.count()).toBeGreaterThan(1);
  const automaticProductId = await page.getByTestId('catalog-product').getAttribute('data-product-id');
  await results.nth(1).click();
  await expect(page.getByTestId('catalog-product')).not.toHaveAttribute('data-product-id', automaticProductId ?? '');
  await expect(page.getByTestId('catalog-unit-select').locator('option:checked')).toHaveAttribute('value', /.+/);

  const amount = page.getByTestId('catalog-amount-input');
  await amount.fill('');
  await expect(amount).toHaveValue('');
  await amount.fill('2');
  await expect(page.getByTestId('catalog-product')).toHaveAttribute('data-amount', '2');
  const before = Number(await page.getByTestId('catalog-calculation').getAttribute('data-total-carbs-g'));
  await page.getByTestId('catalog-amount-input-increment').click();
  await expect(amount).toHaveValue('3');
  await expect.poll(async () => Number(await page.getByTestId('catalog-calculation').getAttribute('data-total-carbs-g'))).toBeGreaterThan(before);
  await page.getByTestId('catalog-amount-input-decrement').click();
  await expect(amount).toHaveValue('2');
});

test('manually stored products appear in normal search and use the same quantity controls', async ({ page }) => {
  await openCatalogApp(page);
  await expectCatalogReady(page);
  await page.getByRole('button', { name: 'Manuell', exact: true }).click();
  await page.getByTestId('manual-product-label').fill('Chris Test Spezialriegel');
  await page.getByTestId('manual-product-carbs').fill('42');
  await page.getByTestId('manual-product-amount').fill('25');
  await page.getByTestId('manual-product-save').click();
  await expect(page.getByText('Produkt automatisch lokal gespeichert.')).toBeVisible();

  await page.getByRole('button', { name: 'Produkt', exact: true }).click();
  await searchCatalog(page, 'Chris Test Spezialriegel');
  const product = page.getByTestId('catalog-product');
  await expect(product).toContainText('Chris Test Spezialriegel');
  await expect(product).toContainText('Eigenes Produkt');
  await expect(product).toHaveAttribute('data-gtin', /^manual:/);
  await expect(page.getByTestId('catalog-amount-input')).toHaveValue('1');
  await page.getByTestId('catalog-amount-input-increment').click();
  await expect(page.getByTestId('catalog-amount-input')).toHaveValue('2');
  await expect(page.getByTestId('catalog-calculation')).toHaveAttribute('data-status', 'calculated');
});
