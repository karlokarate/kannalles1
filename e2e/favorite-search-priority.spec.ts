import { expect, test } from '@playwright/test';
import { expectCatalogReady, openCatalogApp, searchCatalog } from './catalog-harness';

test('favorisierte Produktvariante wird bei breiter Suche erster Treffer und Defaultprodukt', async ({ page }) => {
  await openCatalogApp(page);
  await expectCatalogReady(page);
  await page.getByRole('button', { name: 'Einstellungen', exact: true }).click();
  await page.getByTestId('clinic-mode-select').selectOption('off');
  await page.getByRole('button', { name: 'Rechner', exact: true }).click();

  await searchCatalog(page, 'Pizza');
  const product = page.getByTestId('catalog-product');
  const initialName = (await product.getByRole('heading').textContent())?.trim() ?? '';
  const results = page.getByTestId('catalog-search-result');
  expect(await results.count()).toBeGreaterThan(1);
  const names = await results.locator('.result-copy strong').allTextContents();
  const alternativeIndex = names.findIndex((name) => /pizza/i.test(name) && name.trim() !== initialName);
  expect(alternativeIndex).toBeGreaterThanOrEqual(0);

  await results.nth(alternativeIndex).click();
  const favoriteName = (await product.getByRole('heading').textContent())?.trim() ?? '';
  const favoriteProductId = await product.getAttribute('data-product-id');
  expect(favoriteName).not.toBe(initialName);
  expect(favoriteProductId).not.toBeNull();
  await page.getByRole('button', { name: 'Merken', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Favorit', exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Suche zurücksetzen' }).click();
  await searchCatalog(page, 'Pizza');
  await expect.poll(() => product.getAttribute('data-product-id')).toBe(favoriteProductId);
  await expect(product.getByRole('heading')).toHaveText(favoriteName);
  await expect(page.getByTestId('catalog-search-result').first().locator('.result-copy strong')).toHaveText(favoriteName);

  const reprioritizedNames = await page.getByTestId('catalog-search-result').locator('.result-copy strong').allTextContents();
  const manualAlternativeIndex = reprioritizedNames.findIndex((name) => name.trim() !== favoriteName);
  expect(manualAlternativeIndex).toBeGreaterThanOrEqual(0);
  const manualAlternativeName = reprioritizedNames[manualAlternativeIndex]?.trim() ?? '';
  await page.getByTestId('catalog-search-result').nth(manualAlternativeIndex).click();
  await expect(product.getByRole('heading')).toHaveText(manualAlternativeName);
  await page.waitForTimeout(250);
  await expect(product.getByRole('heading')).toHaveText(manualAlternativeName);
});
