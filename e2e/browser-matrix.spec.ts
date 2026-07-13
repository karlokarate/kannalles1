import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import {
  collectForbiddenProductRequests,
  expectCatalogReady,
  openCatalogApp,
  searchCatalog,
} from './catalog-harness';

test('echter Produktionskatalog startet und sucht in der Browsermatrix', async ({ page }) => {
  const forbidden = collectForbiddenProductRequests(page);
  await openCatalogApp(page);
  await expectCatalogReady(page);
  await searchCatalog(page, 'Vollkornbrot');

  const results = page.getByTestId('catalog-search-result');
  await expect(results.first()).toContainText(/Vollkornbrot/i);
  await expect(results.first()).toHaveAttribute('data-rank-ordinal', /^\d+$/);

  const overflow = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    content: document.documentElement.scrollWidth,
  }));
  expect(overflow.content).toBeLessThanOrEqual(overflow.viewport + 1);

  const accessibility = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(accessibility.violations).toEqual([]);
  forbidden.assertNone();
});
