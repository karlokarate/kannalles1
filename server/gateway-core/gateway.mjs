import { DeadlineExceededError, GatewayError, errorMessage } from './errors.mjs';
import { resolveAiConfiguration } from './ai-config.mjs';
import {
  PRODUCT_V2_FIELDS,
  PRODUCT_V3_FIELDS,
  SEARCH_FIELDS,
  SEARCH_INDEX_FIELDS,
  adaptV2ProductResponse,
  adaptV3ProductResponse,
  hasCarbohydrateData,
  mergeProductResponses,
  normalizeIndexSearch,
  normalizeLegacySearch
} from './off-adapters.mjs';
import {
  escapeSearchQuery,
  normalizeBarcode,
  normalizePageSize,
  normalizeProductMode,
  normalizeSearchMode,
  normalizeSearchQuery,
  opaqueFingerprint,
  queryFingerprint
} from './normalization.mjs';
import { createPersistencePorts } from './redis-port.mjs';
import { CachedLoader, Deadline, ResilientUpstream, diagnosticUrl } from './resilience.mjs';

const GATEWAY_API_VERSION = '1';
const SEARCH_PROJECTION_VERSION = 'search-v2';
const PRODUCT_PROJECTION_VERSION = 'off-v3.6-adapter-v1';
const MINUTE = 60_000;

function positiveInteger(value, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, Math.round(parsed))) : fallback;
}

function isLoopback(hostname) {
  return ['localhost', '127.0.0.1', '::1', '[::1]'].includes(hostname);
}

function configuredUrl(value, { component, allowInternalHttp = false, nodeEnv, fallback = '' }) {
  const raw = String(value || '').trim();
  if (!raw) return { url: fallback, error: null, configured: false };
  try {
    const parsed = new URL(raw);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return { url: '', error: { component, code: 'UNSUPPORTED_PROTOCOL' }, configured: true };
    }
    if (parsed.username || parsed.password || parsed.search || parsed.hash) {
      return { url: '', error: { component, code: 'UNSAFE_URL_COMPONENTS' }, configured: true };
    }
    if (parsed.protocol === 'http:'
      && !allowInternalHttp
      && !isLoopback(parsed.hostname)
      && nodeEnv !== 'test') {
      return { url: '', error: { component, code: 'INSECURE_HTTP' }, configured: true };
    }
    return { url: parsed.toString(), error: null, configured: true };
  } catch {
    return { url: '', error: { component, code: 'INVALID_URL' }, configured: true };
  }
}

function configuredRedisUrl(value, component) {
  const raw = String(value || '').trim();
  if (!raw) return { url: '', error: null };
  try {
    const parsed = new URL(raw);
    if (!['redis:', 'rediss:'].includes(parsed.protocol) || !parsed.hostname || parsed.hash) {
      return { url: '', error: { component, code: 'INVALID_REDIS_URL' } };
    }
    return { url: raw, error: null };
  } catch {
    return { url: '', error: { component, code: 'INVALID_REDIS_URL' } };
  }
}

function redisStorageIdentity(value) {
  if (!value) return '';
  const parsed = new URL(value);
  const port = parsed.port || (parsed.protocol === 'rediss:' ? '6380' : '6379');
  const rawDatabase = parsed.pathname.replace(/^\/+/, '') || '0';
  const database = /^\d+$/.test(rawDatabase) ? String(Number(rawDatabase)) : rawDatabase;
  // Credentials and query options do not isolate Redis keyspace/storage.
  return `${parsed.protocol}//${parsed.hostname.toLocaleLowerCase('en-US')}:${port}/${database}`;
}

function endpointUrl(base, suffix) {
  const url = new URL(base);
  if (url.pathname === '/' || !url.pathname) url.pathname = suffix;
  return url;
}

function aggregateError(message, errors, fallbackStatus = 503) {
  const gatewayErrors = errors.filter((error) => error instanceof GatewayError);
  if (gatewayErrors.length === 1) return gatewayErrors[0];
  const attempts = errors.flatMap((error) => error instanceof GatewayError ? error.attempts : []);
  const last = [...gatewayErrors].reverse()[0];
  return new GatewayError(message, {
    status: last?.status ?? fallbackStatus,
    attempts,
    retryAt: last?.retryAt,
    code: 'UPSTREAMS_UNAVAILABLE',
    cause: last
  });
}

function malformedUpstreamPayload(message, successAttempt, code = 'UPSTREAM_CONTRACT_VIOLATION') {
  const attempt = {
    ...successAttempt,
    outcome: 'parse-error',
    errorName: 'UpstreamContractViolation',
    errorMessage: message
  };
  return new GatewayError(message, {
    status: 502,
    attempts: [attempt],
    code
  });
}

function notFoundError(message, attempts) {
  return new GatewayError(message, { status: 404, attempts, code: 'NOT_FOUND' });
}

function attemptDuration(attempts) {
  return attempts.reduce((sum, attempt) => sum + (Number(attempt.durationMs) || 0), 0);
}

export function networkAttemptedForAttempts(attempts) {
  return attempts.some((attempt) => {
    if (attempt.outcome === 'cache-hit') return false;
    if (attempt.errorName === 'GatewayRateLimit') return false;
    if (['CircuitOpen', 'DeadlineBudgetExhausted'].includes(attempt.errorName)) return false;
    return true;
  });
}

