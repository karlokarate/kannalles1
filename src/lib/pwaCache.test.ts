import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearOffProductImageCache, offProductImageCacheName } from './pwaCache';

afterEach(() => vi.unstubAllGlobals());

describe('scoped PWA cache cleanup', () => {
  it('deletes current and old OFF image caches but never app-shell/workbox caches', async () => {
    const remove = vi.fn(async () => true);
    vi.stubGlobal('caches', {
      keys: vi.fn(async () => [
        'kh-v2.2.4-off-product-images',
        'kh-v2.1-off-product-images',
        'kh-vnext-off-product-images',
        'kh-v2.3.0-rc.1-off-product-images',
        'workbox-precache-v2.2.4',
        'kh-v2.2.4-api-cache'
      ]),
      delete: remove
    });
    await expect(clearOffProductImageCache('2.2.4')).resolves.toBe(true);
    expect(remove).toHaveBeenCalledWith('kh-v2.2.4-off-product-images');
    expect(remove).toHaveBeenCalledWith('kh-v2.1-off-product-images');
    expect(remove).toHaveBeenCalledWith('kh-vnext-off-product-images');
    expect(remove).toHaveBeenCalledWith('kh-v2.3.0-rc.1-off-product-images');
    expect(remove).toHaveBeenCalledTimes(4);
    expect(remove).not.toHaveBeenCalledWith(expect.stringMatching(/precache|workbox|api-cache/i));
    expect(offProductImageCacheName('2.2.4')).toBe('kh-v2.2.4-off-product-images');
  });

  it('fails soft when CacheStorage is unavailable', async () => {
    vi.stubGlobal('caches', undefined);
    await expect(clearOffProductImageCache('2.2.4')).resolves.toBe(false);
  });
});
