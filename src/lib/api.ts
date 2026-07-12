import {
  buildGatewayProductUrl,
  buildGatewaySearchUrl,
  createGatewayClient,
  GatewayTransportError
} from '../generated/search-api';
import type { GatewayTransportResult } from '../generated/search-api';
import type {
  ApiAttemptDiagnostic,
  ApiBackend,
  ApiResponseMeta,
  OffProduct,
  OffProductResponse,
  ProductApiMode,
  SearchHit,
  SearchOutcome,
  SearchResponse
} from '../types';
import { normalizeText } from './format';
import { correctCommonFoodTypos } from './query';
import { getApiCache, putApiCache } from './storage';
import {
  clearApiGovernor,
  getApiUsageSnapshot,
  parseRetryAfter,
  recordApiRequest,
  recordApiResponse
} from './apiGovernor';
import type { ApiBucket } from './apiGovernor';
import { isOffBarcodeInput, normalizeOffBarcode } from './barcode';
import { validatedGatewayBase } from './gatewayUrl';

const CACHE_NAMESPACE = 'kh-v3:gateway';
const MAX_SEARCH_QUERY_LENGTH = 120;
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const SEARCH_FRESH_MS = 24 * HOUR;
const SEARCH_STALE_MS = 30 * DAY;
const EMPTY_SEARCH_FRESH_MS = 15 * 60 * 1000;
const EMPTY_SEARCH_STALE_MS = DAY;
const PRODUCT_FRESH_MS = 30 * DAY;
const PRODUCT_STALE_MS = 180 * DAY;
const REQUEST_DEADLINE_MS = 12_000;

/**
 * These are domain projection names, not browser-side upstream parameters.
 * The gateway owns all OFF/Search-a-licious requests and projections.
 */
export const SEARCH_FIELDS = [
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
] as const;

export interface SearchFoodOptions {
  preserveVariants?: boolean;
  /** Required for network access. May be same-origin or an HTTPS deployment. */
  gatewayUrl?: string;
  productOnly?: string;
  /** Kept for source compatibility. Upstream selection is exclusively a gateway concern. */
  searchApiMode?: 'auto' | 'legacy-only';
  /** Disable persistent API data for privacy-sensitive sessions. */
  cacheEnabled?: boolean;
}

export interface ProductRequestOptions {
  gatewayUrl?: string;
  seedProduct?: OffProduct;
  productApiMode?: ProductApiMode;
  cacheEnabled?: boolean;
}

type DataSourceErrorKind =
  | 'configuration'
  | 'http'
  | 'rate-limit'
  | 'network'
  | 'timeout'
  | 'parse'
  | 'aborted';

interface CachePolicy {
  freshMs: number;
  staleMs: number;
}

interface SharedRequest<T> {
  controller: AbortController;
  promise: Promise<NetworkResult<T>>;
  subscribers: number;
  settled: boolean;
}

interface NetworkResult<T> {
  value: T;
  fetchedAt: number;
  attempt: ApiAttemptDiagnostic;
}

interface CachedSearch {
  response: SearchResponse;
  sourceUrl: string;
}

interface CachedProduct {
  response: OffProductResponse;
  sourceUrl: string;
}

const inFlight = new Map<string, SharedRequest<unknown>>();

export { clearApiGovernor, getApiUsageSnapshot };

export class DataSourceError extends Error {
  readonly status?: number;
  readonly attempts: ApiAttemptDiagnostic[];
  readonly retryAt?: number;

  constructor(
    message: string,
    readonly kind: DataSourceErrorKind,
    options: {
      status?: number;
      attempts?: ApiAttemptDiagnostic[];
      retryAt?: number;
      cause?: unknown;
    } = {}
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'DataSourceError';
    this.status = options.status;
    this.attempts = options.attempts ?? [];
    this.retryAt = options.retryAt;
  }
}

export function cancelPendingApiRequests(): void {
  for (const request of inFlight.values()) {
    request.controller.abort(new DOMException('API-Anfrage wurde abgebrochen.', 'AbortError'));
  }
  inFlight.clear();
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  throw new DataSourceError('Anfrage abgebrochen.', 'aborted', { cause: signal.reason });
}