export function fallbackOriginForResult(result) {
  if (!result.fallbackReason) return undefined;
  if (result.attempts.some((attempt) => attempt.errorName === 'GatewayRateLimit')) return 'local-budget';
  const remoteFailure = result.attempts.find((attempt) =>
    attempt.errorName === 'HTTPError' && [429, 503].includes(Number(attempt.status))
  );
  if (remoteFailure?.status === 429) return 'remote-limit';
  if (remoteFailure?.status === 503) return 'remote-overload';
  return undefined;
}

function apiMeta(result, cacheKey) {
  return {
    cacheStatus: result.cacheStatus,
    cacheLayer: result.cacheLayer,
    gatewayCacheStatus: result.cacheStatus,
    fetchedAt: result.fetchedAt,
    sourceUrl: result.sourceUrl,
    backend: 'gateway',
    originBackend: result.originBackend,
    networkAttempted: networkAttemptedForAttempts(result.attempts),
    durationMs: attemptDuration(result.attempts),
    cacheAgeMs: result.cacheAgeMs,
    cacheKey,
    attempts: result.attempts,
    ...(result.fallbackReason ? { fallbackReason: result.fallbackReason } : {}),
    ...(result.fallbackStatus ? { fallbackStatus: result.fallbackStatus } : {}),
    ...(fallbackOriginForResult(result) ? { fallbackOrigin: fallbackOriginForResult(result) } : {}),
    ...(result.retryAt ? { retryAt: new Date(result.retryAt).toISOString() } : {})
  };
}

function buildConfig({ env, version }) {
  const nodeEnv = String(env.NODE_ENV || 'development');
  const productionRuntime = nodeEnv === 'production';
  const allowSingleInstanceCoordination = String(env.ALLOW_SINGLE_INSTANCE_COORDINATION || '').trim() === '1';
  const requireDistributedCoordination = String(env.REQUIRE_DISTRIBUTED_COORDINATION || '').trim() === '1'
    || (productionRuntime && !allowSingleInstanceCoordination);
  const coordinationRedis = configuredRedisUrl(
    env.REDIS_COORDINATION_URL ?? env.REDIS_URL,
    'distributedCoordination'
  );
  const cacheRedis = configuredRedisUrl(
    env.REDIS_CACHE_URL ?? (productionRuntime ? '' : env.REDIS_URL),
    'distributedCache'
  );
  const redisRolesCollide = Boolean(requireDistributedCoordination
    && coordinationRedis.url
    && cacheRedis.url
    && redisStorageIdentity(coordinationRedis.url) === redisStorageIdentity(cacheRedis.url));
  const searchIndex = configuredUrl(env.SEARCH_INDEX_URL, {
    component: 'searchIndex',
    allowInternalHttp: String(env.SEARCH_INDEX_ALLOW_INSECURE_HTTP || '').trim() === '1',
    nodeEnv
  });
  // Public Search-a-licious is an opt-in diagnostic backend, never an implicit
  // production dependency. `auto` uses the owned index and OFF Legacy reserve.
  const searchALicious = configuredUrl(env.SEARCH_A_LICIOUS_URL, {
    component: 'searchALicious',
    nodeEnv
  });
  const offBase = configuredUrl(env.OFF_BASE_URL, {
    component: 'offProductApi',
    nodeEnv,
    fallback: 'https://world.openfoodfacts.org/'
  });
  const contactEmail = String(env.OFF_CONTACT_EMAIL || '').trim()
    || 'chrisfischtopher@googlemail.com';
  const configuredUserAgent = String(env.OFF_USER_AGENT || '').trim();
  const searchIndexId = String(env.SEARCH_INDEX_ID || '').trim();
  const searchIndexToken = String(env.SEARCH_INDEX_AUTH_TOKEN || '');
  const clientBudgetRequired = productionRuntime;
  const clientBudgetConfigured = String(env.GATEWAY_CLIENT_SALT || '').trim().length >= 32;
  const aiConfiguration = resolveAiConfiguration(env);
  const backendIdentities = {
    searchIndex: opaqueFingerprint(JSON.stringify([searchIndex.url, searchIndexId, searchIndexToken])),
    searchALicious: opaqueFingerprint(searchALicious.url),
    off: opaqueFingerprint(offBase.url)
  };
  return {
    version,
    apiVersion: GATEWAY_API_VERSION,
    searchIndexUrl: searchIndex.url,
    searchIndexConfigured: searchIndex.configured,
    searchIndexId,
    searchIndexToken,
    searchALiciousUrl: searchALicious.url,
    offBaseUrl: offBase.url,
    backendIdentities,
    configurationErrors: [
      searchIndex.error,
      searchALicious.error,
      offBase.error,
      coordinationRedis.error,
      cacheRedis.error,
      ...(redisRolesCollide
        ? [{ component: 'distributedCache', code: 'REDIS_ROLES_NOT_ISOLATED' }]
        : []),
      ...(clientBudgetRequired && !clientBudgetConfigured
        ? [{ component: 'requestBudgets', code: 'GATEWAY_CLIENT_SALT_MISSING_OR_WEAK' }]
        : []),
      ...(aiConfiguration.reasonCode && aiConfiguration.reasonCode !== 'OPENAI_API_KEY_MISSING'
        ? [{ component: 'aiParse', code: aiConfiguration.reasonCode }]
        : [])
    ].filter(Boolean),
    exposeDiagnostics: nodeEnv !== 'production',
    redisUrl: coordinationRedis.url,
    redisCacheUrl: redisRolesCollide ? '' : cacheRedis.url,
    redisRolesIsolated: !redisRolesCollide,
    requireDistributedCoordination,
    allowSingleInstanceCoordination,
    clientBudgetRequired,
    clientBudgetConfigured,
    clientSearchPerMinute: positiveInteger(env.CLIENT_SEARCH_RATE_LIMIT_PER_MINUTE, 6, { max: 120 }),
    clientProductPerMinute: positiveInteger(env.CLIENT_PRODUCT_RATE_LIMIT_PER_MINUTE, 10, { max: 240 }),
    redisPrefix: String(env.REDIS_PREFIX || `kh-gateway:v${GATEWAY_API_VERSION}`).trim(),
    // A production/multi-instance deployment must never silently fall back to
    // process-local coordination: that would bypass global quotas and
    // single-flight guarantees on the first Redis outage.
    redisFailureMode: requireDistributedCoordination
      ? 'closed'
      : env.REDIS_FAILURE_MODE === 'memory' ? 'memory' : 'closed',
    redisCommandTimeoutMs: positiveInteger(env.REDIS_COMMAND_TIMEOUT_MS, 500, { min: 50, max: 2_000 }),
    userAgent: configuredUserAgent
      || `KH-Checker/${version} (+https://karlokarate.github.io/kannalles1/; contact: ${contactEmail})`,
    contactEmail,
    deadlineMs: positiveInteger(env.GATEWAY_DEADLINE_MS, 8_000, { min: 1_000, max: 14_000 }),
    searchAttemptMs: positiveInteger(env.SEARCH_INDEX_TIMEOUT_MS, 2_500, { min: 250, max: 10_000 }),
    searchHealthTimeoutMs: positiveInteger(env.SEARCH_INDEX_HEALTH_TIMEOUT_MS, 1_000, { min: 100, max: 3_000 }),
    legacyAttemptMs: positiveInteger(env.OFF_LEGACY_TIMEOUT_MS, 5_000, { min: 250, max: 10_000 }),
    productV3AttemptMs: positiveInteger(env.OFF_PRODUCT_V3_TIMEOUT_MS, 4_500, { min: 250, max: 10_000 }),
    productV2AttemptMs: positiveInteger(env.OFF_PRODUCT_V2_TIMEOUT_MS, 5_000, { min: 250, max: 10_000 }),
    minFallbackBudgetMs: positiveInteger(env.MIN_FALLBACK_BUDGET_MS, 750, { min: 100, max: 5_000 }),
    searchIndexPerMinute: positiveInteger(env.SEARCH_INDEX_RATE_LIMIT_PER_MINUTE, 60, { max: 10_000 }),
    legacyPerMinute: positiveInteger(env.OFF_SEARCH_RATE_LIMIT_PER_MINUTE, 10, { max: 1_000 }),
    productPerMinute: positiveInteger(env.OFF_PRODUCT_RATE_LIMIT_PER_MINUTE, 15, { max: 1_000 }),
    openaiConfigured: aiConfiguration.configured,
    aiConfiguration,
    buildCommit: [env.GIT_COMMIT_SHA, env.SOURCE_VERSION, env.BUILD_COMMIT]
      .map((candidate) => String(candidate || '').trim())
      .find((candidate) => candidate.length >= 7) || null,
    builtAt: (() => {
      const raw = String(env.BUILD_TIMESTAMP || env.BUILT_AT || '').trim();
      if (!raw || !Number.isFinite(Date.parse(raw))) return null;
      return new Date(raw).toISOString();
    })()
  };
}

