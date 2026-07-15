import { describe, expect, it } from 'vitest';
import type { CatalogSearchHit } from '../lib/catalog/catalogDomain';
import type { FavoriteProduct } from '../lib/userDataStore';
import {
  favoriteMatchesQuery,
  prioritizeFavoriteHits,
  sameCatalogHitOrder
} from './favoriteSearch';

function hit(productId: number, displayName: string, resultIndex: number): CatalogSearchHit {
  return {
    productId,
    code: String(40_000_000_000_000 + productId),
    displayName,
    brand: productId === 2 ? 'Dr. Oetker' : productId === 3 ? 'Veso' : 'Andere Marke',
    nutrition: { carbohydratesPer100: 30, basis: 'mass', source: 'as_sold' },
    unitEvidence: {
      manufacturerServing: null,
      productQuantity: null,
      provenSmallestUnit: null,
      defaultUnitKind: 'mass'
    },
    imageReference: null,
    hasQualityErrors: false,
    rankOrdinal: resultIndex + 1,
    resultIndex
  };
}

function favorite(productId: number, displayName: string, brand: string): FavoriteProduct {
  return {
    schemaVersion: 2,
    productId,
    code: String(40_000_000_000_000 + productId),
    displayName,
    brand,
    addedAt: `2026-07-15T00:00:0${productId}.000Z`
  };
}

describe('favorite search priority', () => {
  it('matches broad and specific product queries but never overrides a barcode lookup', () => {
    const pizza = favorite(2, 'Pizza Salami', 'Dr. Oetker');
    expect(favoriteMatchesQuery(pizza, 'Pizza')).toBe(true);
    expect(favoriteMatchesQuery(pizza, 'Dr Oetker Pizza')).toBe(true);
    expect(favoriteMatchesQuery(pizza, 'Pizza Margherita')).toBe(false);
    expect(favoriteMatchesQuery(pizza, pizza.code)).toBe(false);
  });

  it('moves matching favorites ahead of the catalog rank without changing either stable subgroup order', () => {
    const cracker = hit(1, 'Pizza Cracker', 0);
    const salami = hit(2, 'Pizza Salami', 8);
    const margherita = hit(3, 'Pizza Margherita', 14);
    const regular = hit(4, 'Pizza Funghi', 1);

    const prioritized = prioritizeFavoriteHits([margherita, salami], [cracker, regular, salami]);
    expect(prioritized.map((item) => item.displayName)).toEqual([
      'Pizza Margherita',
      'Pizza Salami',
      'Pizza Cracker',
      'Pizza Funghi'
    ]);
    expect(prioritized.map((item) => item.resultIndex)).toEqual([0, 1, 2, 3]);
    expect(prioritized.map((item) => item.rankOrdinal)).toEqual([15, 9, 1, 2]);
  });

  it('injects a favorite even when it was absent from the regular first page', () => {
    const favoriteOutsidePage = hit(3, 'Pizza Margherita', 44);
    const firstPage = [hit(1, 'Pizza Cracker', 0), hit(4, 'Pizza Funghi', 1)];
    const prioritized = prioritizeFavoriteHits([favoriteOutsidePage], firstPage);
    expect(prioritized[0]?.productId).toBe(3);
    expect(prioritized).toHaveLength(3);
    expect(sameCatalogHitOrder(prioritized, prioritizeFavoriteHits([favoriteOutsidePage], prioritized))).toBe(true);
  });
});
