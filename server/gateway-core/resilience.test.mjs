import { describe, expect, it, vi } from 'vitest';
import { GatewayError } from './errors.mjs';
import { MemoryCachePort, MemoryCoordinator } from './redis-port.mjs';
import { CachedLoader, Deadline, fetchJson } from './resilience.mjs';

function streamingResponse(read) {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: new Headers({ 'Content-Type': 'application/json' }),
    body: { getReader: () => ({ read, cancel: async () => undefined }) }
  };
}

describe('bounded upstream body streaming', () => {
  it('forbids redirects and normalizes arbitrary upstream statuses', async () => {
    const fetchFn = vi.fn(async () => new Response('{"error":"unauthorized"}', {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    }));
    await expect(fetchJson({
      fetchFn,
      url: new URL('https://upstream.example/data'),
      backend: 'search-index',
      label: 'fixture',
      deadline: new Deadline(500),
      maxDurationMs: 400,
      headers: { Authorization: 'Bearer secret' }
    })).rejects.toSatisfy((error) => {
      expect(error).toMatchObject({ status: 502, code: 'UPSTREAM_HTTP_ERROR' });
      expect(error.attempts[0].status).toBe(401);
      return true;
    });
    expect(fetchFn).toHaveBeenCalledWith(expect.any(URL), expect.objectContaining({ redirect: 'error' }));
  });

  it('classifies a body stream failure as a network error, not an oversized body', async () => {
    const fetchFn = async () => streamingResponse(async () => {
      throw new Error('socket reset');
    });
    await expect(fetchJson({
      fetchFn,
      url: new URL('https://upstream.example/data'),
      backend: 'search-index',
      label: 'fixture',
      deadline: new Deadline(500),
      maxDurationMs: 400
    })).rejects.toSatisfy((error) => {
      expect(error).toMatchObject({ status: 502, code: 'NETWORK_ERROR' });
      expect(error.attempts[0].outcome).toBe('network-error');
      return true;
    });
  });

  it('classifies a deadline during body streaming as timeout', async () => {
    const fetchFn = async (_url, init) => streamingResponse(() => new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true });
    }));
    await expect(fetchJson({
      fetchFn,
      url: new URL('https://upstream.example/data'),
      backend: 'search-index',
      label: 'fixture',
      deadline: new Deadline(90),
      maxDurationMs: 500
    })).rejects.toSatisfy((error) => {
      expect(error).toMatchObject({ status: 504, code: 'DEADLINE_EXCEEDED' });
      expect(error.attempts[0].outcome).toBe('timeout');
      return true;
    });
  });

  it('classifies an external abort during body streaming as aborted', async () => {
    const controller = new AbortController();
    const fetchFn = async (_url, init) => streamingResponse(() => new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true });
    }));
    const pending = fetchJson({
      fetchFn,
      url: new URL('https://upstream.example/data'),
      backend: 'search-index',
      label: 'fixture',
      deadline: new Deadline(500, { signal: controller.signal }),
      maxDurationMs: 400
    });
    controller.abort();
    await expect(pending).rejects.toSatisfy((error) => {
      expect(error).toMatchObject({ status: 499, code: 'ABORTED' });
      expect(error.attempts[0].outcome).toBe('aborted');
      return true;
    });
  });

  it('enforces the response size limit explicitly', async () => {
    let read = false;
    const fetchFn = async () => streamingResponse(async () => {
      if (read) return { done: true };
      read = true;
      return { done: false, value: new TextEncoder().encode('{"large":true}') };
    });
    await expect(fetchJson({
      fetchFn,
      url: new URL('https://upstream.example/data'),
      backend: 'search-index',
      label: 'fixture',
      deadline: new Deadline(500),
      maxDurationMs: 400,
      maxResponseBytes: 4
    })).rejects.toMatchObject({ status: 502, code: 'RESPONSE_TOO_LARGE' });
  });
});

describe('stale cache boundary', () => {
  it('does not serve a stale record that expired while the network attempt was running', async () => {
    const now = Date.now();
    const record = {
      value: { hits: [{ code: 'expired' }] },
      context: { attempts: [], fetchedAt: new Date(now).toISOString(), sourceUrl: 'upstream://fixture', originBackend: 'gateway' },
      storedAt: now - 1_000,
      expiresAt: now - 500,
      staleUntil: now + 15,
      cacheLayer: 'gateway-memory'
    };
    const loader = new CachedLoader({
      cache: { get: async () => record, set: async () => undefined },
      coordinator: new MemoryCoordinator()
    });
    await expect(loader.load({
      key: 'fixture',
      freshMs: 1,
      staleMs: 1,
      deadline: new Deadline(500),
      load: async () => {
        await new Promise((resolve) => setTimeout(resolve, 25));
        throw new GatewayError('network failed', { status: 503 });
      }
    })).rejects.toMatchObject({ status: 503 });
  });
});

describe('distributed loader coordination', () => {
  it('keeps a shared lock for a leader running longer than ten seconds', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-12T00:00:00.000Z'));
    try {
      const cache = new MemoryCachePort();
      const coordinator = new MemoryCoordinator();
      const lockTtls = [];
      const acquireLock = coordinator.acquireLock.bind(coordinator);
      coordinator.acquireLock = async (key, ttlMs, token, timeoutMs) => {
        lockTtls.push(ttlMs);
        return acquireLock(key, ttlMs, token, timeoutMs);
      };
      const leaderLoader = new CachedLoader({ cache, coordinator });
      const peerLoader = new CachedLoader({ cache, coordinator });
      let upstreamCalls = 0;
      const load = async () => {
        upstreamCalls += 1;
        await new Promise((resolve) => setTimeout(resolve, 11_000));
        return {
          value: { hits: [{ code: 'long-running' }] },
          attempts: [],
          fetchedAt: new Date().toISOString(),
          sourceUrl: 'upstream://fixture/search',
          originBackend: 'search-index'
        };
      };
      const options = {
        key: 'shared-long-request',
        freshMs: 60_000,
        staleMs: 120_000,
        load
      };

      const leader = leaderLoader.load({ ...options, deadline: new Deadline(14_000) });
      await vi.advanceTimersByTimeAsync(0);
      const peer = peerLoader.load({ ...options, deadline: new Deadline(14_000) });
      await vi.advanceTimersByTimeAsync(11_000);
      const results = await Promise.all([leader, peer]);

      expect(upstreamCalls).toBe(1);
      expect(lockTtls[0]).toBeGreaterThan(14_000);
      expect(results.map((result) => result.cacheStatus).sort()).toEqual(['fresh-cache', 'network']);
      expect(results[0].fetchedAt).toBe(results[1].fetchedAt);
    } finally {
      vi.useRealTimers();
    }
  });
});
