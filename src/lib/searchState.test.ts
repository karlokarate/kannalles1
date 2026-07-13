import { describe, expect, it } from 'vitest';
import type { CatalogProduct, CatalogSearchHit } from './catalog/catalogDomain';
import { catalogSearchReducer, createCatalogSearchState } from './searchState';

const product: CatalogProduct = {
  productId: 1,
  code: '4008400322728',
  displayName: 'Kinder Bueno',
  brand: 'Kinder',
  nutrition: { carbohydratesPer100: 49.5, basis: 'mass', source: 'as_sold' },
  unitEvidence: {
    manufacturerServing: null,
    productQuantity: null,
    provenSmallestUnit: null,
    defaultUnitKind: 'mass'
  },
  imageReference: null,
  hasQualityErrors: false,
  rankOrdinal: 1
};

const hit: CatalogSearchHit = { ...product, resultIndex: 0 };

describe('catalog-native search state', () => {
  it('moves atomically from search to visible SQLite candidates', () => {
    let state = catalogSearchReducer(createCatalogSearchState(), { type: 'start', query: 'Bueno' });
    state = catalogSearchReducer(state, { type: 'show-choice', query: 'Bueno', candidates: [hit] });
    expect(state).toMatchObject({
      phase: 'needs_product_choice',
      query: 'Bueno',
      candidates: [{ resultIndex: 0 }],
      selectedProduct: null,
      requestStartedAt: null
    });
  });

  it('resolves only with a concrete catalog product', () => {
    const state = catalogSearchReducer(createCatalogSearchState(), {
      type: 'resolve',
      query: '4008400322728',
      product
    });
    expect(state.phase).toBe('resolved');
    expect(state.selectedProduct?.code).toBe('4008400322728');
  });

  it('keeps validation failures local and resettable', () => {
    const invalid = catalogSearchReducer(createCatalogSearchState(), {
      type: 'validation',
      message: 'Bitte Produktname oder Barcode eingeben.'
    });
    expect(invalid).toMatchObject({ phase: 'idle', validationMessage: expect.any(String) });
    expect(catalogSearchReducer(invalid, { type: 'reset' })).toEqual(createCatalogSearchState());
  });
});
