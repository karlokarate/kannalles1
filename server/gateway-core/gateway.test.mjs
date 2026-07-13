import { describe, expect, it, vi } from 'vitest';
import {
  createGatewayCore,
  fallbackOriginForResult,
  networkAttemptedForAttempts
} from './gateway.mjs';
import { createPersistencePorts } from './redis-port.mjs';

const CLIENT_SALT = '0123456789abcdef0123456789abcdef';
const CLIENT_KEY = 'kh_client_0123456789abcdef0123456789abcdef';

function response(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

function gateway(fetchFn, env = {}) {
  const ports = createPersistencePorts({ url: '' });
  return createGatewayCore({
    version: '2.2.4',
    fetchFn,
    ports,
    env: {
      SEARCH_INDEX_URL: 'https://index.example/',
      GATEWAY_DEADLINE_MS: '1000',
      ...env
    }
  });
}

describe('GatewayCore search', () => {
  it('uses OFF Legacy directly when no owned index is configured', async () => {
    const urls = [];
    const core = gateway(async (url) => {
      urls.push(String(url));
      return response({ products: [], count: 0, page: 1, page_size: 10 });
    }, { SEARCH_INDEX_URL: '' });
    await core.search('legacy direct', 10);
    expect(urls).toHaveLength(1);
    expect(new URL(urls[0]).pathname).toBe('/cgi/search.pl');
  });

  it('uses configured public Search-a-licious as auto primary without an export index', async () => {
    const requests = [];
    const core = gateway(async (url, init) => {
      requests.push({ url: String(url), init });
      return response({ hits: [{ code: '4000417025005', product_name: 'Bifi' }], count: 1 });
    }, {
      SEARCH_INDEX_URL: '',
      SEARCH_A_LICIOUS_URL: 'https://search.openfoodfacts.org/search'
    });

    const result = await core.search('Bifi', 10);
    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe('https://search.openfoodfacts.org/search');
    expect(requests[0].init.method).toBe('POST');
    expect(result).toMatchObject({
      source: 'search-a-licious',
      hits: [{ code: '4000417025005', product_name: 'Bifi' }],
      api_meta: { originBackend: 'search-a-licious' }
    });
  });

  it('requires an explicit URL for public Search-a-licious diagnostics', async () => {
    const fetchFn = vi.fn();
    const core = gateway(fetchFn, { SEARCH_INDEX_URL: '', SEARCH_A_LICIOUS_URL: '' });
    await expect(core.search('diagnostic', 10, { searchApiMode: 'search-a-licious' }))
      .rejects.toMatchObject({ status: 503, code: 'SEARCH_A_LICIOUS_NOT_CONFIGURED' });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('uses the documented POST body for the configured primary index', async () => {
    const requests = [];
    const core = gateway(async (url, init) => {
      requests.push({ url: String(url), init });
      return response({ hits: [{ code: '4000417025005' }], count: 1, page: 1, page_size: 10 });
    });
    const result = await core.search('Bifi (classic)', 10, { searchApiMode: 'search-index' });
    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe('https://index.example/search');
    expect(requests[0].init.method).toBe('POST');
    const body = JSON.parse(requests[0].init.body);
    expect(body).toMatchObject({
      q: 'Bifi \\(classic\\)',
      langs: ['de', 'en', 'main'],
      page: 1,
      page_size: 10
    });
    expect(body.fields).toContain('nutriments');
    expect(result.source).toBe('search-index');
    expect(result.api_meta).toMatchObject({
      cacheStatus: 'network',
      originBackend: 'search-index',
      sourceUrl: 'upstream://search-index/search'
    });
  });

  it('maps the official Search-a-licious taxonomy projection to the internal DTO', async () => {
    const core = gateway(async () => response({
      hits: [{
        code: 4000417025005,
        categories: ['en:snacks', { id: 'en:meat-snacks' }],
        countries: ['en:germany'],
        nutriments: { carbohydrates_100g: 4.2 }
      }]
    }));
    const result = await core.search('official projection', 10, { searchApiMode: 'search-index' });
    expect(result.hits[0]).toMatchObject({
      code: '4000417025005',
      categories_tags: ['en:snacks', 'en:meat-snacks'],
      countries_tags: ['en:germany'],
      nutriments: { carbohydrates_100g: 4.2 }
    });
  });

  it('allows only the official OFF image CDN in public product DTOs', async () => {
    const core = gateway(async () => response({
      hits: [
        { code: '4000417025005', image_front_url: 'https://images.openfoodfacts.org/images/products/1/front_de.1.400.jpg' },
        { code: '3017620422003', image_front_url: 'https://tracker.example/pixel.gif' },
        { code: '5449000000996', image_front_url: 'http://images.openfoodfacts.org/pixel.gif' }
      ]
    }));
    const result = await core.search('image policy', 10, { searchApiMode: 'search-index' });
    expect(result.hits[0].image_front_url).toMatch(/^https:\/\/images\.openfoodfacts\.org\//);
    expect(result.hits[1]).not.toHaveProperty('image_front_url');
    expect(result.hits[2]).not.toHaveProperty('image_front_url');
  });

  it('falls back on a documented index error union instead of returning fake empty hits', async () => {
    const core = gateway(async (url) => {
      if (String(url).startsWith('https://index.example')) {
        return response({ errors: [{ message: 'index unavailable' }], debug: {} });
      }
      return response({ products: [{ code: '4000417025005' }], count: 1, page: 1, page_size: 10 });
    });
    const result = await core.search('fallback product', 10);
    expect(result.hits).toEqual([{ code: '4000417025005' }]);
    expect(result.source).toBe('open-food-facts-legacy');
    expect(result.gateway_attempts.map((attempt) => attempt.outcome)).toEqual(['parse-error', 'success']);
  });

  it.each([
    ['search-index', {}, { SEARCH_INDEX_URL: 'https://index.example/' }],
    ['legacy', {}, { SEARCH_INDEX_URL: '' }]
  ])('rejects a malformed HTTP-200 %s search payload', async (searchApiMode, payload, env) => {
    const core = gateway(async () => response(payload), env);
    await expect(core.search('malformed payload', 10, { searchApiMode }))
      .rejects.toMatchObject({
        status: 502,
        code: 'UPSTREAM_CONTRACT_VIOLATION',
        attempts: [expect.objectContaining({ outcome: 'parse-error' })]
      });
  });

  it('counts HTTP-200 error unions as circuit failures', async () => {
    const core = gateway(async (url) => {
      if (String(url).startsWith('https://index.example')) {
        return response({ errors: [{ message: 'index unavailable' }] });
      }
      return response({ products: [], count: 0, page: 1, page_size: 10 });
    });
    await core.search('circuit-error-one', 10);
    await core.search('circuit-error-two', 10);
    expect((await core.health()).circuits.searchIndex).toBe('open');
  });

  it('single-flights equal requests and preserves fetchedAt on a cache hit', async () => {
    let calls = 0;
    const core = gateway(async () => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 15));
      return response({ hits: [{ code: '4000417025005' }] });
    });
    const [first, concurrent] = await Promise.all([
      core.search('same product', 10, { searchApiMode: 'search-index' }),
      core.search('same product', 10, { searchApiMode: 'search-index' })
    ]);
    const cached = await core.search('same product', 10, { searchApiMode: 'search-index' });
    expect(calls).toBe(1);
    expect(concurrent.hits).toEqual(first.hits);
    expect(cached.api_meta.cacheStatus).toBe('fresh-cache');
    expect(cached.api_meta.fetchedAt).toBe(first.api_meta.fetchedAt);
  });

  it('single-flights across two gateway instances sharing cache and coordination ports', async () => {
    const ports = createPersistencePorts({ url: '' });
    const fetchFn = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
      return response({ hits: [{ code: '3017620422003' }] });
    });
    const env = {
      SEARCH_INDEX_URL: 'https://index.example/',
      GATEWAY_DEADLINE_MS: '1000'
    };
    const firstCore = createGatewayCore({ version: '2.2.4', fetchFn, ports, env });
    const peerCore = createGatewayCore({ version: '2.2.4', fetchFn, ports, env });

    const results = await Promise.all([
      firstCore.search('distributed same product', 10, { searchApiMode: 'search-index' }),
      peerCore.search('distributed same product', 10, { searchApiMode: 'search-index' })
    ]);
    const networkResult = results.find((result) => result.api_meta.cacheStatus === 'network');
    const peerResult = results.find((result) => result.api_meta.cacheStatus === 'fresh-cache');

    expect(fetchFn).toHaveBeenCalledOnce();
    expect(networkResult).toBeDefined();
    expect(peerResult).toBeDefined();
    expect(peerResult.api_meta.networkAttempted).toBe(false);
    expect(peerResult.hits).toEqual(networkResult.hits);
    expect(peerResult.api_meta.fetchedAt).toBe(networkResult.api_meta.fetchedAt);
  });

  it('keeps known legacy-hash-collision queries in separate opaque cache keys', async () => {
    const fetchFn = vi.fn(async (_url, init) => {
      const query = JSON.parse(init.body).q;
      return response({ hits: [{ code: query === '003pwu' ? '4000417025005' : '3017620422003' }] });
    });
    const core = gateway(fetchFn);
    const [first, second] = await Promise.all([
      core.search('003pwu', 10, { searchApiMode: 'search-index' }),
      core.search('00a5fa', 10, { searchApiMode: 'search-index' })
    ]);

    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(first.hits).not.toEqual(second.hits);
    expect(first.api_meta.cacheKey).not.toBe(second.api_meta.cacheKey);
    expect(first.api_meta.cacheKey).not.toContain('003pwu');
    expect(second.api_meta.cacheKey).not.toContain('00a5fa');
  });

  it('enforces a distributed per-client search budget before the global upstream budget', async () => {
    const fetchFn = vi.fn(async () => response({ hits: [{ code: '4000417025005' }] }));
    const core = gateway(fetchFn, { CLIENT_SEARCH_RATE_LIMIT_PER_MINUTE: '1' });
    const firstClient = 'kh_client_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const secondClient = 'kh_client_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

    await expect(core.search('first query', 10, {
      searchApiMode: 'search-index', clientKey: firstClient
    })).resolves.toMatchObject({ hits: [{ code: '4000417025005' }] });
    await expect(core.search('second query', 10, {
      searchApiMode: 'search-index', clientKey: firstClient
    })).rejects.toMatchObject({ status: 429, code: 'CLIENT_RATE_LIMIT' });
    await expect(core.search('third query', 10, {
      searchApiMode: 'search-index', clientKey: secondClient
    })).resolves.toMatchObject({ hits: [{ code: '4000417025005' }] });
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['URL', { SEARCH_INDEX_URL: 'https://index-b.example/' }],
    ['index id', { SEARCH_INDEX_ID: 'catalog-b' }],
    ['authorization scope', { SEARCH_INDEX_AUTH_TOKEN: 'tenant-b-token' }]
  ])('does not reuse shared search cache data after a %s change', async (_label, changed) => {
    const ports = createPersistencePorts({ url: '' });
    const baseEnv = {
      SEARCH_INDEX_URL: 'https://index-a.example/',
      SEARCH_INDEX_ID: 'catalog-a',
      SEARCH_INDEX_AUTH_TOKEN: 'tenant-a-token'
    };
    const firstFetch = vi.fn(async () => response({ hits: [{ code: '4000417025005' }] }));
    const secondFetch = vi.fn(async () => response({ hits: [{ code: '3017620422003' }] }));
    const firstCore = createGatewayCore({ version: '2.2.4', fetchFn: firstFetch, ports, env: baseEnv });
    const secondCore = createGatewayCore({
      version: '2.2.4',
      fetchFn: secondFetch,
      ports,
      env: { ...baseEnv, ...changed }
    });

    const first = await firstCore.search('same query', 10, { searchApiMode: 'search-index' });
    const second = await secondCore.search('same query', 10, { searchApiMode: 'search-index' });
    expect(first.hits[0].code).toBe('4000417025005');
    expect(second.hits[0].code).toBe('3017620422003');
    expect(first.api_meta.cacheKey).not.toBe(second.api_meta.cacheKey);
    expect(secondFetch).toHaveBeenCalledOnce();
  });

  it('does not cancel the gateway-owned single-flight when one subscriber disconnects', async () => {
    let calls = 0;
    const core = gateway(async () => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 30));
      return response({ hits: [{ code: '5449000000996' }] });
    });
    const controller = new AbortController();
    const disconnected = core.search('shared abort product', 10, {
      searchApiMode: 'search-index',
      signal: controller.signal
    });
    const remainingSubscriber = core.search('shared abort product', 10, {
      searchApiMode: 'search-index'
    });
    controller.abort();
    await expect(disconnected).rejects.toMatchObject({ status: 499 });
    await expect(remainingSubscriber).resolves.toMatchObject({ hits: [{ code: '5449000000996' }] });
    expect(calls).toBe(1);
  });

  it('enforces one absolute deadline instead of a timeout per fallback', async () => {
    const fetchFn = vi.fn((_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true });
    }));
    const core = gateway(fetchFn);
    const startedAt = Date.now();
    await expect(core.search('deadline product', 10, {
      searchApiMode: 'auto',
      deadlineMs: 80
    })).rejects.toMatchObject({ status: 504 });
    expect(Date.now() - startedAt).toBeLessThan(250);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('does not start a fallback without the configured minimum remaining budget', async () => {
    vi.useFakeTimers();
    try {
      const fetchFn = vi.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 35));
        return response({ error: 'primary failed' }, 503);
      });
      const core = gateway(fetchFn, { MIN_FALLBACK_BUDGET_MS: '100' });
      const pending = core.search('fallback budget', 10, {
        searchApiMode: 'auto',
        deadlineMs: 80
      });
      const rejection = expect(pending).rejects.toMatchObject({ status: 504 });
      await vi.advanceTimersByTimeAsync(100);
      await rejection;
      expect(fetchFn).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps internal hosts, query strings and previews out of production diagnostics', async () => {
    const core = gateway(async () => response({ secret: 'upstream body' }, 503), {
      NODE_ENV: 'production',
      ALLOW_SINGLE_INSTANCE_COORDINATION: '1',
      GATEWAY_CLIENT_SALT: CLIENT_SALT
    });
    await expect(core.search('private query', 10, {
      searchApiMode: 'search-index',
      clientKey: CLIENT_KEY
    }))
      .rejects.toSatisfy((error) => {
        expect(error.attempts[0].url).toBe('upstream://search-index/search');
        expect(error.attempts[0]).not.toHaveProperty('responsePreview');
        return true;
      });
  });
});

