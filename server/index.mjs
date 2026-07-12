import 'dotenv/config';
import fs from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cors from 'cors';
import express from 'express';
import OpenAI from 'openai';
import { zodTextFormat } from 'openai/helpers/zod';
import {
  AiParseRequestSchema,
  AiParseResponseSchema,
  HealthResponseSchema,
  ProductGatewayResponseSchema,
  SearchGatewayResponseSchema
} from './generated/search-api.schemas.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const APP_VERSION = String(packageJson.version);
const DEFAULT_PORT = 8787;
const MAX_QUERY_LENGTH = 120;
const MAX_GATEWAY_CACHE_ENTRIES = 240;
const MAX_AI_BUCKETS = 1_000;
const SEARCH_A_LICIOUS_DEFAULT_COOLDOWN_MS = 90_000;
const SEARCH_A_LICIOUS_MAX_COOLDOWN_MS = 5 * 60_000;

function safePort(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 65_535 ? parsed : DEFAULT_PORT;
}

const port = safePort(process.env.PORT || DEFAULT_PORT);
const host = String(process.env.HOST || '0.0.0.0').trim() || '0.0.0.0';
const offContactEmail = 'chrisfischtopher@googlemail.com';
const offUserAgent = `KH-Checker/${APP_VERSION} (+https://karlokarate.github.io/kannalles1/; contact: ${offContactEmail})`;
const offUsername = String(process.env.OFF_USERNAME || '').trim();
const offPassword = String(process.env.OFF_PASSWORD || '');
const configuredCorsOrigins = String(process.env.CORS_ORIGINS || '')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean);

const offSessionState = {
  cookieHeader: '',
  loginPromise: null,
  verifiedAt: 0
};

function hasOffCredentials() {
  return Boolean(offUsername && offPassword);
}

function cookieHeaderFromSetCookie(response) {
  const getSetCookie = response?.headers?.getSetCookie;
  const rawCookies = typeof getSetCookie === 'function'
    ? getSetCookie.call(response.headers)
    : [];
  const cookiePairs = rawCookies
    .map((value) => String(value).split(';', 1)[0]?.trim())
    .filter(Boolean);
  return cookiePairs.length ? cookiePairs.join('; ') : '';
}

async function loginOffSession() {
  if (!hasOffCredentials()) return '';
  const body = new URLSearchParams({
    user_id: offUsername,
    password: offPassword,
    remember_me: 'on',
    redirect: ''
  });
  const response = await fetch('https://world.openfoodfacts.org/cgi/login.pl', {
    method: 'POST',
    headers: {
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': offUserAgent,
      From: offContactEmail
    },
    body,
    redirect: 'manual'
  });
  if (!response.ok && response.status !== 302 && response.status !== 303) return '';
  return cookieHeaderFromSetCookie(response);
}

async function getOffSessionCookie() {
  if (!hasOffCredentials()) return '';
  if (offSessionState.cookieHeader) return offSessionState.cookieHeader;
  if (!offSessionState.loginPromise) {
    offSessionState.loginPromise = loginOffSession()
      .then((cookieHeader) => {
        offSessionState.cookieHeader = cookieHeader;
        offSessionState.verifiedAt = cookieHeader ? Date.now() : 0;
        return offSessionState.cookieHeader;
      })
      .catch(() => '')
      .finally(() => {
        offSessionState.loginPromise = null;
      });
  }
  return offSessionState.loginPromise;
}

function invalidateOffSession() {
  offSessionState.cookieHeader = '';
  offSessionState.verifiedAt = 0;
  offSessionState.loginPromise = null;
}

function shouldRetryOffSession(response, text) {
  if (!hasOffCredentials() || !offSessionState.cookieHeader) return false;
  if (response.status === 401 || response.status === 403) return true;
  const contentType = String(response.headers.get('content-type') || '').toLowerCase();
  if (!contentType.includes('text/html')) return false;
  const finalUrl = String(response.url || '');
  if (finalUrl.includes('/cgi/session.pl') || finalUrl.includes('/cgi/login.pl')) return true;
  const preview = cleanPreview(text).toLowerCase();
  return preview.includes('name="user_id"')
    || preview.includes('name="password"')
    || preview.includes('/cgi/login.pl');
}

