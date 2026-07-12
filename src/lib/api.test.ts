import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DataSourceError,
  cancelPendingApiRequests,
  clearApiGovernor,
  getProductByBarcode,
  searchFoodCandidates,
  searchFoodCandidatesOutcome
} from './api';
import { clearApiCache, getApiCacheStats } from './storage';
import type { ApiResponseMeta, OffProduct, SearchHit, SearchResponse } from '../types';

const GATEWAY = 'https://gateway.example/base/';

function jsonResponse(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers }
  });
}

function responseMeta(overrides: Partial<ApiResponseMeta> = {}): ApiResponseMeta {
  return {
    cacheStatus: 'network',
    fetchedAt: new Date().toISOString(),
    sourceUrl: 'index://test-snapshot',
    backend: 'gateway',
    originBackend: 'search-index',
    networkAttempted: true,
    ...overrides
  };
}

function searchPayload(hits: SearchHit[], overrides: Partial<SearchResponse> = {}) {
  return {
    hits,
    count: hits.length,
    source: 'search-index' as const,
    query_used: 'Test',
    gateway_attempts: [],
    api_meta: responseMeta(overrides.api_meta),
    ...overrides
  };
}

function productPayload(product: OffProduct, overrides: Record<string, unknown> = {}) {
  return {
    status: 'success',
    code: product.code,
    product,
    api_meta: responseMeta({ originBackend: 'open-food-facts-v3' }),
    gateway_attempts: [],
    ...overrides
  };
}

function errorPayload(code: string, error = 'Gateway request failed') {
  return { error, code, traceId: 'trace-test-1234', attempts: [] };
}

beforeEach(async () => {
  vi.useRealTimers();
  clearApiGovernor();
  cancelPendingApiRequests();
  await clearApiCache();
});

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
  cancelPendingApiRequests();
  clearApiGovernor();
  await clearApiCache();
});