describe('GatewayCore product', () => {
  it('requests v3.6 nutrition without .json and exposes mapped carbohydrates', async () => {
    const requests = [];
    const core = gateway(async (url, init) => {
      requests.push({ url: String(url), init });
      return response({
        status: 'success',
        code: '4000417025005',
        product: {
          code: '4000417025005',
          product_name: 'Fixture',
          nutrition: {
            aggregated_set: {
              preparation: 'as_sold',
              per: '100g',
              nutrients: { carbohydrates: { value: 51.2, unit: 'g' } }
            }
          }
        }
      });
    });
    const result = await core.product('4000417025005', { productApiMode: 'v3' });
    const url = new URL(requests[0].url);
    expect(url.pathname).toBe('/api/v3.6/product/4000417025005');
    expect(url.searchParams.get('fields')?.split(',')).toContain('nutrition');
    expect(url.searchParams.get('fields')?.split(',')).not.toContain('nutriments');
    expect(result.product.nutriments.carbohydrates_100g).toBe(51.2);
    expect(result.status).toBe('success');
  });

  it('normalizes a v2 numeric status before returning the gateway contract', async () => {
    const core = gateway(async () => response({
      status: 1,
      code: '0034000470693',
      product: { code: '0034000470693', nutriments: { carbohydrates_100g: 12 } }
    }));
    const result = await core.product('034000470693', { productApiMode: 'v2' });
    expect(result.status).toBe('1');
    expect(result.code).toBe('0034000470693');
  });

  it('rejects a malformed HTTP-200 product payload', async () => {
    const core = gateway(async () => response({}));
    await expect(core.product('4000417025005', { productApiMode: 'v3' }))
      .rejects.toMatchObject({
        status: 502,
        code: 'UPSTREAM_CONTRACT_VIOLATION',
        attempts: [expect.objectContaining({ outcome: 'parse-error' })]
      });
  });

  it.each([
    [{ status: 'success', product: {} }],
    [{ status: 'success', product: [] }],
    [{ status: 'success' }]
  ])('rejects a synthetic success without a documented product identity (%j)', async (payload) => {
    const core = gateway(async () => response(payload));
    await expect(core.product('4000417025005', { productApiMode: 'v3' }))
      .rejects.toMatchObject({ status: 502, code: 'UPSTREAM_CONTRACT_VIOLATION' });
  });

  it('maps a documented product failure payload to not-found', async () => {
    const core = gateway(async () => response({ status: 'failure', errors: [{ message: 'not found' }] }));
    await expect(core.product('4000417025005', { productApiMode: 'v3' }))
      .rejects.toMatchObject({ status: 404, code: 'NOT_FOUND' });
  });

  it('does not reuse shared product cache data after the OFF origin changes', async () => {
    const ports = createPersistencePorts({ url: '' });
    const payload = (carbohydrates) => ({
      status: 'success',
      code: '4000417025005',
      product: {
        code: '4000417025005',
        nutrition: {
          aggregated_set: {
            preparation: 'as_sold',
            per: '100g',
            nutrients: { carbohydrates: { value: carbohydrates, unit: 'g' } }
          }
        }
      }
    });
    const firstFetch = vi.fn(async () => response(payload(10)));
    const secondFetch = vi.fn(async () => response(payload(20)));
    const firstCore = createGatewayCore({
      version: '2.2.4', fetchFn: firstFetch, ports, env: { OFF_BASE_URL: 'https://off-a.example/' }
    });
    const secondCore = createGatewayCore({
      version: '2.2.4', fetchFn: secondFetch, ports, env: { OFF_BASE_URL: 'https://off-b.example/' }
    });

    const first = await firstCore.product('4000417025005', { productApiMode: 'v3' });
    const second = await secondCore.product('4000417025005', { productApiMode: 'v3' });
    expect(first.product.nutriments.carbohydrates_100g).toBe(10);
    expect(second.product.nutriments.carbohydrates_100g).toBe(20);
    expect(first.api_meta.cacheKey).not.toBe(second.api_meta.cacheKey);
    expect(secondFetch).toHaveBeenCalledOnce();
  });
});

