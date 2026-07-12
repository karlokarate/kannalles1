const MAX_QUERY_LENGTH = 120;
const SEARCH_A_LICIOUS_TIMEOUT_MS = 2_000;
const LEGACY_SEARCH_TIMEOUT_MS = 6_000;
const PRODUCT_TIMEOUT_MS = 8_500;

const SEARCH_FIELDS = [
  'code',
  'product_name',
  'product_name_de',
  'generic_name',
  'generic_name_de',
  'brands',
  'quantity',
  'product_quantity',
  'product_quantity_unit',
  'serving_size',
  'serving_quantity',
  'countries_tags',
  'categories_tags',
  'nutriments',
  'image_front_url',
  'unique_scans_n',
  'completeness'
];

const SEARCH_A_LICIOUS_FIELDS = [
  'code',
  'product_name',
  'product_name_de',
  'generic_name',
  'generic_name_de',
  'brands',
  'quantity',
  'nutriments',
  'image_front_url',
  'unique_scans_n',
  'completeness',
  '_score'
];

const PRODUCT_FIELDS = [...SEARCH_FIELDS];

const gatewayCache = globalThis.__KH_VERCEL_GATEWAY_CACHE__ ?? new Map();
const gatewayInFlight = globalThis.__KH_VERCEL_GATEWAY_INFLIGHT__ ?? new Map();
globalThis.__KH_VERCEL_GATEWAY_CACHE__ = gatewayCache;
globalThis.__KH_VERCEL_GATEWAY_INFLIGHT__ = gatewayInFlight;

const APP_VERSION = process.env.npm_package_version || '2.2.4';
const OFF_CONTACT_EMAIL = 'chrisfischtopher@googlemail.com';
const OFF_USER_AGENT = `KH-Checker/${APP_VERSION} (+https://karlokarate.github.io/kannalles1/; contact: ${OFF_CONTACT_EMAIL})`;

function parseRetryAfter(value, now = Date.now()) {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1_000);
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? Math.max(0, timestamp - now) : null;
}

function cleanPreview(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 500);
}

function buildUpstreamHeaders() {
  return {
    Accept: 'application/json',
    'User-Agent': OFF_USER_AGENT,
    From: OFF_CONTACT_EMAIL
  };
}

function normalizeOrigin(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (raw === '*') return '*';
  try {
    return new URL(raw).origin;
  } catch {
    return raw.replace(/\/+$/, '');
  }
}

function requestOrigin(res) {
  return String(res?.req?.headers?.origin || '').trim();
}

function allowedCorsOrigin(res) {
  const requested = requestOrigin(res);
  const configured = String(process.env.CORS_ORIGINS || '').trim();

  if (!configured) return '*';

  const allowed = new Set([
    'https://karlokarate.github.io',
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    ...configured.split(',').map(normalizeOrigin).filter(Boolean)
  ]);

  if (allowed.has('*')) return '*';
  if (!requested) return '*';
  return allowed.has(normalizeOrigin(requested)) ? normalizeOrigin(requested) : 'null';
}

export function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', allowedCorsOrigin(res));
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Expose-Headers', 'Retry-After,X-KH-Gateway-Cache');
  res.setHeader('Access-Control-Max-Age', '86400');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
}

export function handleOptions(req, res) {
  setCors(res);
  if (req.method !== 'OPTIONS') return false;
  res.status(204).end();
  return true;
}

class UpstreamError extends Error {
  constructor(message, { status, attempts, retryAt } = {}) {
    super(message);
    this.name = 'UpstreamError';
    this.status = status;
    this.attempts = attempts || [];
    this.retryAt = retryAt;
  }
}

