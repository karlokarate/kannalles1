import type { CatalogProduct, CatalogSearchHit } from '../lib/catalog/catalogDomain';
import { getOfflineCatalogProduct } from '../lib/catalog/catalogClient';
import { clinicProductByCode, isClinicCatalogProduct } from '../lib/clinicCatalog';
import { genericProductByCode } from '../lib/genericFoods';
import { manualCatalogProductByCode } from '../lib/manualCatalog';
import type { ClinicMode } from '../lib/settings';
import type { FavoriteProduct } from '../lib/userDataStore';
import { normalizedIdentityText } from './catalogViewModel';

function favoriteSearchText(favorite: FavoriteProduct): string {
  return normalizedIdentityText([
    favorite.displayName,
    favorite.brand ?? '',
    favorite.code
  ].join(' '));
}

export function favoriteMatchesQuery(favorite: FavoriteProduct, query: string): boolean {
  const normalizedQuery = normalizedIdentityText(query);
  if (!normalizedQuery || /^\d{8,14}$/.test(normalizedQuery)) return false;
  const tokens = normalizedQuery.split(' ').filter(Boolean);
  const text = favoriteSearchText(favorite);
  return tokens.every((token) => text.includes(token));
}

function productAllowedByClinicMode(product: CatalogProduct, clinicMode: ClinicMode): boolean {
  if (clinicMode === 'clinic-only') return isClinicCatalogProduct(product);
  if (clinicMode === 'off') return !isClinicCatalogProduct(product);
  return true;
}

async function favoriteProductByCode(code: string, signal?: AbortSignal): Promise<CatalogProduct | null> {
  return genericProductByCode(code)
    ?? clinicProductByCode(code)
    ?? manualCatalogProductByCode(code)
    ?? await getOfflineCatalogProduct(code, signal).catch((error) => {
      if (error instanceof DOMException && error.name === 'AbortError') throw error;
      return null;
    });
}

export async function loadMatchingFavoriteHits(
  favorites: readonly FavoriteProduct[],
  query: string,
  clinicMode: ClinicMode,
  signal?: AbortSignal
): Promise<CatalogSearchHit[]> {
  const matching = favorites.filter((favorite) => favoriteMatchesQuery(favorite, query));
  const products = await Promise.all(matching.map((favorite) => favoriteProductByCode(favorite.code, signal)));
  const seen = new Set<number>();
  const hits: CatalogSearchHit[] = [];
  for (const product of products) {
    if (!product || seen.has(product.productId) || !productAllowedByClinicMode(product, clinicMode)) continue;
    seen.add(product.productId);
    hits.push({ ...product, resultIndex: hits.length });
  }
  return hits;
}

export function prioritizeFavoriteHits(
  favoriteHits: readonly CatalogSearchHit[],
  regularHits: readonly CatalogSearchHit[]
): CatalogSearchHit[] {
  const seen = new Set<number>();
  return [...favoriteHits, ...regularHits]
    .filter((hit) => {
      if (seen.has(hit.productId)) return false;
      seen.add(hit.productId);
      return true;
    })
    .map((hit, resultIndex) => ({ ...hit, resultIndex }));
}

export function sameCatalogHitOrder(
  left: readonly CatalogSearchHit[],
  right: readonly CatalogSearchHit[]
): boolean {
  return left.length === right.length
    && left.every((hit, index) => hit.productId === right[index]?.productId);
}