function isOffline(): boolean {
  try {
    return typeof navigator !== 'undefined' && navigator.onLine === false;
  } catch {
    return false;
  }
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name || 'Error' : typeof error;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message || String(error) : String(error);
}

function cleanPreview(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, 360);
}

function normalizePageSize(value: number): 10 | 15 | 20 {
  return value >= 20 ? 20 : value >= 15 ? 15 : 10;
}

export function canonicalizeSearchQuery(productName: string): string {
  const printable = Array.from(correctCommonFoodTypos(productName), (character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127 ? ' ' : character;
  }).join('');
  return printable
    .replace(/[<>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_SEARCH_QUERY_LENGTH);
}

function cacheToken(value: string): string {
  // Preserve token boundaries. This prevents different queries such as "ab c"
  // and "a bc" from sharing one cache record.
  return encodeURIComponent(normalizeText(value).replace(/\s+/g, ' ').trim());
}

function gatewayCacheNamespace(value = ''): string {
  const clean = value.trim();
  if (!clean) return 'unconfigured';
  try {
    const url = clean.startsWith('/') && typeof window !== 'undefined'
      ? new URL(clean, window.location.origin)
      : new URL(clean);
    return cacheToken(`${url.origin}${url.pathname.replace(/\/$/, '')}`);
  } catch {
    return 'invalid';
  }
}

function searchCacheKey(query: string, pageSize: number, gatewayUrl = ''): string {
  return `${CACHE_NAMESPACE}:search:v1:${gatewayCacheNamespace(gatewayUrl)}:${pageSize}:${cacheToken(query)}`;
}

function productCacheKey(code: string, mode: ProductApiMode, gatewayUrl = ''): string {
  return `${CACHE_NAMESPACE}:product:v2:${gatewayCacheNamespace(gatewayUrl)}:${mode}:${code}`;
}

function validateGatewayBase(value = ''): string {
  const clean = value.trim();
  if (!clean) {
    throw new DataSourceError(
      'Kein Daten-Gateway konfiguriert. Bereits gespeicherte Daten und die manuelle Berechnung bleiben verfügbar.',
      'configuration'
    );
  }

  try {
    return validatedGatewayBase(
      clean,
      typeof window !== 'undefined' ? window.location.origin : undefined
    );
  } catch (cause) {
    throw new DataSourceError('Die konfigurierte Daten-Gateway-Adresse ist ungültig oder unsicher.', 'configuration', { cause });
  }
}

function mergeAttempts(...groups: Array<ApiAttemptDiagnostic[] | undefined>): ApiAttemptDiagnostic[] {
  const seen = new Set<string>();
  const result: ApiAttemptDiagnostic[] = [];
  for (const attempt of groups.flatMap((group) => group ?? [])) {
    const key = [
      attempt.startedAt,
      attempt.backend,
      attempt.label,
      attempt.url,
      attempt.outcome,
      attempt.status ?? '',
      attempt.errorMessage ?? ''
    ].join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(attempt);
  }
  return result;
}

function responseMeta(
  cacheStatus: ApiResponseMeta['cacheStatus'],
  fetchedAt: number,
  sourceUrl: string,
  options: Partial<ApiResponseMeta> = {}
): ApiResponseMeta {
  return {
    cacheStatus,
    fetchedAt: new Date(fetchedAt).toISOString(),
    sourceUrl,
    backend: 'gateway',
    originBackend: options.originBackend ?? 'gateway',
    ...options
  };
}

function gatewayAttempt(
  url: string,
  label: string,
  startedAt: number,
  outcome: ApiAttemptDiagnostic['outcome'],
  options: Partial<ApiAttemptDiagnostic> = {}
): ApiAttemptDiagnostic {
  return {
    backend: 'gateway',
    label,
    url,
    startedAt: new Date(startedAt).toISOString(),
    durationMs: Math.max(0, Date.now() - startedAt),
    outcome,
    ...options
  };
}

async function requestNetwork<T>(
  url: string,
  bucket: ApiBucket,
  label: string,
  controller: AbortController,
  telemetryEnabled: boolean,
  execute: (signal: AbortSignal) => Promise<GatewayTransportResult<T>>
): Promise<NetworkResult<T>> {
  const startedAt = Date.now();
  let timedOut = false;
  const timeout = globalThis.setTimeout(() => {
    timedOut = true;
    controller.abort(new DOMException('Gesamtdeadline überschritten.', 'TimeoutError'));
  }, REQUEST_DEADLINE_MS);
  if (telemetryEnabled) recordApiRequest(bucket, startedAt);

  try {
    const response = await execute(controller.signal);
    if (telemetryEnabled) recordApiResponse(bucket, response.status, null, Date.now());
    return {
      value: response.data,
      fetchedAt: Date.now(),
      attempt: gatewayAttempt(response.url, label, startedAt, 'success', { status: response.status })
    };
  } catch (cause) {
    if (cause instanceof DataSourceError) throw cause;
    if (cause instanceof GatewayTransportError && cause.status !== null && !controller.signal.aborted) {
      const retryAfterMs = parseRetryAfter(cause.headers?.get('Retry-After') ?? null);
      const gatewayRetryAt = cause.retryAt ? Date.parse(cause.retryAt) : Number.NaN;
      const retryAt = Number.isFinite(gatewayRetryAt)
        ? gatewayRetryAt
        : retryAfterMs
          ? Date.now() + retryAfterMs
          : undefined;
      if (telemetryEnabled) recordApiResponse(bucket, cause.status, retryAfterMs, Date.now());
      const stableCode = typeof (cause as GatewayTransportError & { code?: unknown }).code === 'string'
        ? (cause as GatewayTransportError & { code: string }).code
        : typeof (cause.apiError as { code?: unknown } | null)?.code === 'string'
          ? (cause.apiError as { code: string }).code
          : null;
      const rateLimited = cause.status === 429 || stableCode === 'LOCAL_RATE_LIMIT';
      const parseFailure = cause.message.includes('JSON') || cause.message.includes('API-Vertrag');
      const kind: DataSourceErrorKind = rateLimited ? 'rate-limit' : parseFailure ? 'parse' : 'http';
      const attempt = gatewayAttempt(cause.url, label, startedAt, rateLimited ? 'rate-limit' : parseFailure ? 'parse-error' : 'http-error', {
        status: cause.status,
        errorName: cause.name,
        errorMessage: cause.message,
        responsePreview: cleanPreview(cause.responseText),
        retryAfterMs: retryAfterMs ?? undefined
      });
      throw new DataSourceError(cause.message, kind, {
        status: cause.status,
        retryAt,
        attempts: mergeAttempts(cause.attempts as ApiAttemptDiagnostic[], [attempt]),
        cause
      });
    }
    const aborted = controller.signal.aborted;
    const kind: DataSourceErrorKind = timedOut ? 'timeout' : aborted ? 'aborted' : 'network';
    const attempt = gatewayAttempt(url, label, startedAt, timedOut ? 'timeout' : aborted ? 'aborted' : 'network-error', {
      errorName: timedOut ? 'TimeoutError' : errorName(cause),
      errorMessage: timedOut ? `Gesamtdeadline nach ${REQUEST_DEADLINE_MS} ms überschritten.` : errorMessage(cause)
    });
    throw new DataSourceError(attempt.errorMessage ?? 'Daten-Gateway nicht erreichbar.', kind, {
      attempts: [attempt],
      cause
    });
  } finally {
    globalThis.clearTimeout(timeout);
  }
}

function subscribe<T>(request: SharedRequest<T>, signal?: AbortSignal): Promise<NetworkResult<T>> {
  throwIfAborted(signal);
  request.subscribers += 1;
  return new Promise((resolve, reject) => {
    let done = false;
    const release = () => {
      if (done) return;
      done = true;
      request.subscribers = Math.max(0, request.subscribers - 1);
      signal?.removeEventListener('abort', onAbort);
    };
    const onAbort = () => {
      release();
      if (request.subscribers === 0 && !request.settled) {
        request.controller.abort(new DOMException('Keine aktiven Abonnenten.', 'AbortError'));
      }
      reject(new DataSourceError('Anfrage abgebrochen.', 'aborted', { cause: signal?.reason }));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    // Abort can race exactly between the pre-subscription check and listener
    // registration. Recheck after registration so the promise never hangs.
    if (signal?.aborted) {
      onAbort();
      return;
    }
    request.promise.then(
      (value) => {
        if (done) return;
        release();
        resolve(value);
      },
      (error) => {
        if (done) return;
        release();
        reject(error);
      }
    );
  });
}

async function sharedNetwork<T>(
  url: string,
  bucket: ApiBucket,
  label: string,
  signal?: AbortSignal,
  telemetryEnabled = true,
  execute?: (signal: AbortSignal) => Promise<GatewayTransportResult<T>>
): Promise<NetworkResult<T>> {
  throwIfAborted(signal);
  const requestKey = `${telemetryEnabled ? 'telemetry' : 'private'}:${url}`;
  let request = inFlight.get(requestKey) as SharedRequest<T> | undefined;
  // The final subscriber aborts the shared controller synchronously, while the
  // promise cleanup runs in a later microtask. Never attach a new user action
  // to that already-doomed request during this small window.
  if (request?.controller.signal.aborted) {
    if (inFlight.get(requestKey) === request) inFlight.delete(requestKey);
    request = undefined;
  }
  if (!request) {
    if (!execute) throw new Error('Gateway-Operation fehlt.');
    const controller = new AbortController();
    request = {
      controller,
      promise: Promise.resolve(null as never),
      subscribers: 0,
      settled: false
    };
    const currentRequest = request;
    request.promise = requestNetwork<T>(url, bucket, label, controller, telemetryEnabled, execute).finally(() => {
      currentRequest.settled = true;
      if (inFlight.get(requestKey) === currentRequest) inFlight.delete(requestKey);
    });
    inFlight.set(requestKey, request as SharedRequest<unknown>);
  }
  return subscribe(request, signal);
}

function cacheAttempt(backend: ApiBackend, label: string, sourceUrl: string, storedAt: number): ApiAttemptDiagnostic {
  return {
    backend,
    label,
    url: sourceUrl || 'local-cache',
    startedAt: new Date().toISOString(),
    durationMs: 0,
    outcome: 'cache-hit',
    cacheAgeMs: Math.max(0, Date.now() - storedAt)
  };
}

async function readCache<T extends { response: object; sourceUrl: string }>(
  key: string,
  backend: 'query-cache' | 'product-cache',
  label: string,
  allowStale: boolean
): Promise<T['response'] | null> {
  const entry = await getApiCache<T>(key);
  if (!entry) return null;
  const now = Date.now();
  const fresh = entry.expiresAt > now;
  if (!fresh && (!allowStale || entry.staleUntil <= now)) return null;
  const upstream = (entry.value.response as { api_meta?: ApiResponseMeta }).api_meta;
  return {
    ...entry.value.response,
    api_meta: responseMeta(fresh ? 'fresh-cache' : 'stale-cache', entry.storedAt, upstream?.sourceUrl || entry.value.sourceUrl, {
      ...upstream,
      cacheStatus: fresh ? 'fresh-cache' : 'stale-cache',
      backend,
      originBackend: upstream?.originBackend ?? upstream?.backend ?? 'gateway',
      networkAttempted: false,
      cacheAgeMs: now - entry.storedAt,
      cacheKey: key,
      cacheLayer: entry.readLayer ?? 'browser-memory',
      gatewayCacheStatus: upstream?.gatewayCacheStatus ?? upstream?.cacheStatus,
      fallbackReason: !fresh && isOffline() ? 'offline' : upstream?.fallbackReason,
      attempts: mergeAttempts(upstream?.attempts, [cacheAttempt(backend, label, upstream?.sourceUrl || entry.value.sourceUrl, entry.storedAt)])
    })
  } as T['response'];
}

async function storeCache<T extends object>(
  key: string,
  response: T,
  sourceUrl: string,
  policy: CachePolicy
): Promise<void> {
  const upstreamTime = Date.parse((response as { api_meta?: ApiResponseMeta }).api_meta?.fetchedAt ?? '');
  const storedAt = Number.isFinite(upstreamTime) && upstreamTime > 0
    ? Math.min(Date.now(), upstreamTime)
    : Date.now();
  const value = { response, sourceUrl };
  await putApiCache({
    key,
    value,
    storedAt,
    expiresAt: storedAt + policy.freshMs,
    staleUntil: storedAt + policy.staleMs
  });
}

function normalizeGatewayMeta<T extends { api_meta?: ApiResponseMeta; gateway_attempts?: ApiAttemptDiagnostic[] }>(
  response: T,
  sourceUrl: string,
  fetchedAt: number,
  transportAttempt: ApiAttemptDiagnostic
): T {
  const upstream = response.api_meta;
  const attempts = mergeAttempts(response.gateway_attempts, upstream?.attempts, [transportAttempt]);
  const { gateway_attempts: _gatewayAttempts, ...withoutTransport } = response;
  return {
    ...withoutTransport,
    api_meta: responseMeta('network', fetchedAt, sourceUrl, {
      ...upstream,
      cacheStatus: upstream?.cacheStatus ?? 'network',
      fetchedAt: upstream?.fetchedAt ?? new Date(fetchedAt).toISOString(),
      sourceUrl: upstream?.sourceUrl || sourceUrl,
      backend: 'gateway',
      originBackend: upstream?.originBackend ?? upstream?.backend ?? 'gateway',
      networkAttempted: true,
      durationMs: attempts.reduce((sum, item) => sum + item.durationMs, 0),
      attempts
    })
  } as T;
}

function normalizeProductMode(mode: ProductApiMode | undefined): ProductApiMode {
  return mode === 'v2' || mode === 'v3' ? mode : 'hybrid';
}

/** OFF canonical equivalence: UPC-E 7→8 and UPC-A 12→EAN-13. */
export function normalizeBarcode(value: string): string {
  return normalizeOffBarcode(value) ?? value.replace(/\D/g, '');
}

function mergeProducts(seed: OffProduct | undefined, product: OffProduct | undefined): OffProduct | undefined {
  if (!seed) return product;
  if (!product) return seed;
  return {
    ...seed,
    ...product,
    nutriments: { ...(seed.nutriments ?? {}), ...(product.nutriments ?? {}) },
    categories_tags: product.categories_tags ?? seed.categories_tags,
    countries_tags: product.countries_tags ?? seed.countries_tags
  };
}

function productToSearchHit(product: OffProduct | undefined): SearchHit {
  if (!product) return {};
  return { ...product };
}

export async function searchFoodCandidates(
  productName: string,
  pageSize = 15,
  signal?: AbortSignal,
  options: SearchFoodOptions = {}
): Promise<SearchResponse> {
  throwIfAborted(signal);
  const query = canonicalizeSearchQuery(productName);
  if (!query) {
    throw new DataSourceError('Bitte gib einen Suchbegriff ein.', 'http', { status: 400 });
  }
  const requestedPageSize = normalizePageSize(pageSize);
  const cacheEnabled = options.cacheEnabled !== false;
  const key = searchCacheKey(query, requestedPageSize, options.gatewayUrl);
  if (cacheEnabled) {
    const cached = await readCache<CachedSearch>(key, 'query-cache', 'Lokaler Suchcache', false);
    throwIfAborted(signal);
    if (cached) return cached as SearchResponse;
  }

  const stale = cacheEnabled
    ? await readCache<CachedSearch>(key, 'query-cache', 'Lokale Suchreserve', true) as SearchResponse | null
    : null;
  throwIfAborted(signal);
  if (stale && isOffline()) return stale;

  let gateway: string;
  try {
    gateway = validateGatewayBase(options.gatewayUrl);
  } catch (error) {
    if (stale) {
      return {
        ...stale,
        api_meta: stale.api_meta ? {
          ...stale.api_meta,
          networkAttempted: false,
          fallbackReason: stale.api_meta.fallbackReason ?? 'network'
        } : stale.api_meta
      };
    }
    throw error;
  }
  const url = buildGatewaySearchUrl(gateway, query, requestedPageSize);
  const client = createGatewayClient({
    baseUrl: gateway,
    defaultInit: { credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer' }
  });

  try {
    const network = await sharedNetwork<SearchResponse>(
      url,
      'search',
      'Daten-Gateway · Produktsuche',
      signal,
      cacheEnabled,
      (requestSignal) => client.search({ query, pageSize: requestedPageSize, searchApi: 'auto' }, { signal: requestSignal }) as Promise<GatewayTransportResult<SearchResponse>>
    );
    const response = normalizeGatewayMeta(network.value, url, network.fetchedAt, network.attempt);
    if (cacheEnabled) {
      const empty = response.hits.length === 0;
      await storeCache<CachedSearch['response']>(key, response, response.api_meta?.sourceUrl || url, {
        freshMs: empty ? EMPTY_SEARCH_FRESH_MS : SEARCH_FRESH_MS,
        staleMs: empty ? EMPTY_SEARCH_STALE_MS : SEARCH_STALE_MS
      });
      throwIfAborted(signal);
    }
    return response;
  } catch (error) {
    if (signal?.aborted) throwIfAborted(signal);
    if (!stale) throw error;
    const typed = error instanceof DataSourceError
      ? error
      : new DataSourceError(errorMessage(error), 'network', { cause: error });
    const cachedMeta = stale.api_meta;
    return {
      ...stale,
      api_meta: {
        ...(cachedMeta ?? responseMeta('stale-cache', Date.now(), url)),
        cacheStatus: 'stale-cache',
        networkAttempted: true,
        attempts: mergeAttempts(typed.attempts, cachedMeta?.attempts),
        fallbackReason: typed.kind === 'rate-limit' ? 'rate-limit' : typed.kind === 'timeout' ? 'timeout' : typed.kind === 'parse' ? 'parse' : typed.kind === 'http' ? 'http' : 'network',
        fallbackStatus: typed.status,
        retryAt: typed.retryAt ? new Date(typed.retryAt).toISOString() : undefined
      }
    };
  }
}

function requestId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `search-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }
}

export async function searchFoodCandidatesOutcome(
  productName: string,
  pageSize = 15,
  signal?: AbortSignal,
  options: SearchFoodOptions = {}
): Promise<SearchOutcome> {
  const query = canonicalizeSearchQuery(productName);
  const base = {
    requestId: requestId(),
    query: {
      raw: productName,
      canonical: query,
      productOnly: options.productOnly ?? query
    },
    sourceMode: 'api' as const
  };
  try {
    const result = await searchFoodCandidates(productName, pageSize, signal, options);
    const attempts = result.api_meta?.attempts ?? [];
    return {
      ...base,
      status: result.hits.length ? 'resolved' : 'not_found',
      candidates: result.hits,
      result,
      diagnostics: {
        networkAttempted: Boolean(result.api_meta?.networkAttempted),
        cacheStatus: result.api_meta?.cacheStatus ?? 'none',
        attempts,
        retryAllowedImmediately: true
      }
    };
  } catch (error) {
    if (error instanceof DataSourceError && error.kind === 'aborted') throw error;
    const typed = error instanceof DataSourceError
      ? error
      : new DataSourceError(errorMessage(error), 'network', { cause: error });
    return {
      ...base,
      status: 'temporarily_unavailable',
      candidates: [],
      result: null,
      diagnostics: {
        networkAttempted: typed.kind !== 'configuration',
        cacheStatus: 'none',
        attempts: typed.attempts,
        retryAllowedImmediately: true,
        errorKind: typed.kind,
        statusCode: typed.status,
        message: typed.message,
        retryAt: typed.retryAt ? new Date(typed.retryAt).toISOString() : undefined
      }
    };
  }
}

export async function getProductByBarcode(
  code: string,
  signal?: AbortSignal,
  options: ProductRequestOptions = {}
): Promise<OffProductResponse> {
  throwIfAborted(signal);
  if (!isOffBarcodeInput(code)) {
    throw new DataSourceError('Ungültiger Barcode: erwartet werden 7 bis 14 Ziffern.', 'http', { status: 400 });
  }
  const normalizedCode = normalizeBarcode(code);
  if (!/^\d{7,14}$/.test(normalizedCode)) {
    throw new DataSourceError('Ungültiger Barcode: erwartet werden 7 bis 14 Ziffern.', 'http', { status: 400 });
  }
  const mode = normalizeProductMode(options.productApiMode);
  const cacheEnabled = options.cacheEnabled !== false;
  const key = productCacheKey(normalizedCode, mode, options.gatewayUrl);
  if (cacheEnabled) {
    const cached = await readCache<CachedProduct>(key, 'product-cache', 'Lokaler Produktcache', false);
    throwIfAborted(signal);
    if (cached) {
      const canonical = cached as OffProductResponse;
      return { ...canonical, product: mergeProducts(options.seedProduct, canonical.product) };
    }
  }
  const stale = cacheEnabled
    ? await readCache<CachedProduct>(key, 'product-cache', 'Lokale Produktreserve', true) as OffProductResponse | null
    : null;
  throwIfAborted(signal);
  if (stale && isOffline()) {
    return { ...stale, product: mergeProducts(options.seedProduct, stale.product) };
  }

  let gateway: string;
  try {
    gateway = validateGatewayBase(options.gatewayUrl);
  } catch (error) {
    if (stale) {
      return {
        ...stale,
        product: mergeProducts(options.seedProduct, stale.product),
        api_meta: stale.api_meta ? {
          ...stale.api_meta,
          networkAttempted: false,
          fallbackReason: stale.api_meta.fallbackReason ?? 'network'
        } : stale.api_meta
      };
    }
    throw error;
  }
  // The persistent snapshot must never depend on a caller-specific search seed.
  const sourceUrl = buildGatewayProductUrl(gateway, normalizedCode, false, mode);
  const client = createGatewayClient({
    baseUrl: gateway,
    defaultInit: { credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer' }
  });

  try {
    const network = await sharedNetwork<OffProductResponse>(
      sourceUrl,
      'product',
      'Daten-Gateway · Produktdetails',
      signal,
      cacheEnabled,
      (requestSignal) => client.product({
        code: normalizedCode,
        knownCarbohydrates: false,
        productApi: mode
      }, { signal: requestSignal }) as Promise<GatewayTransportResult<OffProductResponse>>
    );
    const canonical = normalizeGatewayMeta(network.value, sourceUrl, network.fetchedAt, network.attempt);
    if (cacheEnabled && canonical.product) {
      await storeCache<CachedProduct['response']>(key, canonical, canonical.api_meta?.sourceUrl || sourceUrl, {
        freshMs: PRODUCT_FRESH_MS,
        staleMs: PRODUCT_STALE_MS
      });
      throwIfAborted(signal);
    }
    return { ...canonical, product: mergeProducts(options.seedProduct, canonical.product) };
  } catch (error) {
    if (signal?.aborted) throwIfAborted(signal);
    if (!stale) throw error;
    const typed = error instanceof DataSourceError
      ? error
      : new DataSourceError(errorMessage(error), 'network', { cause: error });
    return {
      ...stale,
      product: mergeProducts(options.seedProduct, stale.product),
      api_meta: {
        ...(stale.api_meta ?? responseMeta('stale-cache', Date.now(), sourceUrl)),
        cacheStatus: 'stale-cache',
        networkAttempted: true,
        attempts: mergeAttempts(typed.attempts, stale.api_meta?.attempts),
        fallbackReason: typed.kind === 'rate-limit' ? 'rate-limit' : typed.kind === 'timeout' ? 'timeout' : typed.kind === 'parse' ? 'parse' : typed.kind === 'http' ? 'http' : 'network',
        fallbackStatus: typed.status,
        retryAt: typed.retryAt ? new Date(typed.retryAt).toISOString() : undefined
      }
    };
  }
}

/**
 * Compatibility adapter for resolver callers. It never contacts OFF directly;
 * the gateway receives the strict v2 request and decides which upstream is safe.
 */
export async function getSearchDocumentByBarcode(
  code: string,
  signal?: AbortSignal,
  options: ProductRequestOptions = {}
): Promise<SearchHit> {
  const response = await getProductByBarcode(code, signal, { ...options, productApiMode: 'v2' });
  const hit = productToSearchHit(response.product);
  hit.api_meta = response.api_meta;
  return hit;
}
