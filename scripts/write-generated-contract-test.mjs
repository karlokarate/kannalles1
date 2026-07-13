#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');
const target = path.join(root, 'contracts/generated/search-api.generated.test.ts');
const content = `/** Generated contract tests. Do not edit manually. */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  AiParseResponseSchema,
  ApiErrorSchema,
  buildGatewayAiParseUrl,
  buildGatewayHealthUrl,
  HealthResponseSchema,
  ProductGatewayResponseSchema,
  SearchGatewayResponseSchema,
  buildGatewayProductUrl,
  buildGatewaySearchUrl,
  createGatewayClient,
  GatewayTransportError,
  MAX_GATEWAY_RESPONSE_BYTES,
  ProductPathSchema,
  ProductQuerySchema,
  SearchQuerySchema
} from '../../src/generated/search-api';
import { getKHCheckerDataGatewayAPIMock } from '../../generated-tests/search-api.msw';

const document = JSON.parse(readFileSync(new URL('./search-api.openapi.json', import.meta.url), 'utf8'));
const packageJson = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));

function healthPayload(overrides: Record<string, unknown> = {}) {
  return {
    ok: true, ready: true, status: 'healthy',
    service: 'kh-data-gateway', apiVersion: '1', version: packageJson.version,
    openaiConfigured: false, searchIndexConfigured: true,
    distributedCacheConfigured: true,
    cacheBackend: {
      requested: 'redis', effective: 'redis', connectivity: 'ready', degraded: false
    },
    gatewayCacheEntries: 2, inFlightRequests: 0,
    build: { runtime: 'node', commit: '0123456789abcdef', builtAt: '2026-07-12T00:00:00.000Z' },
    capabilities: {
      aiParse: false, searchIndex: true, offLegacyFallback: true, offProductV3: true,
      offProductV2: true, distributedCoordination: true
    },
    components: {
      aiParse: { status: 'disabled', reason: 'OPENAI_API_KEY is not configured' },
      searchIndex: { status: 'ready', reason: null },
      distributedCoordination: { status: 'ready', reason: null },
      requestBudgets: { status: 'ready', reason: null },
      offProductApi: { status: 'ready', reason: null }
    },
    circuits: {
      searchIndex: 'closed', offLegacy: 'closed',
      offProductV3: 'closed', offProductV2: 'closed'
    },
    rateLimits: {
      scope: 'distributed', searchIndexPerMinute: 60, legacySearchPerMinute: 10,
      productPerMinute: 15, clientScoped: true,
      clientSearchPerMinute: 6, clientProductPerMinute: 10
    },
    ...overrides
  };
}

function apiMeta(overrides: Record<string, unknown> = {}) {
  return {
    cacheStatus: 'network', cacheLayer: 'none', gatewayCacheStatus: 'network',
    fetchedAt: '2026-07-12T00:00:00.000Z', sourceUrl: '/api/v1/fixture',
    backend: 'gateway', originBackend: 'search-index', networkAttempted: true,
    durationMs: 1, attempts: [], ...overrides
  };
}

describe('generated versioned data gateway contract', () => {
  it('publishes OpenAPI 3.1 and all production operations for the current version', () => {
    expect(document.openapi).toBe('3.1.0');
    expect(document.info.version).toBe(packageJson.version);
    expect(Object.keys(document.paths).sort()).toEqual([
      '/api/v1/ai/parse', '/api/v1/health', '/api/v1/product/{code}', '/api/v1/search'
    ]);
    expect(document['x-kh-generator']).toMatchObject({
      appVersion: packageJson.version, gatewayApiVersion: '1',
      deploymentMode: 'dual-lane', gatewayRuntime: 'node',
      gatewayRequiredForGlobalSearch: false,
      browserUpstreamPolicy: 'direct-off-or-configured-gateway', localCooldownAllowed: false,
      maximumDirectSearchBackendsPerAction: 2, productHydrationFanOutAllowed: false
    });
    expect(document['x-kh-generator']).not.toHaveProperty('appOnlyRelease');
    expect(document['x-kh-generator']).not.toHaveProperty('customServerRequired');
  });

  it('uses Orval URL builders through the generated absolute gateway adapter', () => {
    expect(buildGatewaySearchUrl('https://kh.example/root/', 'Kinder Bueno', 15, 'search-index'))
      .toBe('https://kh.example/root/api/v1/search?q=Kinder+Bueno&page_size=15&search_api=search-index');
    expect(buildGatewayProductUrl('https://kh.example/root', '4000417025005', true, 'v3'))
      .toBe('https://kh.example/root/api/v1/product/4000417025005?known_carbs=1&product_api=v3');
    expect(buildGatewayProductUrl('https://kh.example/root', '1234567', false, 'v2'))
      .toContain('/api/v1/product/1234567?');
    expect(buildGatewayHealthUrl('/')).toBe('/api/v1/health');
    expect(buildGatewayHealthUrl('/gateway')).toBe('/gateway/api/v1/health');
    expect(buildGatewayHealthUrl('/gateway/')).toBe('/gateway/api/v1/health');
    expect(buildGatewayAiParseUrl('https://KH.EXAMPLE:443/root'))
      .toBe('https://kh.example/root/api/v1/ai/parse');
    for (const invalidBase of [
      '', '//evil.example', 'ftp://gateway.example', 'https://user:secret@gateway.example',
      'https://gateway.example/root?tenant=x', 'https://gateway.example/root#fragment',
      'https://[broken', '/gateway?tenant=x', '/gateway#fragment', '/bad path'
    ]) {
      expect(() => buildGatewayHealthUrl(invalidBase), invalidBase).toThrow();
    }
    for (const invalidCode of ['../health', '%2f', '123 4567', '123456', '123456789012345']) {
      expect(() => buildGatewayProductUrl('/', invalidCode), invalidCode).toThrow();
    }
    for (const invalidPageSize of [0, 1.5, 21, Number.NaN]) {
      expect(() => buildGatewaySearchUrl('/', 'Haferflocken', invalidPageSize), String(invalidPageSize)).toThrow();
    }
  });

  it('rejects unsafe product path input before fetch', () => {
    let fetchCalls = 0;
    const client = createGatewayClient({
      baseUrl: '/',
      fetchImpl: async () => {
        fetchCalls += 1;
        return new Response('{}');
      }
    });
    expect(() => client.product({ code: '../health' })).toThrow(/Barcode/);
    expect(fetchCalls).toBe(0);
  });

  it('requires the versioned vendor-neutral health capability contract', () => {
    expect(HealthResponseSchema.parse(healthPayload()).apiVersion).toBe('1');
    expect(() => HealthResponseSchema.parse(healthPayload({ ready: false }))).toThrow();
    expect(() => HealthResponseSchema.parse(healthPayload({
      cacheBackend: { requested: 'redis', effective: 'memory', connectivity: 'unavailable', degraded: true }
    }))).toThrow();
    expect(HealthResponseSchema.parse(healthPayload({
      status: 'degraded',
      cacheBackend: { requested: 'memory', effective: 'memory', connectivity: 'ready', degraded: true }
    })).status).toBe('degraded');
  });

  it('validates gateway search and product payloads at runtime', () => {
    expect(SearchGatewayResponseSchema.parse({
      hits: [], count: 0, source: 'gateway', query_used: 'fixture',
      gateway_attempts: [], api_meta: apiMeta()
    }).hits).toEqual([]);
    expect(ProductGatewayResponseSchema.parse({
      status: 'success', code: '4000417025005',
      product: { code: '4000417025005', nutriments: { carbohydrates_100g: 4.2 } },
      gateway_attempts: [], api_meta: apiMeta({ originBackend: 'open-food-facts-v3' })
    }).code)
      .toBe('4000417025005');
    expect(SearchGatewayResponseSchema.parse({
      hits: [], count: 0, source: 'gateway', query_used: 'test', gateway_attempts: [],
      api_meta: apiMeta({
        cacheStatus: 'fresh-cache', cacheLayer: 'browser-localstorage',
        sourceUrl: '/api/v1/search?q=test'
      })
    }).api_meta?.cacheLayer).toBe('browser-localstorage');
    expect(() => SearchGatewayResponseSchema.parse({ hits: 'invalid' })).toThrow();
  });

  it('exports the request schemas used by the production handlers', () => {
    expect(SearchQuerySchema.parse({ q: '  Haferflocken  ' })).toMatchObject({
      q: 'Haferflocken', page_size: 15, search_api: 'auto'
    });
    expect(ProductPathSchema.parse({ code: '1234567' }).code).toBe('1234567');
    expect(ProductQuerySchema.parse({})).toEqual({ known_carbs: '0', product_api: 'hybrid' });
    expect(() => SearchQuerySchema.parse({ q: 'x', page_size: 21 })).toThrow();
    expect(() => SearchQuerySchema.parse({ q: 'x', page_size: 1.5 })).toThrow();
    expect(() => SearchQuerySchema.parse({ q: 'x', search_api: 'unknown' })).toThrow();
    expect(() => ProductPathSchema.parse({ code: '123456' })).toThrow();
    expect(() => ProductQuerySchema.parse({ known_carbs: 'yes' })).toThrow();
  });

  it('validates the optional AI parser response without hand-written duplicate schemas', () => {
    const parsed = AiParseResponseSchema.parse({
      status: 'parsed', rawInput: '2 Äpfel',
      product: { name: 'Apfel', brand: null, variant: null },
      amount: { value: 2, unit: 'piece' }, resolutionMode: 'generic_category',
      barcode: null, clarificationQuestion: null, parser: 'openai'
    });
    expect(parsed.amount.value).toBe(2);
    expect(() => AiParseResponseSchema.parse({
      ...parsed, product: { ...parsed.product, name: '   ' }
    })).toThrow();
    expect(() => AiParseResponseSchema.parse({
      ...parsed, amount: { value: 1001, unit: 'piece' }
    })).toThrow();
    expect(() => AiParseResponseSchema.parse({
      ...parsed, resolutionMode: 'barcode', barcode: null
    })).toThrow();
    expect(AiParseResponseSchema.parse({
      ...parsed, resolutionMode: 'barcode', barcode: '1234567'
    }).barcode).toBe('1234567');
  });

  it('validates structured non-2xx errors and preserves diagnostics', async () => {
    const apiError = ApiErrorSchema.parse({
      error: 'Temporär limitiert.', code: 'LOCAL_RATE_LIMIT', traceId: 'trace-12345678',
      retryAt: '2026-07-12T12:00:00.000Z',
      attempts: [{
        backend: 'search-index', label: 'Eigener Index', url: 'https://index.example/search',
        startedAt: '2026-07-12T11:59:59.000Z', durationMs: 20,
        outcome: 'rate-limit', status: 429, retryAfterMs: 1000
      }]
    });
    const client = createGatewayClient({
      baseUrl: '/',
      fetchImpl: async () => new Response(JSON.stringify(apiError), {
        status: 429, headers: { 'Content-Type': 'application/json', 'Retry-After': '1' }
      })
    });
    try {
      await client.search({ query: 'Haferflocken' });
      throw new Error('expected GatewayTransportError');
    } catch (error) {
      expect(error).toBeInstanceOf(GatewayTransportError);
      expect(error).toMatchObject({
        status: 429, traceId: apiError.traceId, retryAt: apiError.retryAt,
        attempts: apiError.attempts, apiError
      });
    }
  });

  it('returns a contract-valid health diagnostic on HTTP 503', async () => {
    const diagnostic = healthPayload({ ok: false, ready: false, status: 'unhealthy' });
    const client = createGatewayClient({
      baseUrl: '/',
      fetchImpl: async () => new Response(JSON.stringify(diagnostic), {
        status: 503, headers: { 'Content-Type': 'application/json' }
      })
    });
    const result = await client.health();
    expect(result.status).toBe(503);
    expect(result.data).toMatchObject({ ok: false, ready: false, status: 'unhealthy' });
  });

  it('rejects oversized gateway bodies before parsing them', async () => {
    const client = createGatewayClient({
      baseUrl: '/',
      fetchImpl: async () => new Response('{}', {
        status: 200,
        headers: { 'Content-Length': String(MAX_GATEWAY_RESPONSE_BYTES + 1) }
      })
    });
    await expect(client.health()).rejects.toMatchObject({
      name: 'GatewayTransportError', status: 200
    });
  });

  it('generates four MSW handlers from the same OpenAPI input', () => {
    expect(getKHCheckerDataGatewayAPIMock()).toHaveLength(4);
  });
});
`;
await mkdir(path.dirname(target), { recursive: true });
await writeFile(target, content);
console.log('Generated contract test:', path.relative(root, target));
