import { describe, expect, it } from 'vitest';
import type { CatalogProduct } from '../lib/catalog/catalogDomain';
import {
  catalogCalibrationIdentity,
  normalizeCatalogUnitRequest,
  resolveCatalogUnitRuntime
} from './catalogUnitRuntime';

function product(overrides: Partial<CatalogProduct> = {}): CatalogProduct {
  return {
    productId: 1,
    code: '4008400322728',
    displayName: 'Testprodukt',
    brand: 'Testmarke',
    nutrition: { carbohydratesPer100: 50, basis: 'mass', source: 'as_sold' },
    unitEvidence: {
      manufacturerServing: null,
      productQuantity: null,
      provenSmallestUnit: null,
      defaultUnitKind: 'mass'
    },
    imageReference: null,
    hasQualityErrors: false,
    rankOrdinal: 0,
    ...overrides
  };
}

describe('catalog unit runtime', () => {
  it('normalizes kilograms without changing explicit counted units', () => {
    expect(normalizeCatalogUnitRequest({ amount: 1.5, unit: 'kg', unitExplicit: true }))
      .toEqual({ amount: 1_500, unit: 'g', unitExplicit: true });
    const piece = { amount: 0.5, unit: 'piece' as const, unitExplicit: true };
    expect(normalizeCatalogUnitRequest(piece)).toBe(piece);
  });

  it('adds generic calibration identity only in smart mode', () => {
    const generic = product({ productId: -1, code: 'generic:pasta-cooked' });
    expect(catalogCalibrationIdentity(generic).genericFoodKey).toBeNull();
    expect(catalogCalibrationIdentity(generic, 'smart').genericFoodKey).toBe('pasta-cooked');
  });

  it('keeps manufacturer evidence authoritative in both controller modes', () => {
    const serving = product({
      unitEvidence: {
        manufacturerServing: { baseValue: 15, basis: 'mass' },
        productQuantity: { baseValue: 450, basis: 'mass' },
        provenSmallestUnit: null,
        defaultUnitKind: 'portion'
      }
    });
    const request = { amount: 1, unit: 'g' as const, unitExplicit: false };
    const standard = resolveCatalogUnitRuntime(serving, request);
    const smart = resolveCatalogUnitRuntime(serving, request, 'smart');

    expect(standard.resolution.options.find((option) => option.recommended)).toMatchObject({
      unit: 'portion',
      baseValue: 15,
      source: 'manufacturer_serving'
    });
    expect(smart.resolution.selectedOptionId).toBe(standard.resolution.selectedOptionId);
    expect(smart.prompt).toBeNull();
  });
});