async function fetchWithOffSessionRetry(url, controller) {
  const firstResponse = await fetch(url, {
    method: 'GET',
    headers: await buildOffUpstreamHeadersAsync(),
    redirect: 'follow',
    signal: controller.signal
  });
  const firstText = await firstResponse.text();
  if (!shouldRetryOffSession(firstResponse, firstText)) {
    return { response: firstResponse, text: firstText };
  }
  invalidateOffSession();
  const secondResponse = await fetch(url, {
    method: 'GET',
    headers: await buildOffUpstreamHeadersAsync(),
    redirect: 'follow',
    signal: controller.signal
  });
  const secondText = await secondResponse.text();
  return { response: secondResponse, text: secondText };
}

async function buildOffUpstreamHeadersAsync() {
  const headers = {
    Accept: 'application/json',
    'User-Agent': offUserAgent,
    From: offContactEmail
  };
  const cookieHeader = await getOffSessionCookie();
  if (cookieHeader) headers.Cookie = cookieHeader;
  return headers;
}

function isLoopbackOrigin(origin) {
  try {
    const url = new URL(origin);
    return ['localhost', '127.0.0.1', '[::1]', '::1'].includes(url.hostname);
  } catch {
    return false;
  }
}

function corsOriginAllowed(origin) {
  if (!origin) return true;
  if (configuredCorsOrigins.includes('*')) return true;
  if (configuredCorsOrigins.length > 0) return configuredCorsOrigins.includes(origin);
  // Secure local default. Deployed cross-origin frontends can opt in explicitly
  // with CORS_ORIGINS=https://app.example,https://another.example.
  return isLoopbackOrigin(origin);
}

const app = express();
app.disable('x-powered-by');
if (process.env.TRUST_PROXY === '1') app.set('trust proxy', 1);
app.use(cors({
  origin(origin, callback) {
    callback(null, corsOriginAllowed(origin));
  },
  credentials: false,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type'],
  maxAge: 86_400
}));
app.use((_, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Cross-Origin-Resource-Policy': 'cross-origin',
    'Permissions-Policy': 'camera=(), geolocation=(), payment=(), usb=()',
    'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: https:; connect-src 'self' https: http:; worker-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'"
  });
  next();
});
app.use(express.json({ limit: '16kb', strict: true }));

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
// Search-a-licious indexes a compact product projection. Product-specific
// portion fields are hydrated only after the user selects a result. Keeping
// this list aligned with the static client reduces response work and avoids
// requesting fields that are not part of the search index.
const SEARCH_A_LICIOUS_FIELDS = [
  'code',
  'product_name',
  'product_name_de',
  'generic_name',
  'generic_name_de',
  'brands',
  'quantity',
  'countries',
  'categories',
  'nutriments',
  'image_front_url',
  'unique_scans_n',
  'completeness',
  '_score'
];
const PRODUCT_FIELDS = [...SEARCH_FIELDS];

const gatewayCache = new Map();
const gatewayInFlight = new Map();
const searchALiciousCircuit = {
  openUntil: 0,
  reason: ''
};

function nowIso() {
  return new Date().toISOString();
}

function isSearchALiciousTransient(error) {
  if (!(error instanceof UpstreamError)) return false;
  if ([429, 502, 503, 504].includes(Number(error.status))) return true;
  return error.attempts.some((attempt) => ['network-error', 'timeout', 'rate-limit', 'http-error'].includes(attempt.outcome));
}

