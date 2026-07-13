import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import {
  collectForbiddenProductRequests,
  catalogStatus,
  expectCatalogReady,
  openCatalogApp,
  searchCatalog,
} from './catalog-harness';

test('App-Shell, Navigation, mobiler Reflow und echter Katalog bestehen die Browsermatrix', async ({ page }, testInfo) => {
  const forbidden = collectForbiddenProductRequests(page);
  await openCatalogApp(page);

  const navigation = page.getByRole('navigation', { name: 'Hauptnavigation' });
  await expect(navigation).toBeVisible();
  for (const label of ['Rechner', 'Verlauf', 'Favoriten', 'Einstellungen']) {
    await expect(navigation.getByRole('button', { name: label, exact: true })).toBeVisible();
  }

  if (testInfo.project.name === 'webkit-iphone') {
    await expect(catalogStatus(page)).toHaveAttribute('data-state', 'unavailable', { timeout: 120_000 });
    await expect(page.getByTestId('catalog-issue')).toHaveAttribute('data-error-code', 'CATALOG_STORAGE_UNAVAILABLE');
  } else {
    await expectCatalogReady(page);
    await searchCatalog(page, 'Vollkornbrot');

    const results = page.getByTestId('catalog-search-result');
    await expect(results.first()).toContainText(/Vollkornbrot/i);
    await expect(results.first()).toHaveAttribute('data-rank-ordinal', /^\d+$/);
  }

  const overflow = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    content: document.documentElement.scrollWidth,
    overflowing: [...document.querySelectorAll<HTMLElement>('body *')]
      .filter((element) => {
        const bounds = element.getBoundingClientRect();
        return bounds.right > document.documentElement.clientWidth + 1 || bounds.left < -1;
      })
      .map((element) => element.tagName.toLowerCase()),
  }));
  expect(overflow.content).toBeLessThanOrEqual(overflow.viewport + 1);
  expect(overflow.overflowing).toEqual([]);

  const accessibility = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(accessibility.violations).toEqual([]);
  forbidden.assertNone();
});
