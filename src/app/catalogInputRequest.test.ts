import { describe, expect, it } from 'vitest';
import type { CatalogProduct } from '../lib/catalog/catalogDomain';
import type { CatalogInputIntent } from '../lib/input/catalogInput';
import { genericCookedProductForQuery } from '../lib/genericFoods';
import { searchClinicCatalog } from '../lib/clinicCatalog';
import { catalogRequestForInput } from './catalogInputRequest';

function input(overrides: Partial<CatalogInputIntent> = {}): CatalogInputIntent {
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

function product(overrides: Partial<CatalogProduct> = {}): CatalogProduct {
  return {
    productId: 1,
    code: '20005627',
    displayName: 'Salzstangen',
    brand: 'Snack Day',
    nutrition: { carbohydratesPer100: 75, basis: 'mass', source: 'as_sold' },
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

describe('catalogRequestForInput', () => {
  it('preserves a recognized amount across every selected product variant', () => {
    const recognized = input();
    const first = catalogRequestForInput(recognized, product());
    const favorite = catalogRequestForInput(recognized, product({ productId: 2, code: 'favorite', brand: 'Favorit' }));
    const variant = catalogRequestForInput(recognized, product({ productId: 3, code: 'variant', brand: 'Andere Variante' }));

    expect(first).toEqual({ amount: 24, unit: 'g', unitExplicit: false });
    expect(favorite).toEqual(first);
    expect(variant).toEqual(first);
  });

  it('preserves explicit mass and counted units without product defaults', () => {
    expect(catalogRequestForInput(input({ amount: 24, unit: 'g', unitExplicit: true }), product()))
      .toEqual({ amount: 24, unit: 'g', unitExplicit: true });
    expect(catalogRequestForInput(input({ amount: 24, unit: 'piece', unitExplicit: true }), product()))
      .toEqual({ amount: 24, unit: 'piece', unitExplicit: true });
  });

  it('uses the configured generic default only for a completely implicit input', () => {
    const noodles = genericCookedProductForQuery('Nudeln');
    if (!noodles) throw new Error('generic noodles expected');

    expect(catalogRequestForInput(input({
      raw: 'Nudeln',
      catalogQuery: 'Nudeln',
      amount: 1,
      amountExplicit: false,
      unitExplicit: false
    }), noodles)).toEqual({ amount: 200, unit: 'g', unitExplicit: true });

    expect(catalogRequestForInput(input({
      raw: '24 Nudeln',
      catalogQuery: 'Nudeln',
      amount: 24,
      amountExplicit: true,
      unitExplicit: false
    }), noodles)).toEqual({ amount: 24, unit: 'g', unitExplicit: false });
  });

  it('uses an institutional clinic default only when amount and unit are implicit', () => {
    const clinic = searchClinicCatalog('Pfannkuchen mit Quark', 1)[0];
    if (!clinic) throw new Error('clinic product expected');

    const implicit = catalogRequestForInput(input({
      raw: 'Pfannkuchen mit Quark',
      catalogQuery: 'Pfannkuchen mit Quark',
      amount: 1,
      amountExplicit: false,
      unitExplicit: false
    }), clinic);
    expect(implicit).toMatchObject({ amount: 1, unit: 'piece', unitExplicit: false });

    const explicit = catalogRequestForInput(input({
      raw: '2 Pfannkuchen mit Quark',
      catalogQuery: 'Pfannkuchen mit Quark',
      amount: 2,
      amountExplicit: true,
      unitExplicit: false
    }), clinic);
    expect(explicit).toEqual({ amount: 2, unit: 'g', unitExplicit: false });
  });

  it('normalizes kilograms once before any product-specific decision', () => {
    expect(catalogRequestForInput(input({
      raw: '0,5 kg Salzstangen',
      amount: 0.5,
      unit: 'kg',
      unitExplicit: true
    }), product())).toEqual({ amount: 500, unit: 'g', unitExplicit: true });
  });
});