describe('GatewayCore health and configuration', () => {
  it('requires the package version explicitly instead of embedding a stale fallback', () => {
    expect(() => createGatewayCore({ env: {}, fetchFn: vi.fn(), ports: createPersistencePorts({ url: '' }) }))
      .toThrow('explicit package version');
  });

  it('reports the memory-only deployment as ready but degraded', async () => {
    const fetchFn = vi.fn(async (url) => {
      expect(new URL(url).pathname).toBe('/health');
      return new Response('{}', { status: 200 });
    });
    const core = gateway(fetchFn);
    const health = await core.health();
    expect(health).toMatchObject({
      ok: true,
      ready: true,
      status: 'degraded',
      cacheBackend: { requested: 'memory', effective: 'memory', connectivity: 'ready', degraded: true },
      capabilities: { distributedCoordination: false },
      components: { distributedCoordination: { status: 'disabled' } }
    });
    expect(fetchFn).toHaveBeenCalledOnce();
    expect(String(fetchFn.mock.calls[0][0])).not.toContain('/search');
  });

  it('fails closed in production when distributed coordination is missing', async () => {
    const fetchFn = vi.fn();
    const core = gateway(fetchFn, {
      NODE_ENV: 'production',
      SEARCH_INDEX_URL: '',
      GATEWAY_CLIENT_SALT: CLIENT_SALT
    });

    await expect(core.search('production query', 10, { searchApiMode: 'off-legacy' }))
      .rejects.toMatchObject({ status: 503, code: 'DISTRIBUTED_COORDINATION_REQUIRED' });
    await expect(core.product('4000417025005', { productApiMode: 'v3' }))
      .rejects.toMatchObject({ status: 503, code: 'DISTRIBUTED_COORDINATION_REQUIRED' });
    expect(await core.health()).toMatchObject({
      ok: false,
      ready: false,
      status: 'unhealthy',
      capabilities: { distributedCoordination: false },
      components: { distributedCoordination: { status: 'unavailable' } }
    });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('fails readiness closed when production client budgets cannot be pseudonymized', async () => {
    const core = gateway(vi.fn(), {
      NODE_ENV: 'production',
      ALLOW_SINGLE_INSTANCE_COORDINATION: '1',
      SEARCH_INDEX_URL: ''
    });
    expect(await core.health()).toMatchObject({
      ok: false,
      ready: false,
      status: 'unhealthy',
      components: { requestBudgets: { status: 'unavailable' } },
      rateLimits: { clientScoped: false }
    });
    await expect(core.search('missing identity', 10, { searchApiMode: 'legacy' }))
      .rejects.toMatchObject({ status: 503, code: 'CLIENT_BUDGET_IDENTIFIER_REQUIRED' });
  });

  it('allows an explicit single-instance production deployment without Redis', async () => {
    const fetchFn = vi.fn(async () => response({
      status: 'success',
      code: '4000417025005',
      product: {
        code: '4000417025005',
        nutrition: {
          aggregated_set: {
            preparation: 'as_sold',
            per: '100g',
            nutrients: { carbohydrates: { value: 12, unit: 'g' } }
          }
        }
      }
    }));
    const core = gateway(fetchFn, {
      NODE_ENV: 'production',
      ALLOW_SINGLE_INSTANCE_COORDINATION: '1',
      GATEWAY_CLIENT_SALT: CLIENT_SALT,
      SEARCH_INDEX_URL: ''
    });

    await expect(core.product('4000417025005', { productApiMode: 'v3', clientKey: CLIENT_KEY }))
      .resolves.toMatchObject({ code: '4000417025005' });
    expect(await core.health()).toMatchObject({
      ok: true,
      ready: true,
      status: 'degraded',
      components: { distributedCoordination: { status: 'disabled' } }
    });
    expect(fetchFn).toHaveBeenCalledOnce();
  });

  it('forces Redis failures closed whenever distributed coordination is required', () => {
    const core = gateway(vi.fn(), {
      NODE_ENV: 'production',
      REDIS_URL: 'redis://cache.example:6379',
      REDIS_FAILURE_MODE: 'memory'
    });
    expect(core.config.redisFailureMode).toBe('closed');
  });

  it('wires cache and safety coordination to distinct Redis roles', () => {
    const core = createGatewayCore({
      version: '2.2.4',
      fetchFn: vi.fn(),
      env: {
        NODE_ENV: 'production',
        REDIS_COORDINATION_URL: 'redis://coordination.example:6379/0',
        REDIS_CACHE_URL: 'redis://cache.example:6379/0',
        SEARCH_INDEX_URL: ''
      }
    });
    expect(core.coordinator.runtime.url).toBe('redis://coordination.example:6379/0');
    expect(core.cache.runtime.url).toBe('redis://cache.example:6379/0');
    expect(core.coordinator.runtime).not.toBe(core.cache.runtime);
    expect(core.config.redisRolesIsolated).toBe(true);
  });

  it('rejects a production cache and safety role sharing one Redis keyspace', () => {
    const core = gateway(vi.fn(), {
      NODE_ENV: 'production',
      REDIS_COORDINATION_URL: 'redis://shared.example:6379/0',
      REDIS_CACHE_URL: 'redis://other-user:secret@shared.example:6379/00'
    });
    expect(core.config.redisCacheUrl).toBe('');
    expect(core.config.redisRolesIsolated).toBe(false);
    expect(core.config.configurationErrors).toContainEqual({
      component: 'distributedCache',
      code: 'REDIS_ROLES_NOT_ISOLATED'
    });
  });

  it.each([
    ['closed', false, 'unhealthy'],
    ['memory', true, 'degraded']
  ])('probes Redis cold-start and reports failure mode %s honestly', async (failureMode, ready, status) => {
    const client = {
      isReady: false,
      on: vi.fn(),
      connect: vi.fn().mockRejectedValue(new Error('connect failed')),
      destroy: vi.fn()
    };
    const ports = createPersistencePorts({
      url: 'redis://cache.example:6379',
      commandTimeoutMs: 50,
      failureMode,
      clientFactory: () => client,
      logger: { warn: vi.fn() }
    });
    const core = createGatewayCore({
      version: '2.2.4',
      fetchFn: vi.fn(),
      ports,
      env: {
        NODE_ENV: 'test',
        REDIS_URL: 'redis://cache.example:6379',
        REDIS_FAILURE_MODE: failureMode,
        SEARCH_INDEX_URL: '',
        REDIS_COMMAND_TIMEOUT_MS: '50'
      }
    });

    const health = await core.health();
    expect(client.connect).toHaveBeenCalledOnce();
    expect(health).toMatchObject({
      ok: ready,
      ready,
      status,
      cacheBackend: {
        requested: 'redis',
        effective: 'memory',
        connectivity: 'unavailable',
        degraded: true
      },
      components: { distributedCoordination: { status: 'unavailable' } }
    });
  });

  it('does not advertise paid AI in production when its safety salt is missing', async () => {
    const core = gateway(vi.fn(), {
      NODE_ENV: 'production',
      ALLOW_SINGLE_INSTANCE_COORDINATION: '1',
      GATEWAY_CLIENT_SALT: CLIENT_SALT,
      SEARCH_INDEX_URL: '',
      OPENAI_API_KEY: 'paid-key-is-present',
      AI_SAFETY_SALT: ''
    });
    const health = await core.health();
    expect(health).toMatchObject({
      ok: true,
      ready: true,
      status: 'degraded',
      openaiConfigured: false,
      capabilities: { aiParse: false },
      components: {
        aiParse: {
          status: 'unavailable',
          reason: expect.stringMatching(/AI_SAFETY_SALT.*fail-closed/i)
        }
      }
    });
    expect(core.config.configurationErrors).toContainEqual({
      component: 'aiParse',
      code: 'AI_SAFETY_SALT_MISSING_OR_WEAK'
    });
  });

  it('advertises paid AI in production only with a strong safety salt', async () => {
    const core = gateway(vi.fn(), {
      NODE_ENV: 'production',
      ALLOW_SINGLE_INSTANCE_COORDINATION: '1',
      GATEWAY_CLIENT_SALT: CLIENT_SALT,
      SEARCH_INDEX_URL: '',
      OPENAI_API_KEY: 'paid-key-is-present',
      AI_SAFETY_SALT: '0123456789abcdef0123456789abcdef'
    });
    const health = await core.health();
    expect(health).toMatchObject({
      openaiConfigured: true,
      capabilities: { aiParse: true },
      components: { aiParse: { status: 'ready', reason: null } }
    });
    expect(core.config.configurationErrors).not.toContainEqual(expect.objectContaining({ component: 'aiParse' }));
  });

  it('rejects unsafe configured OFF protocols without silently using production OFF', async () => {
    const fetchFn = vi.fn();
    const core = gateway(fetchFn, { OFF_BASE_URL: 'ftp://off.internal/', SEARCH_INDEX_URL: '' });
    await expect(core.product('4000417025005', { productApiMode: 'v3' }))
      .rejects.toMatchObject({ status: 503, code: 'OFF_BASE_URL_INVALID' });
    expect((await core.health()).components.offProductApi.status).toBe('unavailable');
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('requires an explicit opt-in before sending index credentials over internal HTTP', async () => {
    const blocked = gateway(vi.fn(), {
      NODE_ENV: 'production',
      ALLOW_SINGLE_INSTANCE_COORDINATION: '1',
      GATEWAY_CLIENT_SALT: CLIENT_SALT,
      SEARCH_INDEX_URL: 'http://index.internal:8000/'
    });
    expect(blocked.config.configurationErrors).toContainEqual({
      component: 'searchIndex',
      code: 'INSECURE_HTTP'
    });
    await expect(blocked.search('secure index', 10, {
      searchApiMode: 'search-index', clientKey: CLIENT_KEY
    }))
      .rejects.toMatchObject({ status: 503, code: 'SEARCH_INDEX_NOT_CONFIGURED' });

    const allowedFetch = vi.fn(async () => response({ hits: [] }));
    const allowed = gateway(allowedFetch, {
      NODE_ENV: 'production',
      ALLOW_SINGLE_INSTANCE_COORDINATION: '1',
      GATEWAY_CLIENT_SALT: CLIENT_SALT,
      SEARCH_INDEX_URL: 'http://index.internal:8000/',
      SEARCH_INDEX_ALLOW_INSECURE_HTTP: '1'
    });
    await expect(allowed.search('secure index', 10, {
      searchApiMode: 'search-index', clientKey: CLIENT_KEY
    }))
      .resolves.toMatchObject({ hits: [] });
    expect(allowedFetch).toHaveBeenCalledOnce();
  });
});

describe('gateway diagnostic provenance', () => {
  const base = {
    fallbackReason: 'http',
    fallbackStatus: 503
  };

  it('does not claim a network call for circuit, local-budget or coordination bypasses', () => {
    expect(networkAttemptedForAttempts([{ outcome: 'aborted', errorName: 'CircuitOpen' }])).toBe(false);
    expect(networkAttemptedForAttempts([{ outcome: 'rate-limit', errorName: 'GatewayRateLimit' }])).toBe(false);
    expect(networkAttemptedForAttempts([])).toBe(false);
    expect(fallbackOriginForResult({ ...base, attempts: [{ errorName: 'CircuitOpen' }] })).toBeUndefined();
  });

  it('distinguishes actual remote 429/503 responses from local decisions', () => {
    const rate = { outcome: 'rate-limit', errorName: 'HTTPError', status: 429 };
    const overload = { outcome: 'http-error', errorName: 'HTTPError', status: 503 };
    expect(networkAttemptedForAttempts([rate])).toBe(true);
    expect(networkAttemptedForAttempts([overload])).toBe(true);
    expect(fallbackOriginForResult({ ...base, fallbackStatus: 429, attempts: [rate] })).toBe('remote-limit');
    expect(fallbackOriginForResult({ ...base, attempts: [overload] })).toBe('remote-overload');
    expect(fallbackOriginForResult({
      ...base,
      fallbackReason: 'rate-limit',
      fallbackStatus: 429,
      attempts: [{ outcome: 'rate-limit', errorName: 'GatewayRateLimit' }]
    })).toBe('local-budget');
  });

  it('counts a caller abort after fetch start as a network attempt', () => {
    expect(networkAttemptedForAttempts([{ outcome: 'aborted', errorName: 'AbortError' }])).toBe(true);
  });
});
