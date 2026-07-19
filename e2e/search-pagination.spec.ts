import { expect, test, type Page } from '@playwright/test';
import {
  expectCatalogReady,
  openCatalogApp,
  searchCatalog
} from './catalog-harness';

async function setCatalogOnly(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Einstellungen', exact: true }).click();
  await page.getByTestId('clinic-mode-select').selectOption('off');
  await page.getByRole('button', { name: 'Rechner', exact: true }).click();
}

async function visibleProductIds(page: Page): Promise<string[]> {
  return page.getByTestId('catalog-search-result').evaluateAll((nodes) =>
    nodes.map((node) => {
      const button = node as HTMLButtonElement;
      return `${button.dataset.rankOrdinal ?? ''}:${button.textContent ?? ''}`;
    })
  );
}

test('breite Katalogsuchen zeigen zwanzig Treffer pro Seite statt insgesamt nur zwanzig', async ({ page }) => {
  await openCatalogApp(page);
  await expectCatalogReady(page);
  await setCatalogOnly(page);
  await searchCatalog(page, 'Schokolade');

  const panel = page.getByTestId('catalog-search-results');
  const results = page.getByTestId('catalog-search-result');
  await expect(panel).toHaveAttribute('data-page-size', '20');
  await expect(panel).toHaveAttribute('data-page-number', '1');
  await expect(results).toHaveCount(20);
  await expect(results.first().locator('.result-position')).toHaveText('1');
  await expect(results.last().locator('.result-position')).toHaveText('20');
  const firstPage = await visibleProductIds(page);

  const next = panel.getByRole('button', { name: 'Weiter →' });
  await expect(next).toBeEnabled();
  await next.click();
  await expect(panel).toHaveAttribute('data-page-number', '2');
  await expect(results).toHaveCount(20);
  await expect(results.first().locator('.result-position')).toHaveText('21');
  await expect(results.last().locator('.result-position')).toHaveText('40');
  const secondPage = await visibleProductIds(page);
  expect(secondPage.some((id) => firstPage.includes(id))).toBe(false);

  await panel.getByRole('button', { name: 'Weiter →' }).click();
  await expect(panel).toHaveAttribute('data-page-number', '3');
  await expect(results.first().locator('.result-position')).toHaveText('41');
  expect(await results.count()).toBeGreaterThan(0);
  expect(await results.count()).toBeLessThanOrEqual(20);

  await panel.getByRole('button', { name: '← Zurück' }).click();
  await expect(panel).toHaveAttribute('data-page-number', '2');
  await expect(results.first().locator('.result-position')).toHaveText('21');
});
