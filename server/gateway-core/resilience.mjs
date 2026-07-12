import {
  DeadlineExceededError,
  GatewayError,
  cleanPreview,
  errorMessage,
  errorName,
  fallbackReasonForError,
  isTransientGatewayError,
  parseRetryAfter
} from './errors.mjs';

function nowIso(now = Date.now()) {
  return new Date(now).toISOString();
}

export function diagnosticUrl(url, backend = 'upstream') {
  try {
    const parsed = new URL(url);
    const safeBackend = String(backend).replace(/[^a-z0-9-]/gi, '-') || 'upstream';
    return `upstream://${safeBackend}${parsed.pathname || '/'}`;
  } catch {
    return `upstream://${String(backend).replace(/[^a-z0-9-]/gi, '-') || 'upstream'}`;
  }
}

function randomToken() {
  return globalThis.crypto?.randomUUID?.()
    ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function publicGatewayStatus(upstreamStatus, preserveNotFound) {
  if (upstreamStatus === 429 || upstreamStatus === 503 || upstreamStatus === 504) return upstreamStatus;
  if (upstreamStatus === 408) return 504;
  if (preserveNotFound && upstreamStatus === 404) return 404;
  // Authentication, authorization, route and arbitrary upstream 4xx/5xx
  // statuses describe the gateway's upstream relationship, not the browser's
  // request. Keep the public contract small and stable.
  return 502;
}

function abortable(promise, signal) {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
    signal.addEventListener('abort', abort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', abort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener('abort', abort);
        reject(error);
      }
    );
  });
}

export class Deadline {
  constructor(durationMs, { now = Date.now, signal } = {}) {
    this.now = now;
    this.startedAt = now();
    this.expiresAt = this.startedAt + Math.max(1, Number(durationMs) || 1);
    this.signal = signal;
  }

  remaining() {
    return Math.max(0, this.expiresAt - this.now());
  }

  throwIfExpired() {
    if (this.signal?.aborted) {
      throw new GatewayError('Die Anfrage wurde abgebrochen.', { status: 499, code: 'ABORTED' });
    }
    if (this.remaining() <= 0) throw new DeadlineExceededError();
  }

  detached() {
    return new Deadline(this.remaining(), { now: this.now });
  }
}

export function cacheHitAttempt(key, storedAt, stale = false, now = Date.now()) {
  return {
    backend: 'gateway',
    label: stale ? 'Gateway-Cache (Ausfallreserve)' : 'Gateway-Cache',
    url: `gateway-cache://${encodeURIComponent(key)}`,
    startedAt: nowIso(now),
    durationMs: 0,
    outcome: 'cache-hit',
    cacheAgeMs: Math.max(0, now - storedAt)
  };
}

