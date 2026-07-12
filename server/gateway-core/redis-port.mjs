import { createClient } from 'redis';
import { GatewayError } from './errors.mjs';

const RELEASE_LOCK_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`;

const TOKEN_BUCKET_SCRIPT = `
local capacity = tonumber(ARGV[1])
local refill_per_ms = tonumber(ARGV[2])
local now = tonumber(ARGV[3])
local cost = tonumber(ARGV[4])
local ttl = tonumber(ARGV[5])
local tokens = tonumber(redis.call('HGET', KEYS[1], 'tokens'))
local updated_at = tonumber(redis.call('HGET', KEYS[1], 'updated_at'))
if tokens == nil then tokens = capacity end
if updated_at == nil then updated_at = now end
tokens = math.min(capacity, tokens + math.max(0, now - updated_at) * refill_per_ms)
local allowed = 0
local retry_ms = 0
if tokens >= cost then
  tokens = tokens - cost
  allowed = 1
else
  retry_ms = math.ceil((cost - tokens) / refill_per_ms)
end
redis.call('HSET', KEYS[1], 'tokens', tostring(tokens), 'updated_at', tostring(now))
redis.call('PEXPIRE', KEYS[1], ttl)
return {allowed, tostring(tokens), retry_ms}
`;

const CIRCUIT_BEFORE_SCRIPT = `
local now = tonumber(ARGV[1])
local probe_ms = tonumber(ARGV[2])
local ttl = tonumber(ARGV[3])
local open_until = tonumber(redis.call('HGET', KEYS[1], 'open_until')) or 0
local half_open_until = tonumber(redis.call('HGET', KEYS[1], 'half_open_until')) or 0
if open_until > now then
  return {'open', open_until}
end
if open_until > 0 then
  if half_open_until > now then return {'open', half_open_until} end
  half_open_until = now + probe_ms
  redis.call('HSET', KEYS[1], 'half_open_until', half_open_until)
  redis.call('PEXPIRE', KEYS[1], ttl)
  return {'half-open', half_open_until}
end
return {'closed', 0}
`;

const CIRCUIT_FAILURE_SCRIPT = `
local now = tonumber(ARGV[1])
local threshold = tonumber(ARGV[2])
local cooldown_ms = tonumber(ARGV[3])
local retry_at = tonumber(ARGV[4])
local ttl = tonumber(ARGV[5])
local failures = tonumber(redis.call('HGET', KEYS[1], 'failures')) or 0
local was_open = (tonumber(redis.call('HGET', KEYS[1], 'open_until')) or 0) > 0
failures = failures + 1
local open_until = 0
if failures >= threshold or was_open then
  open_until = math.max(now + cooldown_ms, retry_at)
