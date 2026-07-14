import { describe, expect, test } from 'vitest';
import { manualProductCode, manualProductToCatalogProduct, searchManualProducts } from './manualCatalog';
import type { ManualProduct } from './userDataStore';

const products: ManualProduct[] = [
  { schemaVersion: 1, id: 'abc-123', label: 'Chris Spezialriegel', carbohydratesPer100: 42, basis: 'mass', imageDataUrl: null, createdAt: '2026-07-14T10:00:00.000Z', updatedAt: '2026-07-14T10:00:00.000Z' },
  { schemaVersion: 1, id: 'drink-1', label: 'Hauslimonade', carbohydratesPer100: 8.5, basis: 'volume', imageDataUrl: null, createdAt: '2026-07-13T10:00:00.000Z', updatedAt: '2026-07-13T10:00:00.000Z' }
];

describe('manual catalog projection', () => {
  test('projects a stable local catalog identity with direct mass or volume units', () => {
    const first = manualProductToCatalogProduct(products[0]);
    const second = manualProductToCatalogProduct(products[0]);
    expect(first.productId).toBe(second.productId);
    expect(first.code).toBe(manualProductCode('abc-123'));
    expect(first.brand).toBe('Eigenes Produkt');
    expect(first.unitEvidence.defaultUnitKind).toBe('mass');
  });

  test('returns manually stored products for label and manual code searches', () => {
    expect(searchManualProducts(products, 'Spezialriegel')).toHaveLength(1);
    expect(searchManualProducts(products, 'Eigenes Produkt').map((hit) => hit.displayName)).toEqual(['Chris Spezialriegel', 'Hauslimonade']);
    expect(searchManualProducts(products, manualProductCode('drink-1'))[0]?.displayName).toBe('Hauslimonade');
  });
});