function openSearchALiciousCircuit(error) {
  if (!isSearchALiciousTransient(error)) return;
  const now = Date.now();
  const retryWindow = error instanceof UpstreamError && Number.isFinite(error.retryAt)
    ? Math.max(0, error.retryAt - now)
    : SEARCH_A_LICIOUS_DEFAULT_COOLDOWN_MS;
  const cooldownMs = Math.min(
    SEARCH_A_LICIOUS_MAX_COOLDOWN_MS,
    Math.max(SEARCH_A_LICIOUS_DEFAULT_COOLDOWN_MS, retryWindow)
  );
  searchALiciousCircuit.openUntil = now + cooldownMs;
  searchALiciousCircuit.reason = errorMessage(error);
}

function closeSearchALiciousCircuit() {
  searchALiciousCircuit.openUntil = 0;
  searchALiciousCircuit.reason = '';
}

function bypassAttemptForOpenCircuit(query) {
  const now = Date.now();
  const retryAfterMs = Math.max(0, searchALiciousCircuit.openUntil - now);
  return {
    backend: 'search-a-licious',
    label: 'Search-a-licious (temporär übersprungen)',
    url: buildSearchALiciousUrl(query, 1).toString(),
    startedAt: nowIso(),
    durationMs: 0,
    outcome: 'aborted',
    errorName: 'CircuitOpen',
    errorMessage: searchALiciousCircuit.reason || 'Temporärer Upstream-Bypass aktiv.',
    ...(retryAfterMs > 0 ? { retryAfterMs } : {})
  };
}

class UpstreamError extends Error {
  constructor(message, { status, attempt, attempts, retryAt, cause } = {}) {
    super(message, cause !== undefined ? { cause } : undefined);
    this.name = 'UpstreamError';
    this.status = status;
    this.attempts = attempts || (attempt ? [attempt] : []);
    this.retryAt = retryAt;
  }
}

function cleanPreview(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 500);
}

function parseRetryAfter(value, now = Date.now()) {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return null;
  return Math.max(0, timestamp - now);
}

function errorName(error) {
  return error instanceof Error ? error.name || 'Error' : typeof error;
}

function errorMessage(error) {
  return error instanceof Error ? error.message || String(error) : String(error);
}