export async function fetchJson({
  fetchFn = globalThis.fetch,
  url,
  backend,
  label,
  deadline,
  maxDurationMs,
  method = 'GET',
  headers = {},
  body,
  maxResponseBytes = 1_000_000,
  preserveNotFound = false,
  exposeResponsePreview = process.env.NODE_ENV !== 'production'
}) {
  deadline.throwIfExpired();
  const startedAt = Date.now();
  const startedIso = nowIso(startedAt);
  const cleanupReserveMs = 50;
  const availableMs = deadline.remaining();
  if (availableMs <= cleanupReserveMs) throw new DeadlineExceededError();
  const allowedMs = Math.max(
    1,
    Math.min(availableMs - cleanupReserveMs, Number(maxDurationMs) || availableMs - cleanupReserveMs)
  );
  const controller = new AbortController();
  let timedOut = false;
  const abortFromCaller = () => controller.abort(deadline.signal?.reason);
  deadline.signal?.addEventListener('abort', abortFromCaller, { once: true });
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort(new DOMException('Timeout', 'TimeoutError'));
  }, allowedMs);

  try {
    const response = await fetchFn(url, {
      method,
      headers,
      body,
      // Never forward gateway credentials or broaden the configured trust
      // boundary through an upstream-controlled redirect.
      redirect: 'error',
      signal: controller.signal
    });
    if (controller.signal.aborted) {
      throw controller.signal.reason ?? new DOMException('Aborted', 'AbortError');
    }
    let text;
    let responseTooLarge = false;
    try {
      if (response.body?.getReader) {
        const reader = response.body.getReader();
        const chunks = [];
        let size = 0;
        while (true) {
          const { done, value } = await abortable(reader.read(), controller.signal);
          if (done) break;
          size += value.byteLength;
          if (size > maxResponseBytes) {
            responseTooLarge = true;
            await reader.cancel('response-too-large');
            throw new Error(`Upstream-Antwort überschreitet ${maxResponseBytes} Bytes.`);
          }
          chunks.push(value);
        }
        const combined = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) {
          combined.set(chunk, offset);
          offset += chunk.byteLength;
        }
        text = new TextDecoder().decode(combined);
      } else {
        text = await abortable(response.text(), controller.signal);
        if (new TextEncoder().encode(text).byteLength > maxResponseBytes) {
          responseTooLarge = true;
          throw new Error(`Upstream-Antwort überschreitet ${maxResponseBytes} Bytes.`);
        }
      }
    } catch (cause) {
      if (!responseTooLarge) throw cause;
      const attempt = {
        backend,
        label,
        url: diagnosticUrl(url, backend),
        startedAt: startedIso,
        durationMs: Date.now() - startedAt,
        outcome: 'parse-error',
        status: response.status,
        errorName: 'ResponseTooLarge',
        errorMessage: 'Upstream-Antwort überschreitet das erlaubte Größenlimit.'
      };
      throw new GatewayError(attempt.errorMessage, {
        status: 502,
        attempts: [attempt],
        code: 'RESPONSE_TOO_LARGE',
        cause
      });
    }
    const durationMs = Date.now() - startedAt;
    const retryAfterMs = parseRetryAfter(response.headers?.get?.('Retry-After'));
    if (!response.ok) {
      const attempt = {
        backend,
        label,
        url: diagnosticUrl(url, backend),
        startedAt: startedIso,
        durationMs,
        outcome: response.status === 429 ? 'rate-limit' : 'http-error',
        status: response.status,
        errorName: 'HTTPError',
        errorMessage: `HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}`,
        ...(exposeResponsePreview ? { responsePreview: cleanPreview(text) } : {}),
        ...(retryAfterMs !== null ? { retryAfterMs } : {})
      };
      throw new GatewayError(attempt.errorMessage, {
        status: publicGatewayStatus(response.status, preserveNotFound),
        attempts: [attempt],
        retryAt: retryAfterMs === null ? undefined : Date.now() + retryAfterMs,
        code: 'UPSTREAM_HTTP_ERROR'
      });
    }
    try {
      return {
        data: JSON.parse(text),
        attempt: {
          backend,
          label,
          url: diagnosticUrl(url, backend),
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
        url: diagnosticUrl(url, backend),
        startedAt: startedIso,
        durationMs,
        outcome: 'parse-error',
        status: response.status,
        errorName: errorName(cause),
        errorMessage: exposeResponsePreview ? errorMessage(cause) : 'Ungültiges JSON vom Upstream.',
        ...(exposeResponsePreview ? { responsePreview: cleanPreview(text) } : {})
      };
      throw new GatewayError('Ungültige JSON-Antwort vom Upstream.', {
        status: 502,
        attempts: [attempt],
        code: 'INVALID_JSON',
        cause
      });
    }
  } catch (cause) {
    if (cause instanceof GatewayError) throw cause;
    const durationMs = Date.now() - startedAt;
    const aborted = deadline.signal?.aborted && !timedOut;
    const attempt = {
      backend,
      label,
      url: diagnosticUrl(url, backend),
      startedAt: startedIso,
      durationMs,
      outcome: aborted ? 'aborted' : timedOut ? 'timeout' : 'network-error',
      errorName: aborted ? 'AbortError' : timedOut ? 'TimeoutError' : errorName(cause),
      errorMessage: aborted
        ? 'Die Anfrage wurde abgebrochen.'
        : timedOut
          ? `Zeitüberschreitung nach ${allowedMs} ms`
          : exposeResponsePreview ? errorMessage(cause) : 'Netzwerkfehler beim Upstream.'
    };
    throw new GatewayError(`${attempt.errorName}: ${attempt.errorMessage}`, {
      status: timedOut ? 504 : aborted ? 499 : 502,
      attempts: [attempt],
      code: timedOut ? 'DEADLINE_EXCEEDED' : aborted ? 'ABORTED' : 'NETWORK_ERROR',
      cause
    });
  } finally {
    clearTimeout(timeout);
    deadline.signal?.removeEventListener('abort', abortFromCaller);
  }
}

