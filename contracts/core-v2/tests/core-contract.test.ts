import { describe, expect, it } from 'vitest';
import { catalogDiagnostics, CatalogFailure, toCatalogFailure } from '../../../src/lib/catalog/catalogErrors';
import type { CatalogProduct, CatalogStatus, CatalogUnitEvidence } from '../../../src/lib/catalog/catalogDomain';

const buenoUnit: CatalogUnitEvidence = {
  kind: 'bar',
  value: 21.5,
  basis: 'mass',
  source: 'explicit_multipack_quantity',
  countability: 'countable',
  smallestEdibleUnit: true,
  proven: true
};

const bueno: CatalogProduct = {
  productId: 1,
  code: '4008400321622',
  displayName: 'Kinder Bueno',
  brand: 'Kinder',
  carbohydratesPer100: 49.5,
  nutritionBasis: 'mass',
  nutritionSource: 'as_sold',
  manufacturerServing: { value: 43, basis: 'mass' },
  productQuantity: { value: 43, basis: 'mass' },
  provenUnit: buenoUnit,
  defaultUnitKind: 'bar',
  image: null,
  hasQualityErrors: false,
  rankOrdinal: 1000
};

describe('catalog-native core boundary', () => {
  it('represents the smallest proven edible unit without legacy API fields', () => {
    expect(bueno.provenUnit).toEqual(buenoUnit);
    expect(bueno.provenUnit?.value).toBe(21.5);
    expect(bueno).not.toHaveProperty('serving_size');
    expect(bueno).not.toHaveProperty('product_quantity');
    expect(bueno).not.toHaveProperty('nutriments');
  });

  it('keeps one verified slot as the only ready authority', () => {
    const status: CatalogStatus = {
      state: 'ready',
      activeSlot: 'a',
      catalogVersion: '2026-07-13',
      productCount: 317579,
      progress: null,
      diagnostics: null,
      retryAllowedImmediately: true
    };
    expect(status.activeSlot).toBe('a');
  });

  it('preserves an existing CatalogFailure and wraps unknown failures', () => {
    const existing = new CatalogFailure('CATALOG_OPEN_FAILED', 'Katalog konnte nicht geöffnet werden.', {
      operation: 'open',
      technical: 'sqlite open failed'
    });
    expect(toCatalogFailure(existing, 'CATALOG_UNKNOWN', 'ignored', { operation: 'open' })).toBe(existing);

    const wrapped = toCatalogFailure(new Error('boom'), 'CATALOG_QUERY_FAILED', 'Suche fehlgeschlagen.', {
      operation: 'search'
    });
    expect(catalogDiagnostics(wrapped)?.code).toBe('CATALOG_QUERY_FAILED');
    expect(catalogDiagnostics(new Error('plain'))).toBeNull();
  });
});
