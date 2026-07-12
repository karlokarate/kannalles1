export function offProductImageCacheName(appVersion: string): string {
  return `kh-v${appVersion}-off-product-images`;
}

// Release, prerelease, development and legacy version labels all share the
// same suffix. Restrict deletion to this app-owned namespace, not to SemVer,
// so a cache from e.g. `vnext` or `v2.3.0-rc.1` cannot survive a privacy clear.
const OFF_IMAGE_CACHE_PATTERN = /^kh-v[^/\s]+-off-product-images$/;

/** Delete product-image runtime caches from every release; never app-shell/workbox caches. */
export async function clearOffProductImageCache(appVersion: string): Promise<boolean> {
  if (typeof caches === 'undefined') return false;
  try {
    const currentName = offProductImageCacheName(appVersion);
    const existing = await caches.keys();
    const names = new Set(existing.filter((name) => OFF_IMAGE_CACHE_PATTERN.test(name)));
    if (OFF_IMAGE_CACHE_PATTERN.test(currentName)) names.add(currentName);
    const deleted = await Promise.all([...names].map((name) => caches.delete(name)));
    return deleted.some(Boolean);
  } catch {
    return false;
  }
}