export class ResilientUpstream {
  constructor({ coordinator, fetchFn, headers = {}, circuit = {}, exposeResponsePreview = false }) {
    this.coordinator = coordinator;
    this.fetchFn = fetchFn;
    this.headers = headers;
    this.exposeResponsePreview = exposeResponsePreview;
    this.circuit = {
      failureThreshold: circuit.failureThreshold ?? 2,
      cooldownMs: circuit.cooldownMs ?? 90_000,
      probeMs: circuit.probeMs ?? 15_000
    };
  }

  async request(options) {
    const {
      circuitKey,
      rateKey = circuitKey,
      rateLimitPerMinute,
      backend,
      label,
      url,
      deadline
    } = options;
    deadline.throwIfExpired();
    const state = await this.coordinator.circuitBefore(
      circuitKey,
      this.circuit.probeMs,
      Date.now(),
      deadline.remaining()
    );
    deadline.throwIfExpired();
    if (state.status === 'open') {
      const retryAfterMs = Math.max(1, state.retryAt - Date.now());
      const attempt = {
        backend,
        label: `${label} (Circuit offen)`,
        url: diagnosticUrl(url, backend),
        startedAt: nowIso(),
        durationMs: 0,
        outcome: 'aborted',
        errorName: 'CircuitOpen',
        errorMessage: 'Upstream wird nach wiederholten temporären Fehlern kurz übersprungen.',
        retryAfterMs
      };
      throw new GatewayError(attempt.errorMessage, {
        status: 503,
        attempts: [attempt],
        retryAt: state.retryAt,
        code: 'CIRCUIT_OPEN'
      });
    }

    const rate = await this.coordinator.takeToken(
      rateKey,
      rateLimitPerMinute,
      60_000,
      Date.now(),
      deadline.remaining()
    );
    deadline.throwIfExpired();
    if (!rate.allowed) {
      const retryAt = Date.now() + rate.retryAfterMs;
      const attempt = {
        backend,
        label: `${label} (Gateway-Limit)`,
        url: diagnosticUrl(url, backend),
        startedAt: nowIso(),
        durationMs: 0,
        outcome: 'rate-limit',
        status: 429,
        errorName: 'GatewayRateLimit',
        errorMessage: 'Das konfigurierte Upstream-Budget ist ausgeschöpft.',
        retryAfterMs: rate.retryAfterMs
      };
      throw new GatewayError(attempt.errorMessage, {
        status: 429,
        attempts: [attempt],
        retryAt,
        code: 'LOCAL_RATE_LIMIT'
      });
    }

    try {
      const result = await fetchJson({
        ...options,
        fetchFn: this.fetchFn,
        exposeResponsePreview: this.exposeResponsePreview,
        headers: { ...this.headers, ...(options.headers || {}) }
      });
      if (options.validateData) await options.validateData(result.data, result.attempt);
      await this.coordinator.circuitSuccess(circuitKey, Math.max(1, deadline.remaining()));
      return result;
    } catch (error) {
      if (isTransientGatewayError(error)) {
        await this.coordinator.circuitFailure(circuitKey, {
          threshold: this.circuit.failureThreshold,
          cooldownMs: this.circuit.cooldownMs,
          retryAt: error.retryAt
        }, Math.max(1, deadline.remaining()));
      } else if (state.status === 'half-open') {
        await this.coordinator.circuitSuccess(circuitKey, Math.max(1, deadline.remaining()));
      }
      throw error;
    }
  }
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal?.removeEventListener('abort', abort);
      resolve();
    }, ms);
    const abort = () => {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', abort);
      reject(new GatewayError('Die Anfrage wurde abgebrochen.', { status: 499, code: 'ABORTED' }));
    };
    if (!signal) return;
    if (signal.aborted) return abort();
    signal.addEventListener('abort', abort, { once: true });
  });
}

function waitForSubscriber(task, deadline) {
  deadline.throwIfExpired();
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      deadline.signal?.removeEventListener('abort', abort);
      callback(value);
    };
    const abort = () => finish(reject, new GatewayError('Die Anfrage wurde abgebrochen.', {
      status: 499,
      code: 'ABORTED'
    }));
    const timeout = setTimeout(
      () => finish(reject, new DeadlineExceededError()),
      Math.max(1, deadline.remaining())
    );
    deadline.signal?.addEventListener('abort', abort, { once: true });
    if (deadline.signal?.aborted) abort();
    task.then((value) => finish(resolve, value), (error) => finish(reject, error));
  });
}

export class CachedLoader {
  constructor({ cache, coordinator }) {
    this.cache = cache;
    this.coordinator = coordinator;
    this.inFlight = new Map();
  }

