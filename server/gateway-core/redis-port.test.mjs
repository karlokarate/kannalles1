import { describe, expect, it, vi } from 'vitest';
import {
  LazyRedisRuntime,
  MemoryCoordinator,
  RedisBackedCachePort,
  RedisBackedCoordinator
} from './redis-port.mjs';

describe('Redis coordination failure policy', () => {
  it('fails closed by default when configured Redis is unavailable', async () => {
    const runtime = {
      configured: true,
      key: (_kind, key) => key,
      run: vi.fn().mockRejectedValue(new Error('unavailable'))
    };
    const coordinator = new RedisBackedCoordinator(runtime, { failureMode: 'closed' });
    await expect(coordinator.takeToken('off-product', 15, 60_000))
      .rejects.toMatchObject({ status: 503, code: 'DISTRIBUTED_COORDINATION_UNAVAILABLE' });
  });

  it('uses instance coordination only when memory fallback is explicit', async () => {
    const runtime = {
      configured: true,
      key: (_kind, key) => key,
      run: vi.fn().mockRejectedValue(new Error('unavailable'))
    };
    const coordinator = new RedisBackedCoordinator(runtime, {
      failureMode: 'memory',
      memory: new MemoryCoordinator()
    });
    await expect(coordinator.takeToken('off-product', 15, 60_000))
      .resolves.toMatchObject({ allowed: true });
  });
});

describe('Redis cache index lifecycle', () => {
  it('prunes expired index members on every cache write', async () => {
    const client = {
      set: vi.fn().mockResolvedValue('OK'),
      zAdd: vi.fn().mockResolvedValue(1),
      zRemRangeByScore: vi.fn().mockResolvedValue(3)
    };
    const runtime = {
      configured: true,
      key: (kind, key) => `kh:${kind}:${key}`,
      run: vi.fn((operation) => operation(client))
    };
    const cache = new RedisBackedCachePort(runtime);
    await cache.set('product:fixture', {
      value: { product: { code: '4000417025005' } },
      storedAt: Date.now(),
      expiresAt: Date.now() + 1_000,
      staleUntil: Date.now() + 10_000
    }, 500);

    expect(client.zRemRangeByScore).toHaveBeenCalledWith('kh:cache:index', 0, expect.any(Number));
  });
});

describe('LazyRedisRuntime lifecycle', () => {
  it('destroys a failed client and reports unavailable without blocking startup construction', async () => {
    const client = {
      isReady: false,
      on: vi.fn(),
      connect: vi.fn().mockRejectedValue(new Error('connect failed')),
      destroy: vi.fn()
    };
    const runtime = new LazyRedisRuntime({
      url: 'redis://example.invalid:6379',
      clientFactory: () => client,
      logger: { warn: vi.fn() }
    });
    expect(runtime.status().connectivity).toBe('unknown');
    await expect(runtime.ready()).rejects.toThrow('connect failed');
    expect(client.destroy).toHaveBeenCalledOnce();
    expect(runtime.status().connectivity).toBe('unavailable');
  });

  it('enforces a hard command timeout and destroys the stuck socket', async () => {
    const client = {
      isReady: true,
      on: vi.fn(),
      connect: vi.fn(),
      destroy: vi.fn()
    };
    const runtime = new LazyRedisRuntime({
      url: 'redis://example.invalid:6379',
      commandTimeoutMs: 10,
      clientFactory: () => client,
      logger: { warn: vi.fn() }
    });
    runtime.client = client;
    runtime.everAttempted = true;
    await expect(runtime.run(() => new Promise(() => undefined))).rejects.toThrow('Redis operation timeout');
    expect(client.destroy).toHaveBeenCalledOnce();
  });

  it('applies the same hard budget to a connection attempt', async () => {
    const client = {
      isReady: false,
      on: vi.fn(),
      connect: vi.fn(() => new Promise(() => undefined)),
      destroy: vi.fn()
    };
    const runtime = new LazyRedisRuntime({
      url: 'redis://example.invalid:6379',
      commandTimeoutMs: 10,
      clientFactory: () => client,
      logger: { warn: vi.fn() }
    });
    await expect(runtime.run(() => 'never')).rejects.toThrow('Redis operation timeout');
    expect(client.destroy).toHaveBeenCalledOnce();
    expect(runtime.status().connectivity).toBe('unavailable');
  });
});
