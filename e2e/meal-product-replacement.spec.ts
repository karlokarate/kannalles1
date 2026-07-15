import { expect, test } from '@playwright/test';
import { expectCatalogReady, openCatalogApp, searchCatalog } from './catalog-harness';

test('Produkt einer Gesamtrechnung lässt sich durch ein lokales Alternativprodukt ersetzen', async ({ page }) => {
  await openCatalogApp(page);
  await expectCatalogReady(page);
  await page.getByRole('button', { name: 'Einstellungen', exact: true }).click();
  await page.getByTestId('clinic-mode-select').selectOption('off');
  await page.getByRole('button', { name: 'Rechner', exact: true }).click();

  await searchCatalog(page, 'Reis');
  await expect(page.getByTestId('catalog-product')).toContainText('Reis, gekocht');
  await page.getByTestId('catalog-amount-input').fill('100');
  await page.getByRole('button', { name: '+ Zur Gesamtrechnung' }).click();

  await searchCatalog(page, 'Nudeln');
  await expect(page.getByTestId('catalog-product')).toContainText('Nudeln, gekocht');
  await page.getByTestId('catalog-amount-input').fill('150');
  await page.getByRole('button', { name: '+ Zur Gesamtrechnung' }).click();
  await page.getByTestId('meal-floating-total').click();

  await expect(page.getByTestId('meal-item')).toHaveCount(2);
  await expect(page.getByTestId('meal-replacement-panel')).toBeVisible();
  const totalBefore = Number(await page.getByTestId('meal-total').getAttribute('data-total-carbs-g'));

  const riceReplacement = page.getByTestId('meal-product-replace').filter({ hasText: 'Reis, gekocht' });
  await riceReplacement.click();
  await expect(page.getByTestId('meal-replacement-context')).toContainText('Reis, gekocht ersetzen');

  await page.getByTestId('catalog-search-input').fill('Kartoffeln');
  await page.getByTestId('catalog-search-submit').click();
  await expect(page.getByTestId('catalog-product')).toContainText('Kartoffeln, gekocht');
  await expect(page.getByTestId('catalog-amount-input')).toHaveValue('100');
  await page.getByRole('button', { name: /Änderung übernehmen|Zur Gesamtrechnung/ }).click();

  await expect(page.getByTestId('meal-summary')).toBeVisible();
  await expect(page.getByTestId('meal-item')).toHaveCount(2);
  await expect(page.getByTestId('meal-item').filter({ hasText: 'Reis, gekocht' })).toHaveCount(0);
  await expect(page.getByTestId('meal-item').filter({ hasText: 'Kartoffeln, gekocht' })).toHaveCount(1);
  await expect(page.getByLabel('Kartoffeln, gekocht: Menge')).toHaveValue('100');
  await expect(page.getByLabel('Nudeln, gekocht: Menge')).toHaveValue('150');
  await expect(page.getByRole('status')).toContainText('Reis, gekocht wurde durch Kartoffeln, gekocht ersetzt');
  const totalAfter = Number(await page.getByTestId('meal-total').getAttribute('data-total-carbs-g'));
  expect(totalAfter).not.toBe(totalBefore);

  await page.getByRole('button', { name: 'Verlauf', exact: true }).click();
  await page.getByRole('button', { name: 'Öffnen & verwenden' }).click();
  await expect(page.getByTestId('meal-item')).toHaveCount(2);

  const potatoReplacement = page.getByTestId('meal-product-replace').filter({ hasText: 'Kartoffeln, gekocht' });
  await potatoReplacement.click();
  await page.getByTestId('catalog-search-input').fill('Reis');
  await page.getByTestId('catalog-search-submit').click();
  await expect(page.getByTestId('catalog-product')).toContainText('Reis, gekocht');
  await expect(page.getByTestId('catalog-amount-input')).toHaveValue('100');
  await page.getByRole('button', { name: /Änderung übernehmen|Zur Gesamtrechnung/ }).click();

  await expect(page.getByTestId('meal-summary')).toBeVisible();
  await expect(page.getByTestId('meal-item')).toHaveCount(2);
  await expect(page.getByTestId('meal-item').filter({ hasText: 'Kartoffeln, gekocht' })).toHaveCount(0);
  await expect(page.getByTestId('meal-item').filter({ hasText: 'Reis, gekocht' })).toHaveCount(1);
  await expect(page.getByLabel('Reis, gekocht: Menge')).toHaveValue('100');
});