  async #loadWithDistributedLock({ key, freshMs, staleMs, load, deadline }) {
    const lockToken = randomToken();
    let acquired = false;
    while (!acquired) {
      deadline.throwIfExpired();
      // Gateway deadlines are capped at 14 s. Keep the distributed lock beyond
      // the complete remaining operation budget so a slow serial fallback
      // cannot outlive its lock and trigger a second upstream request.
      const lockMs = Math.max(500, Math.min(20_000, deadline.remaining() + 1_000));
      acquired = await this.coordinator.acquireLock(key, lockMs, lockToken, deadline.remaining());
      if (acquired) break;
      await sleep(Math.min(100, Math.max(20, deadline.remaining() / 10)), deadline.signal);
      const peerRecord = await this.cache.get(key, deadline.remaining());
      if (peerRecord?.expiresAt > Date.now()) {
        return { record: peerRecord, loadedByPeer: true };
      }
    }

    try {
      const loaded = await load(deadline);
      const storedAt = Date.now();
      const effectiveFreshMs = Number.isFinite(loaded.freshMs) ? Math.max(0, loaded.freshMs) : freshMs;
      const effectiveStaleMs = Number.isFinite(loaded.staleMs)
        ? Math.max(effectiveFreshMs, loaded.staleMs)
        : staleMs;
      const record = {
        value: loaded.value,
        context: {
          attempts: loaded.attempts || [],
          fetchedAt: loaded.fetchedAt || nowIso(storedAt),
          sourceUrl: loaded.sourceUrl || '',
          originBackend: loaded.originBackend
        },
        storedAt,
        expiresAt: storedAt + effectiveFreshMs,
        staleUntil: storedAt + effectiveStaleMs
      };
      await this.cache.set(key, record, deadline.remaining());
      return { record, loadedByPeer: false };
    } finally {
      await this.coordinator.releaseLock(key, lockToken, Math.max(1, deadline.remaining()));
    }
  }

  async load({ key, freshMs, staleMs, load, deadline }) {
    deadline.throwIfExpired();
    const now = Date.now();
    const cached = await this.cache.get(key, deadline.remaining());
    deadline.throwIfExpired();
    if (cached?.expiresAt > now) {
      return {
        value: cached.value,
        ...cached.context,
        attempts: [cacheHitAttempt(key, cached.storedAt, false, now)],
        cacheStatus: 'fresh-cache',
        cacheLayer: cached.cacheLayer ?? 'gateway-memory',
        cacheAgeMs: Math.max(0, now - cached.storedAt)
      };
    }

    let task = this.inFlight.get(key);
    if (!task) {
      const operationDeadline = deadline.detached();
      task = this.#loadWithDistributedLock({ key, freshMs, staleMs, load, deadline: operationDeadline })
        .finally(() => {
          if (this.inFlight.get(key) === task) this.inFlight.delete(key);
        });
      // The shared operation is gateway-owned and survives a disconnected client.
      void task.catch(() => undefined);
      this.inFlight.set(key, task);
    }

    try {
      const { record, loadedByPeer } = await waitForSubscriber(task, deadline);
      if (loadedByPeer) {
        return {
          value: record.value,
          ...record.context,
          attempts: [cacheHitAttempt(key, record.storedAt)],
          cacheStatus: 'fresh-cache',
          cacheLayer: record.cacheLayer ?? 'gateway-redis',
          cacheAgeMs: Math.max(0, Date.now() - record.storedAt)
        };
      }
      return {
        value: record.value,
        ...record.context,
        attempts: record.context.attempts,
        cacheStatus: 'network',
        cacheLayer: 'none',
        cacheAgeMs: 0
      };
    } catch (error) {
      const fallbackNow = Date.now();
      if (cached?.staleUntil > fallbackNow) {
        return {
          value: cached.value,
          ...cached.context,
          attempts: [
            ...(error instanceof GatewayError ? error.attempts : []),
            cacheHitAttempt(key, cached.storedAt, true)
          ],
          cacheStatus: 'stale-cache',
          cacheLayer: cached.cacheLayer ?? 'gateway-memory',
          cacheAgeMs: Math.max(0, fallbackNow - cached.storedAt),
          fallbackReason: fallbackReasonForError(error),
          fallbackStatus: Number.isInteger(error?.status) ? error.status : undefined,
          retryAt: error?.retryAt
        };
      }
      throw error;
    }
  }
}
