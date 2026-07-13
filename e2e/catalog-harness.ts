import { expect, type Locator, type Page, type Request } from '@playwright/test';

export const EXPECTED_PRODUCT_COUNT = 317_579;
export const BUENO_GTIN = '4008400322728';

const forbiddenProductAuthority = [
  /search\.openfoodfacts\.org/i,
  /world\.openfoodfacts\.org\/(?:cgi\/search\.pl|api\/v\d+(?:\.\d+)?\/product)/i,
  /\/api\/v1\/(?:search|product)(?:\/|\?|$)/i,
  /api\.openai\.com/i,
  /\/v1\/(?:chat\/completions|responses)(?:\?|$)/i,
];

export function collectForbiddenProductRequests(page: Page): {
  requests: string[];
  assertNone(): void;
} {
  const requests: string[] = [];
  page.on('request', (request: Request) => {
    if (forbiddenProductAuthority.some((pattern) => pattern.test(request.url()))) {
      requests.push(request.url());
    }
  });
  return {
    requests,
    assertNone() {
      expect(requests, 'Der Browser darf keine entfernte Produkt- oder AI-Autorität aufrufen.').toEqual([]);
    },
  };
}

export function catalogStatus(page: Page): Locator {
  return page.getByTestId('catalog-status');
}

export async function openCatalogApp(page: Page): Promise<void> {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page).toHaveTitle(/KH Checker/i);
  await expect(page.getByTestId('catalog-search-input')).toBeVisible();
}

export async function expectCatalogReady(page: Page): Promise<Locator> {
  const status = catalogStatus(page);
  await expect(status).toBeVisible({ timeout: 120_000 });
  await expect(status).toHaveAttribute('data-state', 'ready', { timeout: 120_000 });
  await expect(status).toHaveAttribute('data-persistent', 'true');
  await expect(status).toHaveAttribute('data-product-count', String(EXPECTED_PRODUCT_COUNT));
  await expect(status).toHaveAttribute('data-catalog-version', /\S+/);
  await expect(status).toHaveAttribute('data-active-slot', /^(?:a|b)$/);
  return status;
}

export async function searchCatalog(page: Page, query: string): Promise<Locator> {
  const input = page.getByTestId('catalog-search-input');
  await input.fill(query);
  await page.getByTestId('catalog-search-submit').click();
  const outcome = page
    .getByTestId('catalog-search-results')
    .or(page.getByTestId('catalog-product'))
    .or(page.getByTestId('catalog-issue'));
  await expect(outcome.first()).toBeVisible({ timeout: 30_000 });
  return outcome.first();
}

export async function readRequiredNumber(locator: Locator, attribute: string): Promise<number> {
  const raw = await locator.getAttribute(attribute);
  expect(raw, `${attribute} muss vorhanden sein.`).not.toBeNull();
  const value = Number(raw);
  expect(Number.isFinite(value), `${attribute} muss eine endliche Zahl enthalten.`).toBe(true);
  return value;
}