async function fetchUpstreamJson(url, backend, label, timeoutMs) {
  const startedAt = Date.now();
  const startedIso = new Date(startedAt).toISOString();
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort(new DOMException('Timeout', 'TimeoutError'));
  }, timeoutMs);

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: buildUpstreamHeaders(),
      redirect: 'follow',
      signal: controller.signal
    });

    const text = await response.text();
    const durationMs = Date.now() - startedAt;
    const retryAfterMs = parseRetryAfter(response.headers.get('Retry-After'));

    if (!response.ok) {
      const attempt = {
        backend,
        label,
        url: url.toString(),
        startedAt: startedIso,
        durationMs,
        outcome: response.status === 429 ? 'rate-limit' : 'http-error',
        status: response.status,
        errorName: 'HTTPError',
        errorMessage: `HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}`,
        responsePreview: cleanPreview(text),
        ...(retryAfterMs !== null ? { retryAfterMs } : {})
      };
      throw new UpstreamError(attempt.errorMessage, {
        status: response.status,
        attempts: [attempt],
        retryAt: retryAfterMs !== null ? Date.now() + retryAfterMs : undefined
      });
    }

    try {
      return {
        data: JSON.parse(text),
        attempt: {
          backend,
          label,
          url: url.toString(),
          startedAt: startedIso,
          durationMs,
          outcome: 'success',
          status: response.status
        }
      };
    } catch (error) {
      const attempt = {
        backend,
        label,
        url: url.toString(),
        startedAt: startedIso,
        durationMs,
        outcome: 'parse-error',
        status: response.status,
        errorName: error?.name || 'SyntaxError',
        errorMessage: error?.message || 'Invalid JSON',
        responsePreview: cleanPreview(text)
      };
      throw new UpstreamError('Ungültige JSON-Antwort vom Upstream.', {
        status: response.status,
        attempts: [attempt]
      });
    }
  } catch (error) {
    if (error instanceof UpstreamError) throw error;
    const durationMs = Date.now() - startedAt;
    const attempt = {
      backend,
      label,
      url: url.toString(),
      startedAt: startedIso,
      durationMs,
      outcome: timedOut ? 'timeout' : 'network-error',
      errorName: timedOut ? 'TimeoutError' : error?.name || 'Error',
      errorMessage: timedOut ? `Zeitüberschreitung nach ${timeoutMs} ms` : error?.message || String(error)
    };
    throw new UpstreamError(`${attempt.errorName}: ${attempt.errorMessage}`, {
      attempts: [attempt]
    });
  } finally {
    clearTimeout(timeout);
  }
}

function canonicalQuery(value) {
  const raw = String(value || '').trim().slice(0, MAX_QUERY_LENGTH);
  const compact = raw
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('de-DE')
    .replace(/[^a-z0-9]+/g, '');
  return compact || encodeURIComponent(raw.toLocaleLowerCase('de-DE'));
}

function buildSearchALiciousUrl(query, pageSize) {
  const url = new URL('https://search.openfoodfacts.org/search');
  url.searchParams.set('q', query);
  url.searchParams.set('langs', 'de,main');
  url.searchParams.set('page_size', String(pageSize));
  url.searchParams.set('fields', SEARCH_A_LICIOUS_FIELDS.join(','));
  return url;
}

function buildLegacySearchUrl(query, pageSize) {
  const url = new URL('https://world.openfoodfacts.org/cgi/search.pl');
  url.searchParams.set('action', 'process');
  url.searchParams.set('json', '1');
  url.searchParams.set('search_simple', '1');
  url.searchParams.set('search_terms', query);
  url.searchParams.set('page', '1');
  url.searchParams.set('page_size', String(pageSize));
  url.searchParams.set('lc', 'de');
  url.searchParams.set('cc', 'de');
  url.searchParams.set('fields', SEARCH_FIELDS.join(','));
  return url;
}

function buildV3ProductUrl(code) {
  const url = new URL(`https://world.openfoodfacts.org/api/v3.6/product/${encodeURIComponent(code)}.json`);
  url.searchParams.set('lc', 'de');
  url.searchParams.set('cc', 'de');
  url.searchParams.set('tags_lc', 'de');
  url.searchParams.set('fields', PRODUCT_FIELDS.join(','));
  return url;
}

function buildV2ProductUrl(code) {
  const url = new URL(`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json`);
  url.searchParams.set('lc', 'de');
  url.searchParams.set('cc', 'de');
  url.searchParams.set('fields', PRODUCT_FIELDS.join(','));
  return url;
}

function normalizeLegacySearch(data, query) {
  return {
    hits: Array.isArray(data?.products) ? data.products : [],
    count: data?.count,
    page: data?.page,
    page_size: data?.page_size,
    page_count: data?.page_count,
    source: 'open-food-facts-legacy',
    query_used: query
  };
}

function mergeProducts(base, extra) {
  if (!base) return extra;
  if (!extra) return base;
  return {
    ...base,
    ...extra,
    nutriments: { ...(base.nutriments || {}), ...(extra.nutriments || {}) }
  };
}

function hasCarbohydrateData(product) {
  const nutrients = product?.nutriments || {};
  return [
    nutrients.carbohydrates_100g,
    nutrients.carbohydrates_100ml,
    nutrients.carbohydrates_prepared_100g,
    nutrients.carbohydrates_prepared_100ml
  ].some((value) => typeof value === 'number' && Number.isFinite(value));
}

function cacheHitAttempt(key, storedAt, stale = false) {
  return {
    backend: 'gateway',
    label: stale ? 'Gateway-Cache (Ausfallreserve)' : 'Gateway-Cache',
    url: `gateway-cache://${encodeURIComponent(key)}`,
    startedAt: new Date().toISOString(),
    durationMs: 0,
    outcome: 'cache-hit',
    cacheAgeMs: Math.max(0, Date.now() - storedAt)
  };
}