async function fetchUpstreamJson(url, backend, label, timeoutMs = 8_500) {
  const startedAt = Date.now();
  const startedIso = new Date(startedAt).toISOString();
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort(new DOMException('Timeout', 'TimeoutError'));
  }, timeoutMs);

  try {
    const { response, text } = await fetchWithOffSessionRetry(url, controller);
    const durationMs = Date.now() - startedAt;
    const retryAfterMs = parseRetryAfter(response.headers.get('Retry-After'));

    if (!response.ok) {
      const outcome = response.status === 429 || response.status === 503 ? 'rate-limit' : 'http-error';
      const attempt = {
        backend,
        label,
        url: url.toString(),
        startedAt: startedIso,
        durationMs,
        outcome,
        status: response.status,
        errorName: 'HTTPError',
        errorMessage: `HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}`,
        responsePreview: cleanPreview(text),
        ...(retryAfterMs !== null ? { retryAfterMs } : {})
      };
      throw new UpstreamError(attempt.errorMessage, {
        status: response.status,
        attempt,
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
    } catch (cause) {
      const attempt = {
        backend,
        label,
        url: url.toString(),
        startedAt: startedIso,
        durationMs,
        outcome: 'parse-error',
        status: response.status,
        errorName: errorName(cause),
        errorMessage: errorMessage(cause),
        responsePreview: cleanPreview(text)
      };
      throw new UpstreamError('Ungültige JSON-Antwort vom Upstream.', { status: response.status, attempt, cause });
    }
  } catch (cause) {
    if (cause instanceof UpstreamError) throw cause;
    const durationMs = Date.now() - startedAt;
    const attempt = {
      backend,
      label,
      url: url.toString(),
      startedAt: startedIso,
      durationMs,
      outcome: timedOut ? 'timeout' : 'network-error',
      errorName: timedOut ? 'TimeoutError' : errorName(cause),
      errorMessage: timedOut ? `Zeitüberschreitung nach ${timeoutMs} ms` : errorMessage(cause)
    };
    throw new UpstreamError(`${attempt.errorName}: ${attempt.errorMessage}`, { attempt, cause });
  } finally {
    clearTimeout(timeout);
  }
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

function trimGatewayCache() {
  if (gatewayCache.size <= MAX_GATEWAY_CACHE_ENTRIES) return;
  const entries = [...gatewayCache.entries()].sort((a, b) => a[1].storedAt - b[1].storedAt);
  for (const [key] of entries.slice(0, gatewayCache.size - MAX_GATEWAY_CACHE_ENTRIES)) {
    gatewayCache.delete(key);
  }
}

async function cachedGatewayLoad({ key, freshMs, staleMs, load }) {
  const now = Date.now();
  const cached = gatewayCache.get(key);
  if (cached && cached.expiresAt > now) {
    return {
      value: cached.value,
      attempts: [cacheHitAttempt(key, cached.storedAt)],
      cacheStatus: 'fresh'
    };
  }

  let task = gatewayInFlight.get(key);
  if (!task) {
    task = load().then((result) => {
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
    }).finally(() => {
      if (gatewayInFlight.get(key) === task) gatewayInFlight.delete(key);
    });
    // The task remains owned by the gateway until it completes. A disconnected
    // browser client cannot poison or cancel a request shared by other clients.
    void task.catch(() => undefined);
    gatewayInFlight.set(key, task);
  }

  try {
    const result = await task;
    return { ...result, cacheStatus: 'network' };
  } catch (error) {
    if (cached && cached.staleUntil > now) {
      return {
        value: cached.value,
        attempts: [
          ...(error instanceof UpstreamError ? error.attempts : []),
          cacheHitAttempt(key, cached.storedAt, true)
        ],
        cacheStatus: 'stale'
      };
    }
    throw error;
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
  url.searchParams.set('langs', 'de,en,main');
  url.searchParams.set('page', '1');
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
  url.searchParams.set('sort_by', 'popularity');
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

function normalizeProductApiMode(mode) {
  if (mode === 'v2' || mode === 'v3' || mode === 'hybrid') return mode;
  return 'hybrid';
}

function normalizeSearchApiMode(mode) {
  return mode === 'legacy-only' ? 'legacy-only' : 'auto';
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
    code: extra.code ?? base.code,
    product_name: extra.product_name ?? base.product_name,
    product_name_de: extra.product_name_de ?? base.product_name_de,
    generic_name: extra.generic_name ?? base.generic_name,
    generic_name_de: extra.generic_name_de ?? base.generic_name_de,
    brands: extra.brands ?? base.brands,
    quantity: extra.quantity ?? base.quantity,
    product_quantity: extra.product_quantity ?? base.product_quantity,
    product_quantity_unit: extra.product_quantity_unit ?? base.product_quantity_unit,
    serving_size: extra.serving_size ?? base.serving_size,
    serving_quantity: extra.serving_quantity ?? base.serving_quantity,
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

function sendGatewayError(res, error, publicMessage) {
  const status = error instanceof UpstreamError
    && Number.isInteger(error.status)
    && error.status >= 400
    && error.status < 600
    ? error.status
    : 502;
  res.status(status).json({
    error: publicMessage,
    detail: errorMessage(error),
    attempts: error instanceof UpstreamError ? error.attempts : [],
    retryAt: error instanceof UpstreamError && error.retryAt
      ? new Date(error.retryAt).toISOString()
      : undefined
  });
}

const aiBuckets = new Map();
function pruneAiBuckets(now) {
  if (aiBuckets.size < MAX_AI_BUCKETS) return;
  for (const [key, value] of aiBuckets) {
    if (now - value.startedAt > 60_000) aiBuckets.delete(key);
  }
  if (aiBuckets.size < MAX_AI_BUCKETS) return;
  const oldest = [...aiBuckets.entries()].sort((a, b) => a[1].startedAt - b[1].startedAt);
  for (const [key] of oldest.slice(0, Math.ceil(oldest.length / 4))) aiBuckets.delete(key);
}

function aiRateLimit(req, res, next) {
  const key = req.ip || 'unknown';
  const now = Date.now();
  pruneAiBuckets(now);
  const current = aiBuckets.get(key) || { startedAt: now, count: 0 };
  if (now - current.startedAt > 60_000) {
    current.startedAt = now;
    current.count = 0;
  }
  current.count += 1;
  aiBuckets.set(key, current);
  if (current.count > 30) {
    res.set('Retry-After', '60');
    return res.status(429).json({ error: 'Zu viele KI-Anfragen. Bitte später erneut versuchen.' });
  }
  next();
}

let promptPromise;
let openAiClient;
function getParserPrompt() {
  promptPromise ??= fs.readFile(path.join(__dirname, 'prompts', 'food-request-parser.v1.md'), 'utf8');
  return promptPromise;
}
function getOpenAiClient() {
  openAiClient ??= new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    timeout: 15_000,
    maxRetries: 1
  });
  return openAiClient;
}

app.get('/api/health', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(HealthResponseSchema.parse({
    ok: true,
    version: APP_VERSION,
    openaiConfigured: Boolean(process.env.OPENAI_API_KEY),
    gatewayCacheEntries: gatewayCache.size,
    inFlightRequests: gatewayInFlight.size
  }));
});

app.get('/api/search', async (req, res) => {
  const query = String(req.query.q || '').replace(/\s+/g, ' ').trim().slice(0, MAX_QUERY_LENGTH).trim();
  if (!query) return res.status(400).json({ error: 'q ist erforderlich.' });
  const rawPageSize = Number(req.query.page_size || 15);
  const pageSize = Number.isFinite(rawPageSize) ? Math.min(20, Math.max(1, Math.round(rawPageSize))) : 15;
  const searchApiMode = normalizeSearchApiMode(req.query.search_api === 'v2' ? 'legacy-only' : 'auto');
  const key = `search:${canonicalQuery(query)}:${pageSize}:${searchApiMode}`;

  try {
    const result = await cachedGatewayLoad({
      key,
      freshMs: 10 * 60 * 1000,
      staleMs: 24 * 60 * 60 * 1000,
      load: async () => {
        const attempts = [];
        let reachableEmptyResponse = null;
        let primaryError = null;

        if (searchApiMode !== 'legacy-only') {
          if (searchALiciousCircuit.openUntil > Date.now()) {
            attempts.push(bypassAttemptForOpenCircuit(query));
          } else {
            try {
              const response = await fetchUpstreamJson(
                buildSearchALiciousUrl(query, pageSize),
                'search-a-licious',
                'Search-a-licious'
              );
              closeSearchALiciousCircuit();
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
              primaryError = error;
              if (error instanceof UpstreamError) {
                attempts.push(...error.attempts);
                openSearchALiciousCircuit(error);
              }
            }
          }
        }

        try {
          const response = await fetchUpstreamJson(
            buildLegacySearchUrl(query, pageSize),
            'open-food-facts-legacy',
            'Open Food Facts Legacy-Suche'
          );
          attempts.push(response.attempt);
          const value = normalizeLegacySearch(response.data, query);
          return { value, attempts };
        } catch (error) {
          if (error instanceof UpstreamError) attempts.push(...error.attempts);
          if (reachableEmptyResponse) return { value: reachableEmptyResponse, attempts };
          throw new UpstreamError('Keine Open-Food-Facts-Suche war erreichbar.', {
            status: error instanceof UpstreamError ? error.status : undefined,
            attempts,
            retryAt: error instanceof UpstreamError ? error.retryAt : undefined,
            cause: error ?? primaryError
          });
        }
      }
    });

    res.set({
      'Cache-Control': 'public, max-age=120, stale-while-revalidate=900',
      'X-KH-Gateway-Cache': result.cacheStatus
    });
    res.json(SearchGatewayResponseSchema.parse({ ...result.value, gateway_attempts: result.attempts }));
  } catch (error) {
    sendGatewayError(res, error, 'Produktsuche fehlgeschlagen.');
  }
});

app.get('/api/product/:code', async (req, res) => {
  const code = String(req.params.code || '').replace(/\D/g, '');
  if (!/^\d{8,14}$/.test(code)) return res.status(400).json({ error: 'Ungültiger Barcode.' });
  const knownCarbohydrates = req.query.known_carbs === '1';
  const productApiMode = normalizeProductApiMode(req.query.product_api);
  const key = `product:${code}:${productApiMode}:${knownCarbohydrates ? 'seeded' : 'complete'}`;

  try {
    const result = await cachedGatewayLoad({
      key,
      freshMs: 24 * 60 * 60 * 1000,
      staleMs: 30 * 24 * 60 * 60 * 1000,
      load: async () => {
        const attempts = [];
        let v3Data = null;

        if (productApiMode === 'v2') {
          const response = await fetchUpstreamJson(
            buildV2ProductUrl(code),
            'open-food-facts-v2',
            'Open Food Facts API v2'
          );
          attempts.push(response.attempt);
          if (!response.data?.product) {
            throw new UpstreamError('Für diesen Barcode wurde kein Produkt gefunden.', {
              status: 404,
              attempts
            });
          }
          return { value: response.data, attempts };
        }

        try {
          const response = await fetchUpstreamJson(
            buildV3ProductUrl(code),
            'open-food-facts-v3',
            'Open Food Facts API v3.6'
          );
          attempts.push(response.attempt);
          v3Data = response.data;
          if (v3Data?.product && (productApiMode === 'v3' || knownCarbohydrates || hasCarbohydrateData(v3Data.product))) {
            return { value: v3Data, attempts };
          }
        } catch (error) {
          if (error instanceof UpstreamError) attempts.push(...error.attempts);
          if (productApiMode === 'v3') {
            throw new UpstreamError('Produktdetails konnten über v3.6 nicht geladen werden.', {
              status: error instanceof UpstreamError ? error.status : undefined,
              attempts,
              retryAt: error instanceof UpstreamError ? error.retryAt : undefined,
              cause: error
            });
          }
        }

        try {
          const response = await fetchUpstreamJson(
            buildV2ProductUrl(code),
            'open-food-facts-v2',
            'Open Food Facts API v2 (Fallback)'
          );
          attempts.push(response.attempt);
          const value = {
            ...v3Data,
            ...response.data,
            product: mergeProducts(v3Data?.product, response.data?.product)
          };
          if (!value.product) {
            // Do not attach the already collected attempt list here. The catch
            // block below owns that aggregate and would otherwise duplicate it.
            throw new UpstreamError('Für diesen Barcode wurde kein Produkt gefunden.', {
              status: 404
            });
          }
          return { value, attempts };
        } catch (error) {
          if (error instanceof UpstreamError) attempts.push(...error.attempts);
          if (v3Data?.product) {
            const compatibilityUnavailable = !(error instanceof UpstreamError && error.status === 404);
            return {
              value: v3Data,
              attempts,
              // A transient v2 enrichment failure must not freeze a partial
              // product for the normal 24-hour gateway freshness window.
              ...(compatibilityUnavailable
                ? { freshMs: 5 * 60 * 1000, staleMs: 24 * 60 * 60 * 1000 }
                : {})
            };
          }
          if (error instanceof UpstreamError && error.status === 404) {
            throw new UpstreamError('Für diesen Barcode wurde kein Produkt gefunden.', {
              status: 404,
              attempts,
              cause: error
            });
          }
          throw new UpstreamError('Produktdetails konnten über v3.6 und v2 nicht geladen werden.', {
            status: error instanceof UpstreamError ? error.status : undefined,
            attempts,
            retryAt: error instanceof UpstreamError ? error.retryAt : undefined,
            cause: error
          });
        }
      }
    });

    res.set({
      'Cache-Control': 'public, max-age=900, stale-while-revalidate=86400',
      'X-KH-Gateway-Cache': result.cacheStatus
    });
    const normalizedProductPayload = {
      ...result.value,
      ...(typeof result.value?.status === 'number' ? { status: String(result.value.status) } : {}),
      gateway_attempts: result.attempts
    };
    res.json(ProductGatewayResponseSchema.parse(normalizedProductPayload));
  } catch (error) {
    sendGatewayError(res, error, 'Produktabruf fehlgeschlagen.');
  }
});

app.post('/api/ai/parse', aiRateLimit, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    if (!process.env.OPENAI_API_KEY) {
      return res.status(503).json({ error: 'OpenAI ist auf diesem Server nicht konfiguriert.' });
    }

    const parsedRequest = AiParseRequestSchema.safeParse(req.body);
    if (!parsedRequest.success) {
      return res.status(400).json({ error: 'Eingabe muss 1 bis 200 Zeichen lang sein.' });
    }
    const { input } = parsedRequest.data;

    const [prompt, openai] = await Promise.all([getParserPrompt(), Promise.resolve(getOpenAiClient())]);
    const response = await openai.responses.parse({
      model: process.env.OPENAI_MODEL || 'gpt-5.6',
      input: [
        { role: 'developer', content: prompt },
        { role: 'user', content: input }
      ],
      text: {
        format: zodTextFormat(AiParseResponseSchema, 'food_request')
      }
    });

    if (!response.output_parsed) {
      return res.status(502).json({ error: 'OpenAI lieferte kein strukturiertes Ergebnis.' });
    }
    res.json(AiParseResponseSchema.parse(response.output_parsed));
  } catch (error) {
    console.error('OpenAI parse failed:', error);
    res.status(502).json({ error: 'OpenAI-Parsing fehlgeschlagen.' });
  }
});