export class GatewayCore {
  constructor({ config, cache, coordinator, redisRuntime, cacheRuntime, fetchFn = globalThis.fetch }) {
    this.config = config;
    this.cache = cache;
    this.coordinator = coordinator;
    this.redisRuntime = redisRuntime;
    this.cacheRuntime = cacheRuntime ?? redisRuntime;
    this.fetchFn = fetchFn;
    this.loader = new CachedLoader({ cache, coordinator });
    this.upstream = new ResilientUpstream({
      coordinator,
      fetchFn,
      headers: {
        Accept: 'application/json',
        'User-Agent': config.userAgent,
        From: config.contactEmail
      },
      exposeResponsePreview: config.exposeDiagnostics
    });
  }

  #deadline(options) {
    return new Deadline(options?.deadlineMs ?? this.config.deadlineMs, { signal: options?.signal });
  }

  #requireCoordinationForUpstream() {
    if (!this.config.requireDistributedCoordination || this.config.redisUrl) return;
    throw new GatewayError(
      'Verteilte Gateway-Koordination ist für diese Produktionslaufzeit erforderlich.',
      { status: 503, code: 'DISTRIBUTED_COORDINATION_REQUIRED' }
    );
  }

  async #takeClientBudget(kind, clientKey, deadline) {
    const validClientKey = typeof clientKey === 'string'
      && /^kh_client_[a-f0-9]{32}$/.test(clientKey);
    if (!validClientKey) {
      if (!this.config.clientBudgetRequired) return;
      throw new GatewayError(
        'Ein datensparsames Client-Budget konnte für diese Produktionsanfrage nicht gebildet werden.',
        { status: 503, code: 'CLIENT_BUDGET_IDENTIFIER_REQUIRED' }
      );
    }
    const limit = kind === 'search'
      ? this.config.clientSearchPerMinute
      : this.config.clientProductPerMinute;
    const rate = await this.coordinator.takeToken(
      `client:${kind}:${clientKey}`,
      limit,
      MINUTE,
      Date.now(),
      deadline.remaining()
    );
    if (rate.allowed) return;
    throw new GatewayError('Zu viele Anfragen dieses Clients. Bitte kurz warten.', {
      status: 429,
      retryAt: Date.now() + rate.retryAfterMs,
      code: 'CLIENT_RATE_LIMIT'
    });
  }

  #requireFallbackBudget(deadline, backend, label, path) {
    const remaining = deadline.remaining();
    if (remaining >= this.config.minFallbackBudgetMs) return;
    const attempt = {
      backend,
      label,
      url: `upstream://${backend}${path}`,
      startedAt: new Date().toISOString(),
      durationMs: 0,
      outcome: 'aborted',
      errorName: 'DeadlineBudgetExhausted',
      errorMessage: `Fallback benötigt mindestens ${this.config.minFallbackBudgetMs} ms Restbudget.`
    };
    throw new DeadlineExceededError('Fallback wegen unzureichendem Restbudget nicht gestartet.', {
      attempts: [attempt]
    });
  }

  #searchUrl(kind) {
    const configured = kind === 'search-index' ? this.config.searchIndexUrl : this.config.searchALiciousUrl;
    if (!configured) {
      throw new GatewayError(
        kind === 'search-index'
          ? 'Der eigene Suchindex ist nicht konfiguriert.'
          : 'Search-a-licious ist nicht explizit konfiguriert.',
        { status: 503, code: kind === 'search-index' ? 'SEARCH_INDEX_NOT_CONFIGURED' : 'SEARCH_A_LICIOUS_NOT_CONFIGURED' }
      );
    }
    return endpointUrl(configured, '/search');
  }

  async #indexSearch(kind, query, pageSize, deadline) {
    this.#requireCoordinationForUpstream();
    if (kind === 'search-index' && !this.config.searchIndexUrl) {
      throw new GatewayError('Der eigene Suchindex ist nicht konfiguriert.', {
        status: 503,
        code: 'SEARCH_INDEX_NOT_CONFIGURED'
      });
    }
    const url = this.#searchUrl(kind);
    const backend = kind;
    const label = kind === 'search-index' ? 'Eigener Search-a-licious-Index' : 'Search-a-licious';
    const payload = {
      q: escapeSearchQuery(query),
      langs: ['de', 'en', 'main'],
      page: 1,
      page_size: pageSize,
      fields: SEARCH_INDEX_FIELDS,
      ...(kind === 'search-index' && this.config.searchIndexId ? { index_id: this.config.searchIndexId } : {})
    };
    const response = await this.upstream.request({
      url,
      backend,
      label,
      circuitKey: `${kind}:${kind === 'search-index'
        ? this.config.backendIdentities.searchIndex
        : this.config.backendIdentities.searchALicious}`,
      rateKey: kind,
      rateLimitPerMinute: this.config.searchIndexPerMinute,
      deadline,
      maxDurationMs: this.config.searchAttemptMs,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(kind === 'search-index' && this.config.searchIndexToken
          ? { Authorization: `Bearer ${this.config.searchIndexToken}` }
          : {})
      },
      body: JSON.stringify(payload),
      validateData: (data, successAttempt) => {
        if (Array.isArray(data?.errors) && data.errors.length > 0) {
          const error = malformedUpstreamPayload(
            'Der Suchindex lieferte eine dokumentierte Fehlerantwort.',
            successAttempt,
            'SEARCH_INDEX_ERROR_RESPONSE'
          );
          if (this.config.exposeDiagnostics) {
            error.attempts[0].responsePreview = JSON.stringify({ errors: data.errors }).slice(0, 500);
          }
          throw error;
        }
        if (!data || typeof data !== 'object' || Array.isArray(data)
          || (!Array.isArray(data.hits) && !Array.isArray(data.products))) {
          throw malformedUpstreamPayload(
            'Der Suchindex lieferte keine gültige Trefferliste.',
            successAttempt
          );
        }
      }
    });
    return {
      value: normalizeIndexSearch(response.data, query, kind),
      attempts: [response.attempt],
      sourceUrl: diagnosticUrl(url, backend),
      originBackend: backend
    };
  }

  async #legacySearch(query, pageSize, deadline) {
    this.#requireCoordinationForUpstream();
    if (!this.config.offBaseUrl) {
      throw new GatewayError('Open Food Facts ist aufgrund einer ungültigen Gateway-Konfiguration nicht verfügbar.', {
        status: 503,
        code: 'OFF_BASE_URL_INVALID'
      });
    }
    const url = new URL('/cgi/search.pl', this.config.offBaseUrl);
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
    const response = await this.upstream.request({
      url,
      backend: 'open-food-facts-legacy',
      label: 'Open Food Facts Legacy-Suche',
      circuitKey: `off-legacy:${this.config.backendIdentities.off}`,
      rateKey: 'off-search',
      rateLimitPerMinute: this.config.legacyPerMinute,
      deadline,
      maxDurationMs: this.config.legacyAttemptMs,
      validateData: (data, successAttempt) => {
        if (!data || typeof data !== 'object' || Array.isArray(data) || !Array.isArray(data.products)) {
          throw malformedUpstreamPayload(
            'Open Food Facts Legacy lieferte keine gültige Produktliste.',
            successAttempt
          );
        }
      }
    });
    return {
      value: normalizeLegacySearch(response.data, query),
      attempts: [response.attempt],
      sourceUrl: diagnosticUrl(url, 'open-food-facts-legacy'),
      originBackend: 'open-food-facts-legacy'
    };
  }

  async search(rawQuery, rawPageSize, options = {}) {
    const query = normalizeSearchQuery(rawQuery);
    if (!query) throw new GatewayError('q ist erforderlich.', { status: 400, code: 'INVALID_QUERY' });
    this.#requireCoordinationForUpstream();
    const pageSize = normalizePageSize(rawPageSize);
    const mode = normalizeSearchMode(options.searchApiMode);
    const primary = mode === 'search-index'
      ? 'search-index'
      : mode === 'search-a-licious'
        ? 'search-a-licious'
        : mode === 'auto'
          ? this.config.searchIndexUrl ? 'search-index' : null
          : null;
    const cacheKey = [
      'search',
      SEARCH_PROJECTION_VERSION,
      queryFingerprint(query),
      pageSize,
      mode,
      primary || 'none',
      primary === 'search-index'
        ? this.config.backendIdentities.searchIndex
        : primary === 'search-a-licious' ? this.config.backendIdentities.searchALicious : 'none',
      mode === 'legacy' || mode === 'auto' ? this.config.backendIdentities.off : 'none'
    ].join(':');
    const deadline = this.#deadline(options);
    const result = await this.loader.load({
      key: cacheKey,
      freshMs: 10 * MINUTE,
      staleMs: 24 * 60 * MINUTE,
      deadline,
      load: async (operationDeadline) => {
        await this.#takeClientBudget('search', options.clientKey, operationDeadline);
        const attempts = [];
        const errors = [];
        let reachableEmpty = null;
        if (primary) {
          try {
            const response = await this.#indexSearch(primary, query, pageSize, operationDeadline);
            attempts.push(...response.attempts);
            if (response.value.hits.length > 0 || mode !== 'auto') {
              return { ...response, attempts };
            }
            reachableEmpty = response;
          } catch (error) {
            errors.push(error);
            if (error instanceof GatewayError) attempts.push(...error.attempts);
            if (mode !== 'auto') throw error;
          }
        }
        if (mode === 'legacy' || mode === 'auto') {
          try {
            if (mode === 'auto' && primary) {
              this.#requireFallbackBudget(
                operationDeadline,
                'open-food-facts-legacy',
                'Open Food Facts Legacy-Suche (Fallback)',
                '/cgi/search.pl'
              );
            }
            const response = await this.#legacySearch(query, pageSize, operationDeadline);
            return { ...response, attempts: [...attempts, ...response.attempts] };
          } catch (error) {
            errors.push(error);
            if (error instanceof GatewayError) attempts.push(...error.attempts);
          }
        }
        if (reachableEmpty) return { ...reachableEmpty, attempts };
        throw aggregateError('Keine Produktsuche war erreichbar.', errors);
      }
    });
    return {
      ...result.value,
      gateway_attempts: result.attempts,
      api_meta: apiMeta(result, cacheKey)
    };
  }

  #productUrl(version, code) {
    if (!this.config.offBaseUrl) {
      throw new GatewayError('Open Food Facts ist aufgrund einer ungültigen Gateway-Konfiguration nicht verfügbar.', {
        status: 503,
        code: 'OFF_BASE_URL_INVALID'
      });
    }
    const suffix = version === 'v3.6' ? '' : '.json';
    const url = new URL(`/api/${version}/product/${encodeURIComponent(code)}${suffix}`, this.config.offBaseUrl);
    url.searchParams.set('lc', 'de');
    url.searchParams.set('cc', 'de');
    if (version === 'v3.6') url.searchParams.set('tags_lc', 'de');
    url.searchParams.set('fields', (version === 'v3.6' ? PRODUCT_V3_FIELDS : PRODUCT_V2_FIELDS).join(','));
    return url;
  }

  async #productVersion(version, code, deadline, fallback = false) {
    this.#requireCoordinationForUpstream();
    const v3 = version === 'v3.6';
    const url = this.#productUrl(version, code);
    const backend = v3 ? 'open-food-facts-v3' : 'open-food-facts-v2';
    const response = await this.upstream.request({
      url,
      backend,
      label: v3 ? 'Open Food Facts API v3.6' : `Open Food Facts API v2${fallback ? ' (Fallback)' : ''}`,
      circuitKey: `${v3 ? 'off-v3' : 'off-v2'}:${this.config.backendIdentities.off}`,
      rateKey: 'off-product',
      rateLimitPerMinute: this.config.productPerMinute,
      deadline,
      maxDurationMs: v3 ? this.config.productV3AttemptMs : this.config.productV2AttemptMs,
      preserveNotFound: true,
      validateData: (data, successAttempt) => {
        const status = String(data?.status ?? '').trim().toLocaleLowerCase('en-US');
        const documentedNotFound = !data?.product
          && ['0', 'failure', 'not_found', 'not-found'].includes(status);
        const productCode = String(data?.product?.code ?? '').replace(/\D/g, '');
        const validProduct = data?.product
          && typeof data.product === 'object'
          && !Array.isArray(data.product)
          && /^\d{7,14}$/.test(productCode);
        const valid = data
          && typeof data === 'object'
          && !Array.isArray(data)
          && (validProduct || documentedNotFound);
        if (!valid) {
          throw malformedUpstreamPayload(
            `Open Food Facts API ${version} lieferte keinen gültigen Produktvertrag.`,
            successAttempt
          );
        }
      }
    });
    const value = v3 ? adaptV3ProductResponse(response.data) : adaptV2ProductResponse(response.data);
    if (!value.product) throw notFoundError('Für diesen Barcode wurde kein Produkt gefunden.', [response.attempt]);
    value.product.code = String(value.product.code || value.code || code);
    return {
      value,
      attempts: [response.attempt],
      sourceUrl: diagnosticUrl(url, backend),
      originBackend: backend
    };
  }

  async product(rawCode, options = {}) {
    const code = normalizeBarcode(rawCode);
    if (!code) throw new GatewayError('Ungültiger Barcode.', { status: 400, code: 'INVALID_BARCODE' });
    this.#requireCoordinationForUpstream();
    const mode = normalizeProductMode(options.productApiMode);
    const knownCarbohydrates = options.knownCarbohydrates === true;
    const cacheKey = [
      'product',
      PRODUCT_PROJECTION_VERSION,
      code,
      mode,
      knownCarbohydrates ? 'seeded' : 'complete',
      this.config.backendIdentities.off
    ].join(':');
    const deadline = this.#deadline(options);
    const result = await this.loader.load({
      key: cacheKey,
      freshMs: 24 * 60 * MINUTE,
      staleMs: 30 * 24 * 60 * MINUTE,
      deadline,
      load: async (operationDeadline) => {
        await this.#takeClientBudget('product', options.clientKey, operationDeadline);
        if (mode === 'v3') return this.#productVersion('v3.6', code, operationDeadline);
        if (mode === 'v2') return this.#productVersion('v2', code, operationDeadline);

        const attempts = [];
        const errors = [];
        let v3Response = null;
        try {
          v3Response = await this.#productVersion('v3.6', code, operationDeadline);
          attempts.push(...v3Response.attempts);
          if (knownCarbohydrates || hasCarbohydrateData(v3Response.value.product)) {
            return { ...v3Response, attempts };
          }
        } catch (error) {
          errors.push(error);
          if (error instanceof GatewayError) attempts.push(...error.attempts);
        }

        try {
          this.#requireFallbackBudget(
            operationDeadline,
            'open-food-facts-v2',
            'Open Food Facts API v2 (Fallback)',
            `/api/v2/product/${encodeURIComponent(code)}.json`
          );
          const v2Response = await this.#productVersion('v2', code, operationDeadline, true);
          const value = mergeProductResponses(v3Response?.value, v2Response.value);
          return {
            value,
            attempts: [...attempts, ...v2Response.attempts],
            sourceUrl: v3Response?.sourceUrl || v2Response.sourceUrl,
            originBackend: v3Response ? 'open-food-facts-v3' : 'open-food-facts-v2'
          };
        } catch (error) {
          errors.push(error);
          if (error instanceof GatewayError) attempts.push(...error.attempts);
          if (v3Response?.value.product) {
            const transientEnrichmentFailure = !(error instanceof GatewayError && error.status === 404);
            return {
              ...v3Response,
              attempts,
              ...(transientEnrichmentFailure
                ? { freshMs: 5 * MINUTE, staleMs: 24 * 60 * MINUTE }
                : {})
            };
          }
          throw aggregateError('Produktdetails konnten über v3.6 und v2 nicht geladen werden.', errors);
        }
      }
    });
    return {
      ...result.value,
      status: String(result.value.status ?? (result.value.product ? 'success' : 'failure')),
      code: String(result.value.code ?? result.value.product?.code ?? code),
      gateway_attempts: result.attempts,
      api_meta: apiMeta(result, cacheKey)
    };
  }

  async #searchIndexReadiness() {
    if (!this.config.searchIndexUrl) return { status: 'disabled', reason: null };
    const url = new URL(this.config.searchIndexUrl);
    url.pathname = '/health';
    url.search = '';
    url.hash = '';
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(new DOMException('Timeout', 'TimeoutError')),
      this.config.searchHealthTimeoutMs
    );
    try {
      const response = await this.fetchFn(url, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          'User-Agent': this.config.userAgent,
          From: this.config.contactEmail,
          ...(this.config.searchIndexToken
            ? { Authorization: `Bearer ${this.config.searchIndexToken}` }
            : {})
        },
        redirect: 'error',
        signal: controller.signal
      });
      await response.body?.cancel?.().catch?.(() => undefined);
      return response.ok
        ? { status: 'ready', reason: null }
        : { status: 'unavailable', reason: 'Der eigene Suchindex meldet sich nicht ready.' };
    } catch {
      return { status: 'unavailable', reason: 'Der eigene Suchindex-Healthcheck ist nicht erreichbar.' };
    } finally {
      clearTimeout(timeout);
    }
  }

  async health() {
    // Health is the cold-start readiness probe. Force the first Redis
    // connection attempt through the same hard command budget used by traffic,
    // so configured Redis never remains indefinitely in an ambiguous state.
    const redisRuntimes = [...new Set([this.redisRuntime, this.cacheRuntime])];
    await Promise.all(redisRuntimes.map(async (runtime) => {
      const initialStatus = runtime.status();
      if (initialStatus.configured && initialStatus.connectivity === 'unknown') {
        await runtime.run(() => true, this.config.redisCommandTimeoutMs).catch(() => undefined);
      }
    }));
    const [searchIndexCircuit, offLegacy, offProductV3, offProductV2, cacheEntries, searchReadiness] = await Promise.all([
      this.coordinator.circuitStatus(`search-index:${this.config.backendIdentities.searchIndex}`),
      this.coordinator.circuitStatus(`off-legacy:${this.config.backendIdentities.off}`),
      this.coordinator.circuitStatus(`off-v3:${this.config.backendIdentities.off}`),
      this.coordinator.circuitStatus(`off-v2:${this.config.backendIdentities.off}`),
      this.cache.size(),
      this.#searchIndexReadiness()
    ]);
    const redisStatus = this.redisRuntime.status();
    const cacheRedisStatus = this.cacheRuntime.status();
    const searchUnavailable = offLegacy === 'open'
      && (!this.config.searchIndexUrl || searchIndexCircuit === 'open');
    const indexConfigError = this.config.configurationErrors.some((item) => item.component === 'searchIndex');
    const searchDiagnosticConfigError = this.config.configurationErrors.some(
      (item) => item.component === 'searchALicious'
    );
    const offConfigError = this.config.configurationErrors.some((item) => item.component === 'offProductApi');
    const cacheIsolationError = this.config.configurationErrors.some(
      (item) => item.code === 'REDIS_ROLES_NOT_ISOLATED'
    );
    const clientBudgetConfigurationError = this.config.clientBudgetRequired
      && !this.config.clientBudgetConfigured;
    const productUnavailable = offConfigError || (offProductV3 === 'open' && offProductV2 === 'open');
    const requiredRedisUnavailable = this.config.requireDistributedCoordination
      ? !redisStatus.configured || redisStatus.connectivity !== 'ready'
      : redisStatus.configured
        && this.config.redisFailureMode === 'closed'
        && redisStatus.connectivity !== 'ready';
    const ready = !searchUnavailable
      && !productUnavailable
      && !requiredRedisUnavailable
      && !cacheIsolationError
      && !clientBudgetConfigurationError;
    const distributedUnavailable = !redisStatus.configured || redisStatus.connectivity !== 'ready';
    const distributedCacheUnavailable = !cacheRedisStatus.configured
      || cacheRedisStatus.connectivity !== 'ready';
    const degraded = !ready
      || distributedUnavailable
      || distributedCacheUnavailable
      || !this.config.searchIndexUrl
      || searchReadiness.status === 'unavailable'
      || this.config.configurationErrors.length > 0;
    return {
      ok: ready,
      ready,
      status: ready ? degraded ? 'degraded' : 'healthy' : 'unhealthy',
      service: 'kh-data-gateway',
      apiVersion: this.config.apiVersion,
      version: this.config.version,
      openaiConfigured: this.config.openaiConfigured,
      searchIndexConfigured: Boolean(this.config.searchIndexUrl),
      distributedCacheConfigured: cacheRedisStatus.configured,
      cacheBackend: {
        requested: cacheRedisStatus.configured ? 'redis' : 'memory',
        effective: !cacheRedisStatus.configured
          ? 'memory'
          : cacheRedisStatus.connectivity === 'unknown'
            ? 'unknown'
            : cacheRedisStatus.connectivity === 'ready' ? 'redis' : 'memory',
        connectivity: cacheRedisStatus.connectivity,
        degraded: distributedCacheUnavailable
      },
      gatewayCacheEntries: cacheEntries,
      inFlightRequests: this.loader.inFlight.size,
      build: {
        runtime: 'node',
        commit: this.config.buildCommit,
        builtAt: this.config.builtAt
      },
      capabilities: {
        aiParse: this.config.openaiConfigured,
        searchIndex: Boolean(this.config.searchIndexUrl),
        offLegacyFallback: true,
        offProductV3: true,
        offProductV2: true,
        distributedCoordination: redisStatus.configured && redisStatus.connectivity === 'ready'
      },
      components: {
        aiParse: this.config.aiConfiguration.configured
          ? { status: 'ready', reason: null }
          : this.config.aiConfiguration.reasonCode === 'AI_SAFETY_SALT_MISSING_OR_WEAK'
            ? {
                status: 'unavailable',
                reason: 'AI_SAFETY_SALT fehlt oder ist zu kurz; Paid-AI bleibt in Production fail-closed.'
              }
            : this.config.aiConfiguration.reasonCode === 'DISTRIBUTED_COORDINATION_REQUIRED'
              ? {
                  status: 'unavailable',
                  reason: 'REDIS_COORDINATION_URL fehlt; Paid-AI benötigt in Production ein verteiltes Kostenbudget.'
                }
            : {
                status: 'disabled',
                reason: 'OPENAI_API_KEY ist nicht konfiguriert; der lokale Parser bleibt verfügbar.'
              },
        searchIndex: indexConfigError
          ? { status: 'unavailable', reason: 'SEARCH_INDEX_URL ist ungültig oder unsicher konfiguriert.' }
          : this.config.searchIndexUrl
          ? {
              status: searchIndexCircuit === 'open' ? 'unavailable' : searchReadiness.status,
              reason: searchIndexCircuit === 'open'
                ? 'Circuit ist nach Upstream-Fehlern geöffnet.'
                : searchReadiness.reason
                  ? searchReadiness.reason
                : searchDiagnosticConfigError
                  ? 'Die optionale SEARCH_A_LICIOUS_URL-Diagnose ist ungültig konfiguriert.'
                  : null
            }
          : {
              status: 'disabled',
              reason: searchDiagnosticConfigError
                ? 'SEARCH_INDEX_URL fehlt und die optionale SEARCH_A_LICIOUS_URL-Diagnose ist ungültig; Auto nutzt OFF Legacy.'
                : 'SEARCH_INDEX_URL ist nicht konfiguriert; OFF Legacy wird als Reserve genutzt.'
            },
        distributedCoordination: redisStatus.configured
          ? {
              status: redisStatus.connectivity === 'ready'
                ? 'ready'
                : redisStatus.connectivity === 'unknown' ? 'unknown' : 'unavailable',
              reason: redisStatus.connectivity === 'ready'
                ? null
                : redisStatus.connectivity === 'unknown'
                  ? 'Redis-Verbindung wurde noch nicht geprüft.'
                  : 'Redis ist temporär nicht erreichbar.'
            }
          : this.config.requireDistributedCoordination
            ? {
                status: 'unavailable',
                reason: 'REDIS_COORDINATION_URL fehlt, obwohl diese Produktionslaufzeit verteilte Koordination verlangt.'
              }
            : {
                status: 'disabled',
                reason: this.config.allowSingleInstanceCoordination
                  ? 'Expliziter Single-Instance-Betrieb: Memory-Koordination ist aktiv.'
                  : 'REDIS_COORDINATION_URL ist nicht konfiguriert; Memory-Fallback ist aktiv.'
              },
        requestBudgets: this.config.clientBudgetConfigured || !this.config.clientBudgetRequired
          ? {
              status: this.config.clientBudgetConfigured ? 'ready' : 'disabled',
              reason: this.config.clientBudgetConfigured
                ? null
                : 'Client-Budgets sind außerhalb der Produktionslaufzeit nicht erforderlich.'
            }
          : {
              status: 'unavailable',
              reason: 'GATEWAY_CLIENT_SALT fehlt oder ist zu kurz; Client-Budgets bleiben fail-closed.'
            },
        offProductApi: {
          status: productUnavailable ? 'unavailable' : 'ready',
          reason: offConfigError
            ? 'OFF_BASE_URL ist ungültig oder unsicher konfiguriert.'
            : productUnavailable ? 'Beide OFF-Produkt-Circuits sind geöffnet.' : null
        }
      },
      circuits: {
        searchIndex: searchIndexCircuit,
        offLegacy,
        offProductV3,
        offProductV2
      },
      rateLimits: {
        scope: this.coordinator.distributed && redisStatus.connectivity === 'ready' ? 'distributed' : 'instance',
        searchIndexPerMinute: this.config.searchIndexPerMinute,
        legacySearchPerMinute: this.config.legacyPerMinute,
        productPerMinute: this.config.productPerMinute,
        clientScoped: this.config.clientBudgetConfigured,
        clientSearchPerMinute: this.config.clientSearchPerMinute,
        clientProductPerMinute: this.config.clientProductPerMinute
      }
    };
  }

  close() {
    return Promise.all([...new Set([this.redisRuntime, this.cacheRuntime])].map((runtime) => runtime.close()));
  }
}