function trimGatewayCache(maxEntries = 240) {
  if (gatewayCache.size <= maxEntries) return;
  const entries = [...gatewayCache.entries()].sort((a, b) => a[1].storedAt - b[1].storedAt);
  for (const [key] of entries.slice(0, gatewayCache.size - maxEntries)) gatewayCache.delete(key);
}

async function cachedGatewayLoad({ key, freshMs, staleMs, load }) {
  const now = Date.now();
  const cached = gatewayCache.get(key);
  if (cached && cached.expiresAt > now) {
    return { value: cached.value, attempts: [cacheHitAttempt(key, cached.storedAt)], cacheStatus: 'fresh' };
  }

  let task = gatewayInFlight.get(key);
  if (!task) {
    task = load()
      .then((result) => {
        const storedAt = Date.now();
        const effectiveFreshMs = Number.isFinite(result.freshMs) ? Math.max(0, result.freshMs) : freshMs;
        const effectiveStaleMs = Number.isFinite(result.staleMs)
          ? Math.max(effectiveFreshMs, result.staleMs)
          : staleMs;
        gatewayCache.set(key, {
          value: result.value,
          storedAt,
          expiresAt: storedAt + effectiveFreshMs,
          staleUntil: storedAt + effectiveStaleMs
        });
        trimGatewayCache();
        return result;
      })
      .finally(() => {
        if (gatewayInFlight.get(key) === task) gatewayInFlight.delete(key);
      });
    gatewayInFlight.set(key, task);
  }

  try {
    const result = await task;
    return { ...result, cacheStatus: 'network' };
  } catch (error) {
    if (cached && cached.staleUntil > now) {
      return {
        value: cached.value,
        attempts: [...(error?.attempts || []), cacheHitAttempt(key, cached.storedAt, true)],
        cacheStatus: 'stale'
      };
    }
    throw error;
  }
}

export function sendGatewayError(res, error, publicMessage) {
  const status = error instanceof UpstreamError && Number.isInteger(error.status) ? error.status : 502;
  if (error?.retryAt && Number.isFinite(Number(error.retryAt))) {
    const seconds = Math.max(1, Math.ceil((Number(error.retryAt) - Date.now()) / 1_000));
    res.setHeader('Retry-After', String(seconds));
  }
  res.status(status).json({
    error: publicMessage,
    detail: error?.message || String(error),
    attempts: error?.attempts || [],
    retryAt: error?.retryAt ? new Date(error.retryAt).toISOString() : undefined
  });
}

function normalizeSearchApiMode(mode) {
  return mode === 'legacy-only' ? 'legacy-only' : 'auto';
}

export async function searchThroughGateway(query, pageSize, options = {}) {
  const searchApiMode = normalizeSearchApiMode(options.searchApiMode);
  const key = `search:${canonicalQuery(query)}:${pageSize}:${searchApiMode}`;
  const result = await cachedGatewayLoad({
    key,
    freshMs: 10 * 60 * 1_000,
    staleMs: 24 * 60 * 60 * 1_000,
    load: async () => {
      const attempts = [];
      let reachableEmptyResponse = null;
      let lastError = null;

      if (searchApiMode !== 'legacy-only') {
        const searchALiciousUrl = buildSearchALiciousUrl(query, pageSize);
        try {
          const response = await fetchUpstreamJson(
            searchALiciousUrl,
            'search-a-licious',
            'Search-a-licious',
            SEARCH_A_LICIOUS_TIMEOUT_MS
          );
          attempts.push(response.attempt);
          const value = {
            ...response.data,
            hits: Array.isArray(response.data?.hits) ? response.data.hits : [],
            source: 'search-a-licious',
            query_used: query
          };
          if (value.hits.length > 0) return { value, attempts };
          reachableEmptyResponse = value;
        } catch (error) {
          lastError = error;
          if (error instanceof UpstreamError) attempts.push(...error.attempts);
        }
      }

      const legacyUrl = buildLegacySearchUrl(query, pageSize);
      try {
        const response = await fetchUpstreamJson(
          legacyUrl,
          'open-food-facts-legacy',
          'Open Food Facts Legacy-Suche',
          LEGACY_SEARCH_TIMEOUT_MS
        );
        attempts.push(response.attempt);
        return { value: normalizeLegacySearch(response.data, query), attempts };
      } catch (error) {
        lastError = error;
        if (error instanceof UpstreamError) attempts.push(...error.attempts);
      }

      if (reachableEmptyResponse) return { value: reachableEmptyResponse, attempts };

      throw new UpstreamError('Keine Open-Food-Facts-Suche war erreichbar.', {
        status: lastError instanceof UpstreamError ? lastError.status : 503,
        attempts,
        retryAt: lastError instanceof UpstreamError ? lastError.retryAt : undefined
      });
    }
  });

  return {
    ...result.value,
    gateway_attempts: result.attempts,
    api_meta: {
      cacheStatus: result.cacheStatus,
      fetchedAt: new Date().toISOString(),
      sourceUrl: '/api/search',
      backend: 'gateway',
      originBackend: 'gateway',
      networkAttempted: result.attempts.some((attempt) => attempt.outcome !== 'cache-hit'),
      durationMs: result.attempts.reduce((sum, attempt) => sum + Number(attempt.durationMs || 0), 0),
      attempts: result.attempts
    }
  };
}

