import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DataSourceError,
  SEARCH_A_LICIOUS_FIELDS,
  clearApiGovernor,
  getProductByBarcode,
  searchFoodCandidates,
  searchFoodCandidatesOutcome
} from './api';
import { clearApiCache } from './storage';

beforeEach(async () => {
  clearApiGovernor();
  await clearApiCache();
  vi.useRealTimers();
});

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  clearApiGovernor();
  await clearApiCache();
});

function jsonResponse(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers }
  });
}

describe('v2.2 cache-first public API search', () => {
  it('uses Search-a-licious first in a browser runtime', async () => {
    vi.stubGlobal('window', {});
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.hostname === 'search.openfoodfacts.org' && url.pathname === '/search') {
        return jsonResponse({
          hits: [{ code: 'browser-1', product_name_de: 'Salzstangen' }],
          count: 1,
          page: 1,
          page_size: 20
        });
      }
      throw new Error(`unexpected URL: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await searchFoodCandidates('Salzstangen browser route', 10);

    expect(result.hits.map((hit) => hit.code)).toEqual(['browser-1']);
    expect(result.source).toBe('search-a-licious');
    expect(result.api_meta?.cacheStatus).toBe('network');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('sends a compact Search-a-licious request with the requested supported page size', async () => {
    vi.stubGlobal('window', {});
    let requestedUrlValue = '';
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      requestedUrlValue = String(input);
      return jsonResponse({ hits: [{ code: 'compact-1', product_name: 'Compact result' }], count: 1 });
    });
    vi.stubGlobal('fetch', fetchMock);

    await searchFoodCandidates('compact request 222', 15);
    const requestedUrl = new URL(requestedUrlValue);

    expect(requestedUrl.hostname).toBe('search.openfoodfacts.org');
    expect(requestedUrl.searchParams.get('page_size')).toBe('15');
    expect(requestedUrl.searchParams.get('langs')).toBe('de,en,main');
    expect(requestedUrl.searchParams.has('boost_phrase')).toBe(false);
    expect(requestedUrl.searchParams.get('fields')?.split(',')).toEqual(SEARCH_A_LICIOUS_FIELDS);
    expect(requestedUrl.searchParams.get('fields')).not.toContain('serving_size');
    expect(requestedUrl.searchParams.get('fields')).not.toContain('product_quantity');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('normalizes Search-a-licious taxonomy and image fields for the shared resolver model', async () => {
    vi.stubGlobal('window', {});
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      hits: [{
        code: 'normalized-1',
        product_name_de: 'Testprodukt',
        categories: [{ id: 'de:testprodukte' }],
        countries: { 'de:deutschland': 1 },
        image_url: 'https://images.openfoodfacts.org/test.jpg'
      }],
      count: 1
    })));

    const result = await searchFoodCandidates('normalize sal result 222', 10);

    expect(result.hits[0]).toMatchObject({
      code: 'normalized-1',
      categories_tags: ['de:testprodukte'],
      countries_tags: ['de:deutschland'],
      image_front_url: 'https://images.openfoodfacts.org/test.jpg'
    });
  });

  it('does not probe a same-origin server on GitHub Pages', async () => {
    vi.stubGlobal('window', {
      location: {
        origin: 'https://karlokarate.github.io',
        hostname: 'karlokarate.github.io',
        pathname: '/kannalles1/',
        protocol: 'https:'
      }
    });
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.hostname === 'search.openfoodfacts.org') {
        return jsonResponse({
          hits: [{ code: 'pages-1', product_name_de: 'Müllermilch Schoko Zero' }],
          count: 1
        });
      }
      throw new Error(`unexpected URL: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await searchFoodCandidates('Müllermilch Schoko Zero pages 222', 10);

    expect(result.hits[0]?.code).toBe('pages-1');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(new URL(String(fetchMock.mock.calls[0]?.[0])).hostname).toBe('search.openfoodfacts.org');
  });

  it('falls back once and exposes the original browser error in diagnostics', async () => {
    vi.stubGlobal('window', {});
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.hostname === 'search.openfoodfacts.org') throw new TypeError('Failed to fetch');
      return jsonResponse({ products: [{ code: 'fallback-1', product_name: 'Fallback product' }], count: 1 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await searchFoodCandidates('browser fallback diagnostics', 10);

    expect(result.hits[0]?.code).toBe('fallback-1');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.api_meta?.attempts?.map((attempt) => attempt.outcome)).toEqual([
      'network-error',
      'success'
    ]);
    expect(result.api_meta?.attempts?.[0]?.errorName).toBe('TypeError');
    expect(result.api_meta?.attempts?.[0]?.errorMessage).toBe('Failed to fetch');
  });

  it('reuses a backend-independent canonical cache for Kinder Bueno spelling variants', async () => {
    vi.stubGlobal('window', {});
    const fetchMock = vi.fn(async () => jsonResponse({
      hits: [{ code: '8000500037560', product_name: 'Kinder Bueno', quantity: '2 x 21.5 g' }],
      count: 1
    }));
    vi.stubGlobal('fetch', fetchMock);

    const first = await searchFoodCandidates('Kinder Bueno', 10);
    const second = await searchFoodCandidates('Kinderbueno', 10);

    expect(first.hits[0]?.code).toBe('8000500037560');
    expect(second.hits[0]?.code).toBe('8000500037560');
    expect(second.api_meta?.cacheStatus).toBe('fresh-cache');
    expect(second.api_meta?.backend).toBe('query-cache');
    expect(second.api_meta?.networkAttempted).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('disables Search-a-licious in legacy-only search mode (v2)', async () => {
    vi.stubGlobal('window', {});
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.hostname === 'world.openfoodfacts.org' && url.pathname === '/cgi/search.pl') {
        return jsonResponse({
          products: [{ code: 'legacy-only-1', product_name_de: 'Pizza Margharita' }],
          count: 1,
          page: 1,
          page_size: 15
        });
      }
      throw new Error(`unexpected URL in legacy-only mode: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await searchFoodCandidates('Pizza Margharita', 15, undefined, { searchApiMode: 'legacy-only' });

    expect(result.source).toBe('open-food-facts-legacy');
    expect(result.hits.map((hit) => hit.code)).toEqual(['legacy-only-1']);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('passes search_api=v2 to gateway in legacy-only search mode', async () => {
    let requestedUrl = '';
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      requestedUrl = String(input);
      return jsonResponse({
        hits: [{ code: 'gateway-legacy-search', product_name_de: 'Pizza Margharita' }],
        count: 1,
        source: 'gateway'
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    await searchFoodCandidates('Pizza Margharita', 15, undefined, {
      gatewayUrl: 'https://gateway.example/',
      searchApiMode: 'legacy-only'
    });

    const url = new URL(requestedUrl);
    expect(url.origin).toBe('https://gateway.example');
    expect(url.pathname).toBe('/api/search');
    expect(url.searchParams.get('search_api')).toBe('v2');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('never returns a cached search result to an already aborted UI operation', async () => {
    vi.stubGlobal('window', {});
    const fetchMock = vi.fn(async () => jsonResponse({
      hits: [{ code: 'abort-cache-1', product_name: 'Cached result' }],
      count: 1
    }));
    vi.stubGlobal('fetch', fetchMock);

    await searchFoodCandidates('abort cached operation 2207', 10);
    const controller = new AbortController();
    controller.abort();

    await expect(searchFoodCandidates('abort cached operation 2207', 10, controller.signal)).rejects.toMatchObject({
      name: 'DataSourceError',
      kind: 'aborted'
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('deduplicates identical concurrent network requests and caches the shared result', async () => {
    let resolveResponse!: (value: Response) => void;
    const fetchMock = vi.fn(() => new Promise<Response>((resolve) => { resolveResponse = resolve; }));
    vi.stubGlobal('fetch', fetchMock);

    const first = searchFoodCandidates('Concurrent cache test 2201', 10);
    const second = searchFoodCandidates('Concurrent cache test 2201', 10);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    resolveResponse(jsonResponse({ hits: [{ code: '1', product_name: 'Shared' }], count: 1 }));

    const [a, b] = await Promise.all([first, second]);
    const third = await searchFoodCandidates('Concurrent cache test 2201', 10);

    expect(a.hits).toHaveLength(1);
    expect(b.hits).toHaveLength(1);
    expect(third.api_meta?.cacheStatus).toBe('fresh-cache');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });


  it('keeps the shared request alive when a UI retry aborts only its first subscriber', async () => {
    vi.stubGlobal('window', {});
    let resolveResponse!: (value: Response) => void;
    const fetchMock = vi.fn(() => new Promise<Response>((resolve) => { resolveResponse = resolve; }));
    vi.stubGlobal('fetch', fetchMock);

    const firstController = new AbortController();
    const first = searchFoodCandidates('instant retry shared task 2204', 10, firstController.signal)
      .then(() => null, (error: unknown) => error);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    firstController.abort();
    await expect(first).resolves.toMatchObject({ name: 'DataSourceError', kind: 'aborted' });

    const retry = searchFoodCandidates('instant retry shared task 2204', 10);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    resolveResponse(jsonResponse({ hits: [{ code: 'retry-1', product_name: 'Shared retry' }], count: 1 }));

    const result = await retry;
    expect(result.hits[0]?.code).toBe('retry-1');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('uses the legacy fallback after a valid zero-hit Search-a-licious response', async () => {
    vi.stubGlobal('window', {});
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.hostname === 'search.openfoodfacts.org') return jsonResponse({ hits: [], count: 0 });
      return jsonResponse({ products: [{ code: 'zero-fallback-1', product_name: 'Legacy match' }], count: 1 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const first = await searchFoodCandidates('zero hit fallback 222', 10);
    const second = await searchFoodCandidates('zero hit fallback 222', 10);

    expect(first.hits[0]?.code).toBe('zero-fallback-1');
    expect(first.api_meta?.attempts?.map((attempt) => attempt.backend)).toEqual([
      'search-a-licious',
      'open-food-facts-legacy'
    ]);
    expect(second.api_meta?.cacheStatus).toBe('fresh-cache');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('marks a zero-hit primary response as the explicit fallback reason', async () => {
    vi.stubGlobal('window', {});
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.hostname === 'search.openfoodfacts.org') return jsonResponse({ hits: [], count: 0 });
      return jsonResponse({ products: [{ code: 'empty-reason-1', product_name: 'Legacy match' }], count: 1 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await searchFoodCandidates('empty reason fallback 222', 10);

    expect(result.hits[0]?.code).toBe('empty-reason-1');
    expect(result.api_meta?.fallbackReason).toBe('empty-result');
  });

  it('returns a typed empty result when both backends are reachable without hits', async () => {
    vi.stubGlobal('window', {});
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      return url.hostname === 'search.openfoodfacts.org'
        ? jsonResponse({ hits: [], count: 0 })
        : jsonResponse({ products: [], count: 0 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const first = await searchFoodCandidates('definitely empty query 222', 10);
    const second = await searchFoodCandidates('definitely empty query 222', 10);

    expect(first.hits).toEqual([]);
    expect(first.api_meta?.attempts).toHaveLength(2);
    expect(second.api_meta?.cacheStatus).toBe('fresh-cache');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('limits the transmitted search term to 120 characters', async () => {
    vi.stubGlobal('window', {});
    let transmitted = '';
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      transmitted = url.searchParams.get('q') ?? '';
      return jsonResponse({ hits: [{ code: 'length-1' }], count: 1 });
    });
    vi.stubGlobal('fetch', fetchMock);

    await searchFoodCandidates(`Salzstangen ${'x'.repeat(300)}`, 10);

    expect(transmitted.length).toBeLessThanOrEqual(120);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not repeat upstream calls in the browser when a gateway returned embedded diagnostics', async () => {
    vi.stubGlobal('window', {});
    const upstreamAttempt = {
      backend: 'search-a-licious',
      label: 'Search-a-licious',
      url: 'https://search.openfoodfacts.org/search?q=test',
      startedAt: new Date().toISOString(),
      durationMs: 42,
      outcome: 'network-error',
      errorName: 'TypeError',
      errorMessage: 'fetch failed'
    };
    const fetchMock = vi.fn(async () => jsonResponse({ error: 'failed', attempts: [upstreamAttempt] }, 502));
    vi.stubGlobal('fetch', fetchMock);

    await expect(searchFoodCandidates('gateway authoritative failure 2206', 10, undefined, {
      gatewayUrl: 'https://gateway.example/'
    })).rejects.toMatchObject({ name: 'DataSourceError' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('treats Retry-After as diagnostics only and never installs a local request lock', async () => {
    vi.stubGlobal('window', {});
    const fetchMock = vi.fn(async () => jsonResponse({ error: 'limit' }, 429, { 'Retry-After': '12' }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(searchFoodCandidates('rate limit no lock a', 10)).rejects.toMatchObject({
      name: 'DataSourceError',
      kind: 'rate-limit'
    });
    await expect(searchFoodCandidates('rate limit no lock b', 10)).rejects.toBeInstanceOf(DataSourceError);

    // Two backends are attempted for each click; the second click is not blocked locally.
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('keeps stale cached search data when both public backends later fail', async () => {
    vi.stubGlobal('window', {});
    const start = new Date('2026-01-01T10:00:00Z');
    vi.useFakeTimers();
    vi.setSystemTime(start);
    const fetchMock = vi.fn(async () => jsonResponse({
      hits: [{ code: 'stale-1', product_name: 'Cached product' }],
      count: 1
    }));
    vi.stubGlobal('fetch', fetchMock);

    await searchFoodCandidates('stale cache recovery 2202', 10);
    vi.setSystemTime(new Date(start.getTime() + 25 * 60 * 60 * 1000));
    fetchMock.mockImplementation(async () => { throw new TypeError('Failed to fetch'); });

    const result = await searchFoodCandidates('stale cache recovery 2202', 10);
    const secondStaleResult = await searchFoodCandidates('stale cache recovery 2202', 10);

    expect(result.hits[0]?.code).toBe('stale-1');
    expect(result.api_meta?.cacheStatus).toBe('stale-cache');
    expect(result.api_meta?.networkAttempted).toBe(true);
    expect(result.api_meta?.attempts?.some((attempt) => attempt.errorMessage === 'Failed to fetch')).toBe(true);
    expect(secondStaleResult.api_meta?.cacheStatus).toBe('stale-cache');
    // The stale result keeps its original timestamp and is not promoted to a
    // fresh 24-hour canonical cache entry after the failed refresh.
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it('returns a typed not-found outcome after two reachable empty backends', async () => {
    vi.stubGlobal('window', {});
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      return url.hostname === 'search.openfoodfacts.org'
        ? jsonResponse({ hits: [], count: 0 })
        : jsonResponse({ products: [], count: 0 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const outcome = await searchFoodCandidatesOutcome('typed empty outcome 222', 10);

    expect(outcome.status).toBe('not_found');
    expect(outcome.candidates).toEqual([]);
    expect(outcome.diagnostics.attempts).toHaveLength(2);
    expect(outcome.diagnostics.retryAllowedImmediately).toBe(true);
  });

  it('returns a typed temporarily-unavailable outcome without throwing to the UI', async () => {
    vi.stubGlobal('window', {});
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));

    const outcome = await searchFoodCandidatesOutcome('typed unavailable outcome 222', 10);

    expect(outcome.status).toBe('temporarily_unavailable');
    expect(outcome.result).toBeNull();
    expect(outcome.candidates).toEqual([]);
    expect(outcome.diagnostics.errorKind).toBe('network');
    expect(outcome.diagnostics.attempts).toHaveLength(2);
    expect(outcome.diagnostics.retryAllowedImmediately).toBe(true);
    expect(outcome.diagnostics.message).toContain('Keine öffentliche Produktsuche war erreichbar');
  });

  it('preserves exact endpoint diagnostics when no source is reachable', async () => {
    vi.stubGlobal('window', {});
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));

    try {
      await searchFoodCandidates('diagnostic hard failure 2203', 10);
      throw new Error('expected DataSourceError');
    } catch (error) {
      expect(error).toBeInstanceOf(DataSourceError);
      const typed = error as DataSourceError;
      expect(typed.attempts).toHaveLength(2);
      expect(typed.attempts.every((attempt) => attempt.errorName === 'TypeError')).toBe(true);
      expect(typed.attempts.every((attempt) => attempt.url.startsWith('https://'))).toBe(true);
    }
  });
});

describe('v2.2 product cache', () => {
  it('reuses barcode product details without a second API call', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({
      status: 'success',
      product: {
        code: '8000500037560',
        product_name: 'Kinder Bueno',
        serving_size: '21.5 g',
        serving_quantity: 21.5,
        nutriments: { carbohydrates_100g: 49.5 }
      }
    }));
    vi.stubGlobal('fetch', fetchMock);

    const first = await getProductByBarcode('8000500037560');
    const second = await getProductByBarcode('8000500037560');

    expect(first.product?.serving_quantity).toBe(21.5);
    expect(second.api_meta?.cacheStatus).toBe('fresh-cache');
    expect(second.api_meta?.backend).toBe('product-cache');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });




  it('uses carbohydrate data from the selected search hit and skips the redundant v2 detail fallback', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname.includes('/api/v3.6/product/')) {
        return jsonResponse({
          status: 'success',
          product: {
            code: '4071800001371',
            product_name_de: 'Vollkornbrot',
            quantity: '500 g',
            serving_size: '1 Scheibe (50 g)',
            serving_quantity: 50
          }
        });
      }
      throw new Error(`v2 must not be requested when the selected hit already proves carbohydrates: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await getProductByBarcode('4071800001371', undefined, {
      seedProduct: {
        code: '4071800001371',
        product_name_de: 'Vollkornbrot',
        nutriments: { carbohydrates_100g: 38.4 }
      }
    });

    expect(result.product?.serving_quantity).toBe(50);
    expect(result.product?.nutriments?.carbohydrates_100g).toBe(38.4);
    expect(result.api_meta?.attempts?.map((attempt) => attempt.backend)).toEqual(['open-food-facts-v3']);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('merges the compact v2 fallback when v3 omits carbohydrate data', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname.includes('/api/v3.6/product/')) {
        return jsonResponse({
          status: 'success',
          product: {
            code: '8000500037560',
            product_name: 'Kinder Bueno',
            quantity: '2 x 21.5 g',
            serving_size: '21.5 g',
            serving_quantity: 21.5
          }
        });
      }
      if (url.pathname.includes('/api/v2/product/')) {
        return jsonResponse({
          status: 'success',
          product: {
            code: '8000500037560',
            nutriments: { carbohydrates_100g: 49.5 }
          }
        });
      }
      throw new Error(`unexpected URL: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const first = await getProductByBarcode('8000500037560');
    const second = await getProductByBarcode('8000500037560');

    expect(first.product?.serving_quantity).toBe(21.5);
    expect(first.product?.nutriments?.carbohydrates_100g).toBe(49.5);
    expect(first.api_meta?.attempts?.map((attempt) => attempt.backend)).toEqual([
      'open-food-facts-v3',
      'open-food-facts-v2'
    ]);
    expect(second.api_meta?.cacheStatus).toBe('fresh-cache');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('returns useful v3 product data after a failed v2 enrichment without a duplicate request', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname.includes('/api/v3.6/product/')) {
        return jsonResponse({
          status: 'success',
          product: {
            code: '40000000',
            product_name: 'Teilprodukt',
            serving_size: '20 g'
          }
        });
      }
      throw new TypeError('Failed to fetch');
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await getProductByBarcode('40000000');

    expect(result.product?.product_name).toBe('Teilprodukt');
    expect(result.api_meta?.fallbackReason).toBe('network');
    expect(result.api_meta?.attempts?.map((attempt) => attempt.outcome)).toEqual([
      'success',
      'network-error'
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('reports a reachable product-not-found response as HTTP 404 instead of a network error', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ status: 'failure', code: '12345678' }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(getProductByBarcode('12345678')).rejects.toMatchObject({
      name: 'DataSourceError',
      kind: 'http',
      status: 404
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('treats a gateway 404 with embedded upstream diagnostics as authoritative', async () => {
    const upstreamAttempt = {
      backend: 'open-food-facts-v3',
      label: 'Open Food Facts API v3.6',
      url: 'https://world.openfoodfacts.org/api/v3.6/product/12345678.json',
      startedAt: new Date().toISOString(),
      durationMs: 18,
      outcome: 'success',
      status: 200
    };
    const fetchMock = vi.fn(async () => jsonResponse({
      error: 'Produktabruf fehlgeschlagen.',
      attempts: [upstreamAttempt]
    }, 404));
    vi.stubGlobal('fetch', fetchMock);

    await expect(getProductByBarcode('12345678', undefined, {
      gatewayUrl: 'https://gateway.example/'
    })).rejects.toMatchObject({ kind: 'http', status: 404 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('supports v3-only mode and skips v2 fallback even when v3 lacks carbohydrates', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname.includes('/api/v3.6/product/')) {
        return jsonResponse({
          status: 'success',
          product: {
            code: '7613035459739',
            product_name: 'Only V3',
            serving_size: '30 g'
          }
        });
      }
      throw new Error(`unexpected URL for v3-only mode: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await getProductByBarcode('7613035459739', undefined, { productApiMode: 'v3' });

    expect(result.product?.product_name).toBe('Only V3');
    expect(result.api_meta?.attempts?.map((attempt) => attempt.backend)).toEqual(['open-food-facts-v3']);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('supports v2-only mode and skips v3 request', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname.includes('/api/v2/product/')) {
        return jsonResponse({
          status: 'success',
          product: {
            code: '3045140105506',
            product_name: 'Only V2',
            nutriments: { carbohydrates_100g: 45 }
          }
        });
      }
      throw new Error(`unexpected URL for v2-only mode: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await getProductByBarcode('3045140105506', undefined, { productApiMode: 'v2' });

    expect(result.product?.product_name).toBe('Only V2');
    expect(result.api_meta?.attempts?.map((attempt) => attempt.backend)).toEqual(['open-food-facts-v2']);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('passes product_api to the gateway product endpoint', async () => {
    let requestedUrl = '';
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      requestedUrl = String(input);
      return jsonResponse({
        status: 'success',
        product: {
          code: '4001724819806',
          product_name: 'Gateway Mode Test'
        }
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    await getProductByBarcode('4001724819806', undefined, {
      gatewayUrl: 'https://gateway.example/',
      productApiMode: 'v2'
    });

    const url = new URL(requestedUrl);
    expect(url.origin).toBe('https://gateway.example');
    expect(url.pathname).toBe('/api/product/4001724819806');
    expect(url.searchParams.get('product_api')).toBe('v2');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('keeps gateway v2 mode strict: no direct OFF fallback request is made', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.origin === 'https://gateway.example') {
        return jsonResponse({
          status: 'success',
          product: {
            code: '5000112603002',
            product_name: 'Gateway v2 strict',
            nutriments: { carbohydrates_100g: 41 }
          }
        });
      }
      throw new Error(`no direct OFF fallback expected in gateway v2 mode: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await getProductByBarcode('5000112603002', undefined, {
      gatewayUrl: 'https://gateway.example/',
      productApiMode: 'v2'
    });

    expect(result.product?.product_name).toBe('Gateway v2 strict');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('uses product_api=v3 on gateway and keeps v3 backend identity', async () => {
    let requestedUrl = '';
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      requestedUrl = String(input);
      return jsonResponse({
        status: 'success',
        product: {
          code: '3017620422003',
          product_name: 'Gateway v3 strict',
          nutriments: { carbohydrates_100g: 58 }
        },
        api_meta: {
          cacheStatus: 'network',
          fetchedAt: new Date().toISOString(),
          sourceUrl: '/api/product/3017620422003',
          backend: 'gateway',
          originBackend: 'open-food-facts-v3',
          attempts: []
        }
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await getProductByBarcode('3017620422003', undefined, {
      gatewayUrl: 'https://gateway.example/',
      productApiMode: 'v3'
    });

    const url = new URL(requestedUrl);
    expect(url.searchParams.get('product_api')).toBe('v3');
    expect(result.product?.product_name).toBe('Gateway v3 strict');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('uses product_api=hybrid on gateway', async () => {
    let requestedUrl = '';
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      requestedUrl = String(input);
      return jsonResponse({
        status: 'success',
        product: {
          code: '7613035459739',
          product_name: 'Gateway hybrid mode',
          nutriments: { carbohydrates_100g: 34 }
        }
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    await getProductByBarcode('7613035459739', undefined, {
      gatewayUrl: 'https://gateway.example/',
      productApiMode: 'hybrid'
    });

    const url = new URL(requestedUrl);
    expect(url.searchParams.get('product_api')).toBe('hybrid');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
