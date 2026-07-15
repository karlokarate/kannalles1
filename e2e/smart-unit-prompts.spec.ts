import { expect, test } from '@playwright/test';
import { BUENO_GTIN, expectCatalogReady, openCatalogApp, searchCatalog } from './catalog-harness';

test.describe.configure({ mode: 'serial' });

test('fragt zwei generische Portionen einzeln mit 200 g Default ab und speichert die Änderung', async ({ page }) => {
  await openCatalogApp(page);
  await expectCatalogReady(page);
  await page.getByRole('button', { name: 'Einstellungen', exact: true }).click();
  await page.getByTestId('clinic-mode-select').selectOption('off');
  await page.getByRole('button', { name: 'Rechner', exact: true }).click();

  await page.getByTestId('catalog-search-input').fill('eine Portion Nudeln und eine Portion Kartoffeln');
  await page.getByTestId('catalog-search-submit').click();

  await expect(page.getByTestId('meal-summary')).toBeVisible();
  await expect(page.getByTestId('meal-item')).toHaveCount(2);
  const prompts = page.locator('[data-testid^="meal-smart-unit-"]:not([data-testid$="-input"]):not([data-testid$="-confirm"])');
  await expect(prompts).toHaveCount(2);
  await expect(prompts.nth(0)).toHaveAttribute('data-default-value', '200');
  await expect(prompts.nth(1)).toHaveAttribute('data-default-value', '200');
  await expect(prompts.nth(0).getByRole('spinbutton')).toHaveValue('200');
  await expect(prompts.nth(1).getByRole('spinbutton')).toHaveValue('200');
  await expect.poll(async () => Number(await page.getByTestId('meal-total').getAttribute('data-total-carbs-g'))).toBeCloseTo(89.024, 10);

  const noodles = page.getByTestId('meal-item').filter({ hasText: 'Nudeln, gekocht' });
  await noodles.getByRole('spinbutton', { name: /Gramm je Portion/ }).fill('250');
  await noodles.getByRole('button', { name: 'Größe übernehmen' }).click();
  await expect(noodles.locator('.smart-unit-prompt')).toBeHidden();
  await expect.poll(async () => Number(await page.getByTestId('meal-total').getAttribute('data-total-carbs-g'))).toBeCloseTo(103.364, 10);

  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Aktuelle Rechnung zurücksetzen' }).click();
  await searchCatalog(page, 'eine Portion Nudeln');
  await expect(page.getByTestId('catalog-smart-unit-prompt')).toBeHidden();
  await expect(page.getByTestId('catalog-unit-select').locator('option:checked')).toHaveAttribute('data-unit-kind', 'portion');
  await expect(page.getByTestId('catalog-calculation')).toHaveAttribute('data-total-mass-g', '250');
});

test('verwendet bewiesene Kinder-Bueno-Riegel ohne zusätzliche Größenfrage', async ({ page }) => {
  await openCatalogApp(page);
  await expectCatalogReady(page);
  await searchCatalog(page, BUENO_GTIN);
  await expect(page.getByTestId('catalog-product')).toContainText(/Kinder Bueno/i);
  await expect(page.getByTestId('catalog-unit-select').locator('option:checked')).toHaveAttribute('data-unit-kind', 'bar');
  await expect(page.getByTestId('catalog-smart-unit-prompt')).toBeHidden();
});