export function createGatewayCore({
  env = process.env,
  version,
  fetchFn = globalThis.fetch,
  logger = console,
  ports
} = {}) {
  if (!/^\d+\.\d+\.\d+$/.test(String(version || ''))) {
    throw new Error('createGatewayCore requires an explicit package version.');
  }
  const config = buildConfig({ env, version });
  const persistence = ports ?? createPersistencePorts({
    coordinationUrl: config.redisUrl,
    cacheUrl: config.redisCacheUrl,
    prefix: config.redisPrefix,
    maxEntries: 240,
    commandTimeoutMs: config.redisCommandTimeoutMs,
    failureMode: config.redisFailureMode,
    logger
  });
  return new GatewayCore({
    config,
    cache: persistence.cache,
    coordinator: persistence.coordinator,
    redisRuntime: persistence.coordinationRuntime ?? persistence.runtime,
    cacheRuntime: persistence.cacheRuntime ?? persistence.runtime,
    fetchFn
  });
}

export function gatewayErrorPayload(error, publicMessage, { includeDetail = process.env.NODE_ENV !== 'production', traceId } = {}) {
  const effectiveTraceId = traceId
    || globalThis.crypto?.randomUUID?.()
    || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return {
    status: error instanceof GatewayError && Number.isInteger(error.status) ? error.status : 502,
    body: {
      error: publicMessage,
      code: error instanceof GatewayError && /^[A-Z][A-Z0-9_]{1,79}$/.test(String(error.code || ''))
        ? error.code
        : 'GATEWAY_ERROR',
      traceId: effectiveTraceId,
      ...(includeDetail ? { detail: errorMessage(error) } : {}),
      attempts: error instanceof GatewayError ? error.attempts : [],
      ...(error?.retryAt ? { retryAt: new Date(error.retryAt).toISOString() } : {})
    }
  };
}