describe('generated gateway-only search client', () => {
  it('returns a configuration error without attempting any public origin', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(searchFoodCandidates('Bifi', 10)).rejects.toMatchObject({
      name: 'DataSourceError',
      kind: 'configuration'
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('uses only the configured gateway and generated v1 search path', async () => {
    let requestedUrl = '';
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      requestedUrl = String(input);
      return jsonResponse(searchPayload([{ code: '4000000000001', product_name_de: 'Bifi' }]));
    }));

    const response = await searchFoodCandidates('Bifi', 15, undefined, { gatewayUrl: GATEWAY });
    const url = new URL(requestedUrl);
    expect(url.origin).toBe('https://gateway.example');
    expect(url.pathname).toBe('/base/api/v1/search');
    expect(url.searchParams.get('q')).toBe('Bifi');
    expect(url.searchParams.get('page_size')).toBe('15');
    expect(url.searchParams.get('search_api')).toBe('auto');
    expect(response.source).toBe('search-index');
    expect(response.api_meta?.backend).toBe('gateway');
  });

  it('never retries OFF or Search-a-licious directly after a gateway failure', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL) => jsonResponse(errorPayload('UPSTREAMS_UNAVAILABLE'), 502));
    vi.stubGlobal('fetch', fetchMock);

    await expect(searchFoodCandidates('Ausfall', 10, undefined, { gatewayUrl: GATEWAY })).rejects.toBeInstanceOf(DataSourceError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const requested = String(fetchMock.mock.calls[0]?.[0]);
    expect(requested).toMatch(/^https:\/\/gateway\.example\//);
    expect(requested).not.toMatch(/openfoodfacts|search-a-licious/i);
  });

  it('represents an empty gateway result as a typed empty outcome', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(searchPayload([]))));
    const outcome = await searchFoodCandidatesOutcome('Kein Treffer', 10, undefined, { gatewayUrl: GATEWAY });
    expect(outcome.status).toBe('not_found');
    expect(outcome.candidates).toEqual([]);
    expect(outcome.diagnostics.retryAllowedImmediately).toBe(true);
  });

  it('rejects contract-invalid gateway payloads', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ products: [] })));
    await expect(searchFoodCandidates('Invalid', 10, undefined, { gatewayUrl: GATEWAY })).rejects.toMatchObject({
      name: 'DataSourceError',
      kind: 'parse'
    });
  });

  it('deduplicates concurrent requests and reuses a page-size-scoped cache', async () => {
    let resolveResponse!: (value: Response) => void;
    const fetchMock = vi.fn(() => new Promise<Response>((resolve) => { resolveResponse = resolve; }));
    vi.stubGlobal('fetch', fetchMock);

    const first = searchFoodCandidates('Parallel', 10, undefined, { gatewayUrl: GATEWAY });
    const second = searchFoodCandidates('Parallel', 10, undefined, { gatewayUrl: GATEWAY });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    resolveResponse(jsonResponse(searchPayload([{ code: '4000000000002' }])));
    await Promise.all([first, second]);

    const cached = await searchFoodCandidates('Parallel', 10, undefined, { gatewayUrl: GATEWAY });
    expect(cached.api_meta?.cacheStatus).toBe('fresh-cache');
    expect((await getApiCacheStats()).entries).toBeGreaterThanOrEqual(1);
    fetchMock.mockImplementation(async () => jsonResponse(searchPayload([{ code: '4000000000003' }])));
    await searchFoodCandidates('Parallel', 15, undefined, { gatewayUrl: GATEWAY });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('starts an independent retry while an aborted single-flight request is still settling', async () => {
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      if (fetchMock.mock.calls.length === 1) {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
        });
      }
      return Promise.resolve(jsonResponse(searchPayload([{ code: '4000000000004' }])));
    });
    vi.stubGlobal('fetch', fetchMock);

    const controller = new AbortController();
    const aborted = searchFoodCandidates('Sofortiger Retry', 10, controller.signal, { gatewayUrl: GATEWAY });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    controller.abort();

    const retried = searchFoodCandidates('Sofortiger Retry', 10, undefined, { gatewayUrl: GATEWAY });
    await expect(aborted).rejects.toMatchObject({ kind: 'aborted' });
    await expect(retried).resolves.toMatchObject({ hits: [{ code: '4000000000004' }] });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('separates cache records after a gateway change', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => jsonResponse(searchPayload([{
      code: new URL(String(input)).hostname === 'one.example' ? '4000000000011' : '4000000000012'
    }])));
    vi.stubGlobal('fetch', fetchMock);
    await searchFoodCandidates('Namespace', 10, undefined, { gatewayUrl: 'https://one.example/' });
    await searchFoodCandidates('Namespace', 10, undefined, { gatewayUrl: 'https://two.example/' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('preserves immutable gateway provenance when the browser cache serves a response', async () => {
    const fetchedAt = new Date().toISOString();
    const fetchMock = vi.fn(async () => jsonResponse(searchPayload(
      [{ code: '4000000000005' }],
      {
      api_meta: {
        cacheStatus: 'fresh-cache',
        fetchedAt,
        sourceUrl: 'index://products/snapshot-42',
        backend: 'gateway',
        originBackend: 'search-index',
        networkAttempted: false,
        cacheLayer: 'gateway-redis',
        gatewayCacheStatus: 'fresh-cache',
        fallbackOrigin: 'remote-overload'
      }
    })));
    vi.stubGlobal('fetch', fetchMock);
    await searchFoodCandidates('Provenienz', 10, undefined, { gatewayUrl: GATEWAY });
    const cached = await searchFoodCandidates('Provenienz', 10, undefined, { gatewayUrl: GATEWAY });
    expect(cached.api_meta).toMatchObject({
      sourceUrl: 'index://products/snapshot-42',
      originBackend: 'search-index',
      backend: 'query-cache',
      cacheLayer: 'browser-memory',
      gatewayCacheStatus: 'fresh-cache',
      fallbackOrigin: 'remote-overload'
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('serves a strict-contract search cache as stale reserve after a later gateway outage', async () => {
    const oldFetchedAt = new Date(Date.now() - 25 * 60 * 60 * 1_000).toISOString();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(searchPayload([{ code: '4000000000091' }], {
        api_meta: responseMeta({ fetchedAt: oldFetchedAt })
      })))
      .mockResolvedValueOnce(jsonResponse(errorPayload('UPSTREAMS_UNAVAILABLE'), 503));
    vi.stubGlobal('fetch', fetchMock);
    await searchFoodCandidates('Stale Suche', 10, undefined, { gatewayUrl: GATEWAY });
    const recovered = await searchFoodCandidates('Stale Suche', 10, undefined, { gatewayUrl: GATEWAY });
    expect(recovered.hits[0]?.code).toBe('4000000000091');
    expect(recovered.api_meta).toMatchObject({ cacheStatus: 'stale-cache', fallbackReason: 'http' });
    expect((await getApiCacheStats()).staleEntries).toBeGreaterThanOrEqual(1);
  });

  it('does not persist or reuse API data when privacy caching is disabled', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(searchPayload([{ code: '4000000000006' }])));
    vi.stubGlobal('fetch', fetchMock);
    await searchFoodCandidates('Privat', 10, undefined, { gatewayUrl: GATEWAY, cacheEnabled: false });
    await searchFoodCandidates('Privat', 10, undefined, { gatewayUrl: GATEWAY, cacheEnabled: false });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('treats Retry-After as diagnostics and never installs a local cooldown', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(errorPayload('LOCAL_RATE_LIMIT', 'limit'), 429, { 'Retry-After': '12' }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(searchFoodCandidates('Limit A', 10, undefined, { gatewayUrl: GATEWAY })).rejects.toMatchObject({ kind: 'rate-limit' });
    await expect(searchFoodCandidates('Limit B', 10, undefined, { gatewayUrl: GATEWAY })).rejects.toMatchObject({ kind: 'rate-limit' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('classifies 503 by stable error code instead of treating every outage as a rate limit', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(errorPayload('UPSTREAMS_UNAVAILABLE'), 503)));
    await expect(searchFoodCandidates('Ausfall 503', 10, undefined, { gatewayUrl: GATEWAY }))
      .rejects.toMatchObject({ kind: 'http', status: 503 });

    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(errorPayload('LOCAL_RATE_LIMIT'), 503)));
    await expect(searchFoodCandidates('Lokales Limit', 10, undefined, { gatewayUrl: GATEWAY }))
      .rejects.toMatchObject({ kind: 'rate-limit', status: 503 });
  });

  it('rejects external cleartext gateways while allowing loopback HTTP for local development', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(searchPayload([])));
    vi.stubGlobal('fetch', fetchMock);
    await expect(searchFoodCandidates('Unsicher', 10, undefined, { gatewayUrl: 'http://gateway.example' }))
      .rejects.toMatchObject({ kind: 'configuration' });
    expect(fetchMock).not.toHaveBeenCalled();

    await expect(searchFoodCandidates('Loopback', 10, undefined, { gatewayUrl: 'http://127.0.0.1:8787' }))
      .resolves.toMatchObject({ hits: [] });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('generated gateway-only product client', () => {
  it('uses the generated v1 path and forwards strict product mode', async () => {
    let requestedUrl = '';
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      requestedUrl = String(input);
      return jsonResponse(productPayload({
        code: '3017620422003', product_name: 'Nutella', nutriments: { carbohydrates_100g: 57.5 }
      }));
    }));
    const response = await getProductByBarcode('3017620422003', undefined, {
      gatewayUrl: GATEWAY,
      productApiMode: 'v3'
    });
    const url = new URL(requestedUrl);
    expect(url.pathname).toBe('/base/api/v1/product/3017620422003');
    expect(url.searchParams.get('product_api')).toBe('v3');
    expect(response.product?.product_name).toBe('Nutella');
  });

  it('normalizes equivalent 7/8-digit UPC-E input to one request and cache key', async () => {
    let requestedUrl = '';
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      requestedUrl = String(input);
      const code = new URL(String(input)).pathname.split('/').pop();
      return jsonResponse(productPayload({ code }));
    });
    vi.stubGlobal('fetch', fetchMock);
    await getProductByBarcode('1234567', undefined, { gatewayUrl: GATEWAY });
    await getProductByBarcode('01234567', undefined, { gatewayUrl: GATEWAY });
    expect(new URL(requestedUrl).pathname).toBe('/base/api/v1/product/01234567');
    await getProductByBarcode('123456789012', undefined, { gatewayUrl: GATEWAY });
    await getProductByBarcode('0123456789012', undefined, { gatewayUrl: GATEWAY });
    expect(new URL(requestedUrl).pathname).toBe('/base/api/v1/product/0123456789012');
    await getProductByBarcode('000123456', undefined, { gatewayUrl: GATEWAY });
    await getProductByBarcode('00123456', undefined, { gatewayUrl: GATEWAY });
    expect(new URL(requestedUrl).pathname).toBe('/base/api/v1/product/00123456');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('does not return a cached result to an aborted operation', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(productPayload({ code: '12345670' }))));
    await getProductByBarcode('12345670', undefined, { gatewayUrl: GATEWAY });
    const controller = new AbortController();
    controller.abort();
    await expect(getProductByBarcode('12345670', controller.signal, { gatewayUrl: GATEWAY })).rejects.toMatchObject({ kind: 'aborted' });
  });

  it('never persists caller-specific search seeds in the canonical product cache', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(productPayload({
      code: '4006381333931', product_name: 'Kanonisch', nutriments: { carbohydrates_100g: 10 }
    })));
    vi.stubGlobal('fetch', fetchMock);
    const first = await getProductByBarcode('4006381333931', undefined, {
      gatewayUrl: GATEWAY,
      seedProduct: { generic_name: 'Seed A', nutriments: { carbohydrates_100g: 99 } }
    });
    const second = await getProductByBarcode('4006381333931', undefined, {
      gatewayUrl: GATEWAY,
      seedProduct: { generic_name: 'Seed B', nutriments: { carbohydrates_100g: 77 } }
    });
    expect(first.product?.generic_name).toBe('Seed A');
    expect(second.product?.generic_name).toBe('Seed B');
    expect(second.product?.nutriments?.carbohydrates_100g).toBe(10);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('serves a strict-contract product cache as stale reserve after a later gateway outage', async () => {
    const oldFetchedAt = new Date(Date.now() - 31 * 24 * 60 * 60 * 1_000).toISOString();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(productPayload(
        { code: '4006381333932', product_name: 'Reserve' },
        { api_meta: responseMeta({ fetchedAt: oldFetchedAt, originBackend: 'open-food-facts-v3' }) }
      )))
      .mockResolvedValueOnce(jsonResponse(errorPayload('UPSTREAMS_UNAVAILABLE'), 503));
    vi.stubGlobal('fetch', fetchMock);
    await getProductByBarcode('4006381333932', undefined, { gatewayUrl: GATEWAY });
    const recovered = await getProductByBarcode('4006381333932', undefined, { gatewayUrl: GATEWAY });
    expect(recovered.product?.product_name).toBe('Reserve');
    expect(recovered.api_meta).toMatchObject({ cacheStatus: 'stale-cache', fallbackReason: 'http' });
  });
});
