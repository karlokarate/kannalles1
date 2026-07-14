import type { CatalogProduct, CatalogSearchHit } from './catalog/catalogDomain';
import { listManualProducts, type ManualProduct } from './userDataStore';

const MANUAL_CODE_PREFIX = 'manual:';

function normalize(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase('de-DE').replace(/[^a-z0-9äöüß]+/g, ' ').trim().replace(/\s+/g, ' ');
}

function stableManualProductId(id: string): number {
  let hash = 2166136261;
  for (const character of id) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return -1_000_000_000 - (hash >>> 0);
}

export function isManualCatalogProduct(product: Pick<CatalogProduct, 'code'>): boolean {
  return product.code.startsWith(MANUAL_CODE_PREFIX);
}

export function manualProductCode(id: string): string {
  return `${MANUAL_CODE_PREFIX}${id}`;
}

export function manualProductToCatalogProduct(item: ManualProduct, rankOrdinal = 0): CatalogProduct {
  return {
    productId: stableManualProductId(item.id),
    code: manualProductCode(item.id),
    displayName: item.label,
    brand: 'Eigenes Produkt',
    nutrition: {
      carbohydratesPer100: item.carbohydratesPer100,
      basis: item.basis,
      source: 'as_sold'
    },
    unitEvidence: {
      manufacturerServing: null,
      productQuantity: null,
      provenSmallestUnit: null,
      defaultUnitKind: item.basis
    },
    imageReference: null,
    hasQualityErrors: false,
    rankOrdinal
  };
}

export function searchManualProducts(products: readonly ManualProduct[], query: string): CatalogSearchHit[] {
  const needle = normalize(query);
  if (!needle) return [];
  const tokens = needle.split(' ').filter(Boolean);
  return products
    .map((item, index) => ({ item, index, text: normalize(`${item.label} Eigenes Produkt ${manualProductCode(item.id)} ${item.id}`) }))
    .filter(({ text }) => tokens.every((token) => text.includes(token)))
    .sort((a, b) => {
      const aName = normalize(a.item.label);
      const bName = normalize(b.item.label);
      const score = (name: string, text: string) => (name === needle ? 100 : 0) + (name.startsWith(needle) ? 20 : 0) + (text.startsWith(needle) ? 5 : 0);
      return score(bName, b.text) - score(aName, a.text) || b.item.updatedAt.localeCompare(a.item.updatedAt) || a.index - b.index;
    })
    .map(({ item }, resultIndex) => ({ ...manualProductToCatalogProduct(item, -1_000_000 + resultIndex), resultIndex }));
}

export function searchManualCatalog(query: string): CatalogSearchHit[] {
  return searchManualProducts(listManualProducts(), query);
}

export function manualCatalogProductByCode(code: string): CatalogProduct | null {
  if (!code.startsWith(MANUAL_CODE_PREFIX)) return null;
  const id = code.slice(MANUAL_CODE_PREFIX.length);
  const item = listManualProducts().find((candidate) => candidate.id === id);
  return item ? manualProductToCatalogProduct(item, -1_000_000) : null;
}
