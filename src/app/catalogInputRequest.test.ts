import { describe, expect, it } from 'vitest';
import type { CatalogProduct } from '../lib/catalog/catalogDomain';
import type { ClinicCatalogProduct } from '../lib/clinicCatalog';
import { genericCookedProductForQuery } from '../lib/genericFoods';
import type { ParsedCatalogQuery } from './queryParser';
import {
  requestForCatalogVariant,
  requestForInitialCatalogProduct,
  requestFromParsedCatalogInput
} from './catalogInputRequest';

function product(overrides: Partial<CatalogProduct> = {}): CatalogProduct {
  return {
    productId: 1,
    code: '20005627',
    displayName: 'Salzstangen',
    brand: 'Snack Day',
    nutrition: { carbohydratesPer100: 72, basis: 'mass', source: 'as_sold' },
    unitEvidence: {
      manufacturerServing: null,
      productQuantity: { baseValue: 250, basis: 'mass' },
      provenSmallestUnit: null,
      defaultUnitKind: 'mass'
    },
    imageReference: null,
    hasQualityErrors: false,
    rankOrdinal: 1,
    ...overrides
  };
}

function parsed(overrides: Partial<ParsedCatalogQuery> = {}): ParsedCatalogQuery {
  return {
    raw: '24 Salzstangen',
    catalogQuery: 'Salzstangen',
    barcode: null,
    amount: 24,
    amountExplicit: true,
    unit: 'g',
    unitExplicit: false,
    ...overrides
  };
}

function clinicProduct(): ClinicCatalogProduct {
  return {
    ...product({
      productId: -2_000_001,
      code: 'clinic:test',
      displayName: 'Klinikprodukt',
      nutrition: { carbohydratesPer100: 25, basis: 'mass', source: 'prepared' },
      unitEvidence: {
        manufacturerServing: null,
        productQuantity: null,
        provenSmallestUnit: null,
        defaultUnitKind: 'mass'
      }
    }),
    clinic: {
      source: 'klinikum-leverkusen',
      categoryId: 'test',
      referenceAmount: 100,
      referenceUnit: 'g',
      directCarbohydratesPerUnit: null,
      valueStatus: 'numeric',
      reviewRequired: false
    }
  };
}

describe('catalog input request SSOT', () => {
  it('preserves a recognized amount exactly', () => {
    expect(requestFromParsedCatalogInput(parsed())).toEqual({
      amount: 24,
      unit: 'g',
      unitExplicit: false
    });
  });

  it('never replaces an explicit amount during product-specific defaulting', () => {
    const generic = genericCookedProductForQuery('Nudeln');
    if (!generic) throw new Error('generic noodles expected');

    expect(requestForInitialCatalogProduct(parsed(), product()).amount).toBe(24);
    expect(requestForInitialCatalogProduct(parsed(), generic, 'smart')).toEqual({
      amount: 24,
      unit: 'g',
      unitExplicit: false
    });
    expect(requestForInitialCatalogProduct(parsed(), clinicProduct())).toEqual({
      amount: 24,
      unit: 'g',
      unitExplicit: false
    });
  });

  it('applies generic and clinic defaults only to a bare product name', () => {
    const bare = parsed({
      raw: 'Nudeln',
      catalogQuery: 'Nudeln',
      amount: 1,
      amountExplicit: false,
      unitExplicit: false
    });
    const generic = genericCookedProductForQuery('Nudeln');
    if (!generic) throw new Error('generic noodles expected');

    expect(requestForInitialCatalogProduct(bare, generic, 'smart')).toEqual({
      amount: 200,
      unit: 'g',
      unitExplicit: true
    });
    expect(requestForInitialCatalogProduct(bare, clinicProduct())).toEqual({
      amount: 100,
      unit: 'g',
      unitExplicit: false
    });
  });

  it('keeps amount as SSOT when selecting another product variant', () => {
    expect(requestForCatalogVariant(
      { amount: 24, unit: 'g', unitExplicit: false },
      product({ nutrition: { carbohydratesPer100: 8, basis: 'volume', source: 'as_sold' } })
    )).toEqual({ amount: 24, unit: 'ml', unitExplicit: false });
  });

  it('preserves an explicit user unit during variant selection', () => {
    const request = { amount: 24, unit: 'piece' as const, unitExplicit: true };
    expect(requestForCatalogVariant(request, product())).toBe(request);
  });
});
