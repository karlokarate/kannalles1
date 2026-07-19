import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  expectCatalogReady,
  openCatalogApp
} from './catalog-harness';

async function setCatalogOnly(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Einstellungen', exact: true }).click();
  await page.getByTestId('clinic-mode-select').selectOption('off');
  await page.getByRole('button', { name: 'Rechner', exact: true }).click();
}

async function submitCompound(page: Page, input: string): Promise<void> {
  await page.getByTestId('catalog-search-input').fill(input);
  await page.getByTestId('catalog-search-submit').click();
  await expect(
    page.getByTestId('meal-summary').or(page.getByTestId('smart-unit-overlay')).first()
  ).toBeVisible({ timeout: 30_000 });
}

function recognizedProducts(page: Page): Locator {
  return page.getByTestId('meal-item');
}

test('„ein halbes Brötchen mit Nutella“ interpretiert beide Produkte als Portion', async ({ page }) => {
  await openCatalogApp(page);
  await expectCatalogReady(page);
  await setCatalogOnly(page);
  await submitCompound(page, 'ein halbes Brötchen mit Nutella');

  const products = recognizedProducts(page);
  await expect(products).toHaveCount(2);

  const roll = products.filter({ hasText: /Brötchen/i });
  const spread = products.filter({ hasText: /Nutella/i });
  await expect(roll).toHaveCount(1);
  await expect(spread).toHaveCount(1);
  await expect(roll.getByRole('spinbutton', { name: /Brötchen.*Menge/i })).toHaveValue('0.5');
  await expect(spread.getByRole('spinbutton', { name: /Nutella.*Menge/i })).toHaveValue('1');

  for (const item of [roll, spread]) {
    const unit = item.getByRole('combobox', { name: /Einheit/i });
    const selectedText = await unit.locator('option:checked').textContent();
    expect(selectedText).toMatch(/Portion/i);
  }
});

test('jede fehlende Portionsgröße wird generisch und produktspezifisch abgefragt', async ({ page }) => {
  await openCatalogApp(page);
  await expectCatalogReady(page);
  await setCatalogOnly(page);
  await submitCompound(page, 'ein halbes Brötchen mit Nutella');

  const pending = page.locator('[data-calculation-status="pending-unit-size"]');
  const promptCards = page.locator('[data-testid^="pending-smart-unit-"]');
  const pendingCount = await pending.count();
  await expect(promptCards).toHaveCount(pendingCount);

  for (let index = 0; index < pendingCount; index += 1) {
    const item = pending.nth(index);
    await expect(item.getByRole('combobox', { name: /Einheit/i })).toHaveValue('portion');
    const prompt = promptCards.nth(index);
    await expect(prompt).toHaveAttribute('data-unit-kind', 'portion');
    await expect(prompt).toContainText('Wie viel Gramm wiegt eine Portion?');
    await expect(prompt.getByRole('button', { name: 'Größe übernehmen' })).toBeDisabled();
  }

  // Products that already carry an exact manufacturer serving are calculated
  // immediately and therefore deliberately do not create a redundant prompt.
  const calculated = page.locator('[data-testid="meal-item"]:not([data-calculation-status="pending-unit-size"])');
  expect(await calculated.count() + pendingCount).toBe(2);
});

test('explizite Einheiten innerhalb einer Mehrprodukteingabe bleiben maßgeblich', async ({ page }) => {
  await openCatalogApp(page);
  await expectCatalogReady(page);
  await setCatalogOnly(page);
  await submitCompound(page, 'ein halbes Brötchen mit 15 g Nutella');

  const products = recognizedProducts(page);
  const roll = products.filter({ hasText: /Brötchen/i });
  const spread = products.filter({ hasText: /Nutella/i });
  await expect(roll.getByRole('combobox', { name: /Einheit/i }).locator('option:checked')).toContainText('Portion');
  await expect(spread.getByRole('combobox', { name: /Einheit/i }).locator('option:checked')).toContainText('Gramm');
  await expect(spread.getByRole('spinbutton', { name: /Nutella.*Menge/i })).toHaveValue('15');
});