function normalizeProductApiMode(mode) {
  return mode === 'v2' || mode === 'v3' || mode === 'hybrid' ? mode : 'hybrid';
}

export async function productThroughGateway(code, options = {}) {
  const knownCarbohydrates = options.knownCarbohydrates === true;
  const productApiMode = normalizeProductApiMode(options.productApiMode);
  const key = `product:${code}:${productApiMode}:${knownCarbohydrates ? 'seeded' : 'complete'}`;
  const result = await cachedGatewayLoad({
    key,
    freshMs: 24 * 60 * 60 * 1_000,
    staleMs: 30 * 24 * 60 * 60 * 1_000,
    load: async () => {
      const attempts = [];
      let v3Data = null;

      if (productApiMode === 'v2') {
        const response = await fetchUpstreamJson(
          buildV2ProductUrl(code),
          'open-food-facts-v2',
          'Open Food Facts API v2',
          PRODUCT_TIMEOUT_MS
        );
        attempts.push(response.attempt);
        if (!response.data?.product) {
          throw new UpstreamError('Für diesen Barcode wurde kein Produkt gefunden.', { status: 404, attempts });
        }
        return { value: response.data, attempts };
      }

      try {
        const response = await fetchUpstreamJson(
          buildV3ProductUrl(code),
          'open-food-facts-v3',
          'Open Food Facts API v3.6',
          PRODUCT_TIMEOUT_MS
        );
        attempts.push(response.attempt);
        v3Data = response.data;
        if (
          v3Data?.product &&
          (productApiMode === 'v3' || knownCarbohydrates || hasCarbohydrateData(v3Data.product))
        ) {
          return { value: v3Data, attempts };
        }
      } catch (error) {
        if (error instanceof UpstreamError) attempts.push(...error.attempts);
        if (productApiMode === 'v3') {
          throw new UpstreamError('Produktdetails konnten über v3.6 nicht geladen werden.', {
            status: error instanceof UpstreamError ? error.status : undefined,
            attempts,
            retryAt: error instanceof UpstreamError ? error.retryAt : undefined
          });
        }
      }

      try {
        const response = await fetchUpstreamJson(
          buildV2ProductUrl(code),
          'open-food-facts-v2',
          'Open Food Facts API v2 (Fallback)',
          PRODUCT_TIMEOUT_MS
        );
        attempts.push(response.attempt);
        const value = {
          ...v3Data,
          ...response.data,
          product: mergeProducts(v3Data?.product, response.data?.product)
        };
        if (!value.product) {
          throw new UpstreamError('Für diesen Barcode wurde kein Produkt gefunden.', { status: 404, attempts });
        }
        return { value, attempts };
      } catch (error) {
        if (error instanceof UpstreamError) attempts.push(...error.attempts);
        if (v3Data?.product) {
          return {
            value: v3Data,
            attempts,
            freshMs: 5 * 60 * 1_000,
            staleMs: 24 * 60 * 60 * 1_000
          };
        }
        throw new UpstreamError('Produktdetails konnten über v3.6 und v2 nicht geladen werden.', {
          status: error instanceof UpstreamError ? error.status : undefined,
          attempts,
          retryAt: error instanceof UpstreamError ? error.retryAt : undefined
        });
      }
    }
  });

  return {
    ...result.value,
    gateway_attempts: result.attempts,
    api_meta: {
      cacheStatus: result.cacheStatus,
      fetchedAt: new Date().toISOString(),
      sourceUrl: `/api/product/${code}`,
      backend: 'gateway',
      originBackend: 'gateway',
      networkAttempted: result.attempts.some((attempt) => attempt.outcome !== 'cache-hit'),
      durationMs: result.attempts.reduce((sum, attempt) => sum + Number(attempt.durationMs || 0), 0),
      attempts: result.attempts
    }
  };
}