end
redis.call('HSET', KEYS[1], 'failures', failures, 'open_until', open_until, 'half_open_until', 0)
redis.call('PEXPIRE', KEYS[1], ttl)
return {failures, open_until}
`;

function safeMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

export class LazyRedisRuntime {
  constructor({
    url,
    prefix = 'kh-gateway:v1',
    connectTimeoutMs = 1_500,
    commandTimeoutMs = 500,
    clientFactory = createClient,
    logger = console
  } = {}) {
    this.url = String(url || '').trim();
    this.prefix = prefix;
    this.connectTimeoutMs = connectTimeoutMs;
    this.commandTimeoutMs = commandTimeoutMs;
    this.clientFactory = clientFactory;
    this.logger = logger;
    this.client = null;
    this.connectPromise = null;
    this.unavailableUntil = 0;
    this.lastError = null;
    this.everAttempted = false;
  }

  get configured() {
    return Boolean(this.url);
  }

  get degraded() {
    return this.configured && this.everAttempted
      && (this.unavailableUntil > Date.now() || Boolean(this.lastError && !this.client?.isReady));
  }

  key(kind, key) {
    return `${this.prefix}:${kind}:${key}`;
  }

  async ready() {
    if (!this.configured) throw new Error('Redis ist nicht konfiguriert.');
    if (this.client?.isReady) return this.client;
    if (Date.now() < this.unavailableUntil) throw this.lastError || new Error('Redis ist temporär nicht erreichbar.');
    if (!this.client) {
      const client = this.clientFactory({
        url: this.url,
        socket: {
          connectTimeout: this.connectTimeoutMs,
          reconnectStrategy: () => false
        }
      });
      client.on('error', (error) => {
        this.lastError = error;
      });
      this.client = client;
    }
    if (!this.connectPromise) {
      this.everAttempted = true;
      const connectingClient = this.client;
      this.connectPromise = connectingClient.connect()
        .then(() => {
          if (this.client !== connectingClient) {
            connectingClient.destroy?.();
            throw new Error('Redis connection attempt was superseded.');
          }
          this.lastError = null;
          this.unavailableUntil = 0;
          return connectingClient;
        })
        .catch((error) => {
          this.lastError = error;
          this.unavailableUntil = Date.now() + 10_000;
          // Logging contains neither REDIS_URL nor command arguments.
          this.logger?.warn?.('Gateway Redis unavailable; applying configured coordination failure policy.');
          try {
            connectingClient.destroy?.();
          } catch {
            // ignore cleanup errors
          }
          if (this.client === connectingClient) this.client = null;
          throw error;
        })
        .finally(() => {
          this.connectPromise = null;
        });
    }
    return this.connectPromise;
  }

  async run(operation, timeoutMs = this.commandTimeoutMs) {
    const budgetMs = Math.max(
      1,
      Math.min(this.commandTimeoutMs, Number.isFinite(timeoutMs) ? timeoutMs : this.commandTimeoutMs)
    );
    let timeout;
    try {
      const value = await Promise.race([
        this.ready().then((client) => operation(client)),
        new Promise((_, reject) => {
          timeout = setTimeout(
            () => reject(new Error(`Redis operation timeout after ${budgetMs} ms`)),
            budgetMs
          );
        })
      ]);
      this.lastError = null;
      return value;
    } catch (error) {
      this.lastError = error;
      this.unavailableUntil = Date.now() + 5_000;
      try {
        this.client?.destroy?.();
      } catch {
        // ignore cleanup errors
      }
      this.client = null;
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  status() {
    return {
      configured: this.configured,
      degraded: this.degraded,
      connectivity: !this.configured ? 'ready' : !this.everAttempted ? 'unknown' : this.degraded ? 'unavailable' : 'ready',
      lastError: this.degraded && this.lastError ? safeMessage(this.lastError).slice(0, 160) : null
    };
  }

  async close() {
    const client = this.client;
    this.client = null;
    this.connectPromise = null;
    if (!client) return;
    try {
      if (client.isReady && typeof client.close === 'function') {
        let timeout;
        await Promise.race([
          client.close(),
          new Promise((resolve) => {
            timeout = setTimeout(resolve, 1_000);
            timeout.unref?.();
          })
        ]);
        clearTimeout(timeout);
        if (client.isReady) client.destroy?.();
      } else {
        client.destroy?.();
      }
    } catch {
      try {
        client.destroy?.();
      } catch {
        // process shutdown must continue
      }
    }
  }
}

export class MemoryCachePort {
  constructor({ maxEntries = 240 } = {}) {
    this.maxEntries = maxEntries;
    this.records = new Map();
    this.kind = 'memory';
    this.distributed = false;
  }

  async get(key, _timeoutMs) {
    const record = this.records.get(key) ?? null;
    if (record && record.staleUntil <= Date.now()) {
      this.records.delete(key);
      return null;
    }
    return record ? { ...record, cacheLayer: 'gateway-memory' } : null;
  }

  async set(key, record, _timeoutMs) {
    this.records.set(key, record);
    if (this.records.size > this.maxEntries) {
      const entries = [...this.records.entries()].sort((a, b) => a[1].storedAt - b[1].storedAt);
      for (const [oldKey] of entries.slice(0, this.records.size - this.maxEntries)) this.records.delete(oldKey);
    }
  }

  async size() {
    return this.records.size;
  }
}

export class RedisBackedCachePort {
  constructor(runtime, { memory = new MemoryCachePort() } = {}) {
    this.runtime = runtime;
    this.memory = memory;
    this.kind = runtime.configured ? 'redis' : 'memory';
    this.distributed = runtime.configured;
  }

  async get(key, timeoutMs) {
    if (this.runtime.configured) {
      try {
        const raw = await this.runtime.run(async (client) => {
          const value = await client.get(this.runtime.key('cache', key));
          if (!value) await client.zRem(this.runtime.key('cache', 'index'), key);
          return value;
        }, timeoutMs);
        if (raw) {
          const record = JSON.parse(raw);
          await this.memory.set(key, record);
          return { ...record, cacheLayer: 'gateway-redis' };
        }
      } catch {
        // A cache outage must not take search, barcode lookup, or process start down.
      }
    }
    return this.memory.get(key);
  }

  async set(key, record, timeoutMs) {
    await this.memory.set(key, record);
    if (!this.runtime.configured) return;
    if (Number.isFinite(timeoutMs) && timeoutMs < 25) return;
    const ttlMs = Math.max(1, record.staleUntil - Date.now());
    try {
      await this.runtime.run(async (client) => {
        const indexKey = this.runtime.key('cache', 'index');
        await Promise.all([
          client.set(this.runtime.key('cache', key), JSON.stringify(record), { PX: ttlMs }),
          client.zAdd(indexKey, [{ score: record.staleUntil, value: key }]),
          // Prune on the write path as well as health/size reads so an
          // unattended but busy instance cannot accumulate expired members.
          client.zRemRangeByScore(indexKey, 0, Date.now())
        ]);
      }, timeoutMs);
    } catch {
      // Memory remains a valid single-instance fail-soft cache.
    }
  }

  async size() {
    if (this.runtime.configured) {
      try {
        return Number(await this.runtime.run(async (client) => {
          const indexKey = this.runtime.key('cache', 'index');
          await client.zRemRangeByScore(indexKey, 0, Date.now());
          return client.zCard(indexKey);
        }));
      } catch {
        // fall through
      }
    }
    return this.memory.size();
  }
}

export class MemoryCoordinator {
  constructor() {
    this.locks = new Map();
    this.buckets = new Map();
    this.circuits = new Map();
    this.distributed = false;
  }

  async acquireLock(key, ttlMs, token, _timeoutMs) {
    const now = Date.now();
    const current = this.locks.get(key);
    if (current && current.expiresAt > now) return false;
    this.locks.set(key, { token, expiresAt: now + ttlMs });
    return true;
  }

  async releaseLock(key, token, _timeoutMs) {
    if (this.locks.get(key)?.token === token) this.locks.delete(key);
  }

  async takeToken(key, capacity, windowMs, now = Date.now(), _timeoutMs) {
    const refillPerMs = capacity / windowMs;
    const bucket = this.buckets.get(key) ?? { tokens: capacity, updatedAt: now };
    bucket.tokens = Math.min(capacity, bucket.tokens + Math.max(0, now - bucket.updatedAt) * refillPerMs);
    bucket.updatedAt = now;
    const allowed = bucket.tokens >= 1;
    if (allowed) bucket.tokens -= 1;
    this.buckets.set(key, bucket);
    return { allowed, retryAfterMs: allowed ? 0 : Math.ceil((1 - bucket.tokens) / refillPerMs) };
  }

  async circuitBefore(key, probeMs, now = Date.now(), _timeoutMs) {
    const state = this.circuits.get(key) ?? { failures: 0, openUntil: 0, halfOpenUntil: 0 };
    if (state.openUntil > now) return { status: 'open', retryAt: state.openUntil };
    if (state.openUntil > 0) {
      if (state.halfOpenUntil > now) return { status: 'open', retryAt: state.halfOpenUntil };
      state.halfOpenUntil = now + probeMs;
      this.circuits.set(key, state);
      return { status: 'half-open', retryAt: state.halfOpenUntil };
    }
    return { status: 'closed', retryAt: 0 };
  }

  async circuitSuccess(key, _timeoutMs) {
    this.circuits.delete(key);
  }

  async circuitFailure(key, { threshold, cooldownMs, retryAt = 0, now = Date.now() }, _timeoutMs) {
    const state = this.circuits.get(key) ?? { failures: 0, openUntil: 0, halfOpenUntil: 0 };
    state.failures += 1;
    if (state.failures >= threshold || state.openUntil > 0) {
      state.openUntil = Math.max(now + cooldownMs, retryAt);
    }
    state.halfOpenUntil = 0;
    this.circuits.set(key, state);
    return state;
  }

  async circuitStatus(key, now = Date.now()) {
    const state = this.circuits.get(key);
    if (!state) return 'closed';
    if (state.openUntil > now) return 'open';
    return state.openUntil > 0 ? 'half-open' : 'closed';
  }
}

export class RedisBackedCoordinator {
  constructor(runtime, { memory = new MemoryCoordinator(), failureMode = 'closed' } = {}) {
    this.runtime = runtime;
    this.memory = memory;
    this.distributed = runtime.configured;
    this.failureMode = failureMode;
  }

  async #redisOrMemory(redisOperation, memoryOperation, timeoutMs) {
    if (this.runtime.configured) {
      try {
        return await this.runtime.run(redisOperation, timeoutMs);
      } catch {
        if (this.failureMode !== 'memory') {
          throw new GatewayError('Verteilte Gateway-Koordination ist temporär nicht verfügbar.', {
            status: 503,
            code: 'DISTRIBUTED_COORDINATION_UNAVAILABLE'
          });
        }
        // Explicit single-instance/fail-soft mode.
      }
    }
    return memoryOperation();
  }

  async acquireLock(key, ttlMs, token, timeoutMs) {
    return this.#redisOrMemory(
      async (client) => (await client.set(this.runtime.key('lock', key), token, { PX: ttlMs, NX: true })) === 'OK',
      () => this.memory.acquireLock(key, ttlMs, token),
      timeoutMs
    );
  }

  async releaseLock(key, token, timeoutMs) {
    try {
      if (this.runtime.configured && (!Number.isFinite(timeoutMs) || timeoutMs >= 25)) {
        return await this.runtime.run((client) => client.eval(RELEASE_LOCK_SCRIPT, {
          keys: [this.runtime.key('lock', key)],
          arguments: [token]
        }), timeoutMs);
      }
    } catch {
      // Lock TTL is the safety boundary; a release outage must not replace a
      // successful upstream response with an infrastructure error.
    }
    return this.memory.releaseLock(key, token);
  }

  async takeToken(key, capacity, windowMs, now = Date.now(), timeoutMs) {
    return this.#redisOrMemory(
      async (client) => {
        const result = await client.eval(TOKEN_BUCKET_SCRIPT, {
          keys: [this.runtime.key('rate', key)],
          arguments: [
            String(capacity),
            String(capacity / windowMs),
            String(now),
            '1',
            String(windowMs * 2)
          ]
        });
        return { allowed: Number(result[0]) === 1, retryAfterMs: Number(result[2]) || 0 };
      },
      () => this.memory.takeToken(key, capacity, windowMs, now),
      timeoutMs
    );
  }

  async circuitBefore(key, probeMs, now = Date.now(), timeoutMs) {
    return this.#redisOrMemory(
      async (client) => {
        const result = await client.eval(CIRCUIT_BEFORE_SCRIPT, {
          keys: [this.runtime.key('circuit', key)],
          arguments: [String(now), String(probeMs), String(24 * 60 * 60 * 1_000)]
        });
        return { status: String(result[0]), retryAt: Number(result[1]) || 0 };
      },
      () => this.memory.circuitBefore(key, probeMs, now),
      timeoutMs
    );
  }

  async circuitSuccess(key, timeoutMs) {
    return this.#redisOrMemory(
      (client) => client.del(this.runtime.key('circuit', key)),
      () => this.memory.circuitSuccess(key),
      timeoutMs
    );
  }

  async circuitFailure(key, options, timeoutMs) {
    const now = options.now ?? Date.now();
    return this.#redisOrMemory(
      async (client) => {
        const result = await client.eval(CIRCUIT_FAILURE_SCRIPT, {
          keys: [this.runtime.key('circuit', key)],
          arguments: [
            String(now),
            String(options.threshold),
            String(options.cooldownMs),
            String(options.retryAt || 0),
            String(24 * 60 * 60 * 1_000)
          ]
        });
        return { failures: Number(result[0]), openUntil: Number(result[1]), halfOpenUntil: 0 };
      },
      () => this.memory.circuitFailure(key, { ...options, now }),
      timeoutMs
    );
  }

  async circuitStatus(key, now = Date.now()) {
    if (this.runtime.configured) {
      try {
        return await this.runtime.run(async (client) => {
        const values = await client.hmGet(this.runtime.key('circuit', key), ['open_until', 'half_open_until']);
        const openUntil = Number(values[0]) || 0;
        const halfOpenUntil = Number(values[1]) || 0;
        if (openUntil > now) return 'open';
        if (openUntil > 0 || halfOpenUntil > now) return 'half-open';
        return 'closed';
        });
      } catch {
        // Health remains available and reports the runtime as degraded.
      }
    }
    return this.memory.circuitStatus(key, now);
  }
}

export function createPersistencePorts(options = {}) {
  const coordinationUrl = String(options.coordinationUrl ?? options.url ?? '').trim();
  const cacheUrl = String(options.cacheUrl ?? options.url ?? '').trim();
  const coordinationRuntime = options.coordinationRuntime ?? new LazyRedisRuntime({
    ...options,
    url: coordinationUrl,
    prefix: options.coordinationPrefix ?? options.prefix
  });
  const sameRedisRole = coordinationUrl && cacheUrl && coordinationUrl === cacheUrl;
  const cacheRuntime = options.cacheRuntime
    ?? (sameRedisRole
      ? coordinationRuntime
      : new LazyRedisRuntime({
          ...options,
          url: cacheUrl,
          prefix: options.cachePrefix ?? options.prefix
        }));
  const memoryCache = options.memoryCache ?? new MemoryCachePort({ maxEntries: options.maxEntries });
  const memoryCoordinator = options.memoryCoordinator ?? new MemoryCoordinator();
  return {
    // `runtime` remains a compatibility alias for coordination/safety state.
    runtime: coordinationRuntime,
    coordinationRuntime,
    cacheRuntime,
    cache: new RedisBackedCachePort(cacheRuntime, { memory: memoryCache }),
    coordinator: new RedisBackedCoordinator(coordinationRuntime, {
      memory: memoryCoordinator,
      failureMode: options.failureMode ?? (coordinationRuntime.configured ? 'closed' : 'memory')
    })
  };
}