app.all('/api', (_req, res) => {
  res.status(404).json({ error: 'Unbekannter API-Endpunkt.' });
});
app.all('/api/{*splat}', (_req, res) => {
  res.status(404).json({ error: 'Unbekannter API-Endpunkt.' });
});

const distDir = path.join(rootDir, 'dist');
try {
  await fs.access(distDir);
  app.use(express.static(distDir, {
    index: false,
    etag: true,
    lastModified: true,
    setHeaders(res, filePath) {
      const name = path.basename(filePath);
      const relativePath = path.relative(distDir, filePath).split(path.sep).join('/');
      if (name === 'sw.js' || name === 'manifest.webmanifest' || name === 'index.html' || name === 'registerSW.js') {
        res.set('Cache-Control', 'no-cache');
      } else if (relativePath.startsWith('assets/')) {
        // Vite fingerprints everything under assets/. Matching the directory is
        // more robust than assuming a specific hash alphabet or filename shape.
        res.set('Cache-Control', 'public, max-age=31536000, immutable');
      } else {
        res.set('Cache-Control', 'public, max-age=86400');
      }
    }
  }));
  app.get('/{*splat}', (_req, res) => {
    res.set('Cache-Control', 'no-cache');
    res.sendFile(path.join(distDir, 'index.html'));
  });
} catch {
  app.get('/', (_req, res) => {
    res.type('text').send(`KH Checker API v${APP_VERSION} läuft. Frontend mit npm run dev starten.`);
  });
}

app.use((error, _req, res, _next) => {
  console.error(error);
  if (error instanceof SyntaxError && 'body' in error) {
    return res.status(400).json({ error: 'Ungültiger JSON-Request.' });
  }
  res.status(500).json({
    error: 'Interner Serverfehler.',
    ...(process.env.NODE_ENV === 'production' ? {} : { detail: errorMessage(error) })
  });
});

app.listen(port, host, () => {
  console.log(`KH Checker v${APP_VERSION} server listening on http://${host}:${port}`);
});
