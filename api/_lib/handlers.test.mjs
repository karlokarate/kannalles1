import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GatewayError } from '../../server/gateway-core/index.mjs';
import { healthHandler, productHandler, searchHandler } from './handlers.js';
import { getGatewayCore } from './gateway.js';

const packageVersion = JSON.parse(
  readFileSync(new URL('../../package.json', import.meta.url), 'utf8')
).version;

function request(overrides = {}) {
  return {
    method: 'GET',
    query: {},
    params: {},
    headers: { host: 'gateway.example', 'x-forwarded-proto': 'https' },
    socket: {},
    ...overrides
  };
}

function response() {
  return {
    headers: new Map(),
    statusCode: 200,
    body: undefined,
    setHeader(name, value) {
      this.headers.set(String(name).toLocaleLowerCase('en-US'), String(value));
    },
    status(value) {
      this.statusCode = value;
      return this;
    },
    json(value) {
      this.body = value;
      return this;
    },
    end() {
      return this;
    }
  };
}

describe('thin HTTP gateway handlers', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.CORS_ORIGINS;
    delete process.env.TRUST_PROXY;
  });

  it('serves the strict versioned health shape without touching an upstream', async () => {
    const res = response();
    await healthHandler(request(), res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      service: 'kh-data-gateway',
      apiVersion: '1',
      version: packageVersion,
      ready: true,
      status: 'degraded'
    });
  });

  it('returns HTTP 503 when the gateway reports that it is not traffic-ready', async () => {
    const core = getGatewayCore();
    const original = core.health;
    const baseline = await original.call(core);
    core.health = vi.fn().mockResolvedValue({
      ...baseline,
      ok: false,
      ready: false,
      status: 'unhealthy',
      cacheBackend: { ...baseline.cacheBackend, degraded: true }
    });
    try {
      const res = response();
      await healthHandler(request(), res);
      expect(res.statusCode).toBe(503);
      expect(res.body).toMatchObject({ ok: false, ready: false, status: 'unhealthy' });
    } finally {
      core.health = original;
    }
  });

  it('returns traced contract errors for invalid search and product input', async () => {
    const searchRes = response();
    await searchHandler(request(), searchRes);
    expect(searchRes.statusCode).toBe(400);
    expect(searchRes.body).toMatchObject({ error: expect.any(String), traceId: expect.any(String) });

    const productRes = response();
    await productHandler(request({ params: { code: 'invalid' } }), productRes);
    expect(productRes.statusCode).toBe(400);
    expect(productRes.body).toMatchObject({ error: expect.any(String), traceId: expect.any(String) });
  });

  it.each([
    [{ q: 'Produkt', page_size: '999' }, 'page_size above max'],
    [{ q: 'Produkt', page_size: '1.5' }, 'non-integer page_size'],
    [{ q: 'Produkt', search_api: 'unknown' }, 'unknown search_api'],
    [{ q: 'Produkt', unexpected: '1' }, 'unknown query member']
  ])('rejects search request drift: %s (%s)', async (query) => {
    const res = response();
    await searchHandler(request({ query }), res);
    expect(res.statusCode).toBe(400);
    expect(res.body.traceId).toEqual(expect.any(String));
  });

  it.each([
    [{ known_carbs: 'foo' }, 'invalid known_carbs'],
    [{ product_api: 'unknown' }, 'unknown product_api'],
    [{ unexpected: '1' }, 'unknown query member']
  ])('rejects product request drift: %s (%s)', async (query) => {
    const res = response();
    await productHandler(request({ params: { code: '1234567' }, query }), res);
    expect(res.statusCode).toBe(400);
    expect(res.body.traceId).toEqual(expect.any(String));
  });

  it('advertises allowed methods on 405 responses', async () => {
    const res = response();
    await healthHandler(request({ method: 'POST' }), res);
    expect(res.statusCode).toBe(405);
    expect(res.headers.get('allow')).toBe('GET, OPTIONS');
    expect(res.body.traceId).toEqual(expect.any(String));
  });

  it('marks aliases deprecated without duplicating handler logic', async () => {
    const res = response();
    await healthHandler(request(), res, { deprecated: true, successorPath: '/api/v1/health' });
    expect(res.headers.get('deprecation')).toBe('true');
    expect(res.headers.get('link')).toContain('/api/v1/health');
  });

  it('rejects a cross-origin request unless it is explicitly allowed', async () => {
    const res = response();
    await healthHandler(request({ headers: {
      host: 'gateway.example',
      'x-forwarded-proto': 'https',
      origin: 'https://attacker.example'
    } }), res);
    expect(res.statusCode).toBe(403);
    expect(res.headers.has('access-control-allow-origin')).toBe(false);
    expect(res.body.traceId).toEqual(expect.any(String));
  });

  it('does not trust spoofed forwarded origin headers outside an explicit proxy boundary', async () => {
    process.env.TRUST_PROXY = '0';
    const res = response();
    await healthHandler(request({
      headers: {
        host: 'gateway.example',
        origin: 'https://attacker.example',
        'x-forwarded-host': 'attacker.example',
        'x-forwarded-proto': 'https'
      },
      socket: { encrypted: false }
    }), res);
    expect(res.statusCode).toBe(403);
    expect(res.headers.has('access-control-allow-origin')).toBe(false);
  });

  it('uses forwarded origin headers only behind an explicitly trusted proxy boundary', async () => {
    process.env.TRUST_PROXY = '1';
    const res = response();
    await healthHandler(request({
      headers: {
        host: 'gateway.internal',
        origin: 'https://gateway.example',
        'x-forwarded-host': 'gateway.example',
        'x-forwarded-proto': 'https'
      },
      socket: { encrypted: false }
    }), res);
    expect(res.statusCode).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe('https://gateway.example');
  });

  it('always allows immediate user retry even when the upstream advises Retry-After', async () => {
    const core = getGatewayCore();
    const original = core.search;
    core.search = vi.fn().mockRejectedValue(new GatewayError('limited', {
      status: 429,
      retryAt: Date.now() + 60_000,
      code: 'UPSTREAM_HTTP_ERROR'
    }));
    try {
      const res = response();
      await searchHandler(request({ query: { q: 'Produkt' } }), res);
      expect(res.statusCode).toBe(429);
      expect(res.body.retryAllowedImmediately).toBe(true);
      expect(res.headers.get('retry-after')).toEqual(expect.any(String));
    } finally {
      core.search = original;
    }
  });
});
