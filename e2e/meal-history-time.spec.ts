import { expect, test } from '@playwright/test';
import {
  BUENO_GTIN,
  expectCatalogReady,
  openCatalogApp,
  searchCatalog
} from './catalog-harness';

interface StoredMeal {
  id: string;
  createdAt: string;
  items: unknown[];
}

test('automatisch gespeicherte Rechnungen enthalten den vollständigen Berechnungszeitpunkt', async ({ page }) => {
  await openCatalogApp(page);
  await expectCatalogReady(page);
  const beforeCalculation = Date.now();

  await searchCatalog(page, BUENO_GTIN);
  await page.getByTestId('meal-floating-add').click();

  const storedMeal = await expect.poll(async (): Promise<StoredMeal | null> => page.evaluate(() => {
    const raw = localStorage.getItem('kh-checker:offline-user-data:v2');
    if (!raw) return null;
    const value = JSON.parse(raw) as { meals?: StoredMeal[] };
    return value.meals?.[0] ?? null;
  })).not.toBeNull().then(async () => page.evaluate(() => {
    const value = JSON.parse(localStorage.getItem('kh-checker:offline-user-data:v2') ?? '{}') as { meals?: StoredMeal[] };
    return value.meals?.[0] ?? null;
  }));

  expect(storedMeal).not.toBeNull();
  if (!storedMeal) throw new Error('Automatisch gespeicherte Rechnung fehlt.');
  expect(storedMeal.items).toHaveLength(1);
  expect(storedMeal.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  const performedAt = Date.parse(storedMeal.createdAt);
  expect(performedAt).toBeGreaterThanOrEqual(beforeCalculation);
  expect(performedAt).toBeLessThanOrEqual(Date.now());

  await page.getByRole('button', { name: 'Verlauf', exact: true }).click();
  const historyEntry = page.getByTestId('saved-meal-history-entry').first();
  await expect(historyEntry).toBeVisible();
  await expect(historyEntry).toHaveAttribute('data-performed-at', storedMeal.createdAt);
  await expect(historyEntry).toContainText('Berechnet am');
  await expect(historyEntry).toContainText(/\d{1,2}:\d{2}\s*Uhr/);
});
