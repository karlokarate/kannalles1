import { describe, expect, it } from 'vitest';
import type { CatalogProduct, CatalogSearchHit } from './catalog/catalogDomain';
import type { CatalogInputIntent } from './input/catalogInput';
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
const input: CatalogInputIntent = {
  raw: '24 Salzstangen',
  catalogQuery: 'Salzstangen',
  barcode: null,
  amount: 24,
  amountExplicit: true,
  unit: 'g',
  unitExplicit: false
};

describe('catalog-native search state', () => {
  it('moves atomically from recognized input to visible SQLite candidates', () => {
    let state = catalogSearchReducer(createCatalogSearchState(), {
      type: 'start',
      query: input.catalogQuery,
      input
    });
    state = catalogSearchReducer(state, {
      type: 'show-choice',
      query: input.catalogQuery,
      candidates: [hit]
    });
    expect(state).toMatchObject({
      phase: 'needs_product_choice',
      query: 'Salzstangen',
      input: { amount: 24, amountExplicit: true },
      candidates: [{ resultIndex: 0 }],
      selectedProduct: null,
      requestStartedAt: null
    });
  });

  it('requires every product resolution to declare its input intent', () => {
    const resolved = catalogSearchReducer(createCatalogSearchState(), {
      type: 'resolve',
      query: input.catalogQuery,
      product,
      input
    });
    expect(resolved).toMatchObject({
      phase: 'resolved',
      input: { raw: '24 Salzstangen', amount: 24 },
      selectedProduct: { code: '4008400322728' }
    });

    const programmatic = catalogSearchReducer(resolved, {
      type: 'resolve',
      query: product.displayName,
      product,
      input: null
    });
    expect(programmatic.input).toBeNull();
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
