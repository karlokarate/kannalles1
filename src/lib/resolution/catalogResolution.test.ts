import { describe, expect, it } from 'vitest';
import type { CatalogProduct } from '../catalog/catalogDomain';
import {
  calculateCatalogCarbohydrates,
  catalogProductEligibility,
  filterEligibleCatalogProducts,
  resolveCatalogUnits
} from './catalogResolution';
import type {
  CatalogUnitRequest,
  MatchingUnitCalibration
} from './catalogResolution';

function bueno(overrides: Partial<CatalogProduct> = {}): CatalogProduct {
  return {
    productId: 4008400321622,
    code: '4008400321622',
    displayName: 'Kinder Bueno',
    brand: 'Kinder',
    nutrition: {
      carbohydratesPer100: 49.5,
      basis: 'mass',
      source: 'as_sold'
    },
    unitEvidence: {
      manufacturerServing: { baseValue: 43, basis: 'mass' },
      productQuantity: { baseValue: 172, basis: 'mass' },
      provenSmallestUnit: {
        unitKind: 'bar',
        baseValue: 21.5,
        basis: 'mass',
        source: 'explicit_multipack_quantity',
        smallestEdibleUnit: true
      },
      defaultUnitKind: 'bar'
    },
    imageReference: null,
    hasQualityErrors: false,
    rankOrdinal: 1,
    ...overrides
  };
}

function request(
  unit: CatalogUnitRequest['unit'],
  unitExplicit: boolean,
  amount = 1
): CatalogUnitRequest {
  return { unit, unitExplicit, amount };
}

describe('catalog-native eligibility', () => {
  it('preserves SQLite result order while removing only ineligible rows', () => {
    const first = bueno({ productId: 1 });
    const invalid = bueno({
      productId: 2,
      nutrition: { carbohydratesPer100: 101, basis: 'mass', source: 'as_sold' }
    });
    const third = bueno({ productId: 3 });
    expect(filterEligibleCatalogProducts([first, invalid, third]).map((item) => item.productId)).toEqual([1, 3]);
  });

  it('keeps quality flags diagnostic and ignores invalid optional evidence', () => {
    const product = bueno({
      hasQualityErrors: true,
      unitEvidence: {
        ...bueno().unitEvidence,
        provenSmallestUnit: {
          unitKind: 'bar',
          baseValue: 6_000,
          basis: 'mass',
          source: 'explicit_multipack_quantity',
          smallestEdibleUnit: true
        }
      }
    });
    expect(catalogProductEligibility(product)).toEqual({
      eligible: true,
      errors: [],
      warnings: ['quality-errors-present', 'invalid-unit-evidence-ignored']
    });
  });
});

describe('structured catalog unit resolution', () => {
  it('selects the smallest proven bar before serving, package and mass options', () => {
    const resolution = resolveCatalogUnits(bueno(), request('portion', false));
    expect(resolution.status).toBe('resolved');
    expect(resolution.reason).toBe('smallest-proven-unit');
    expect(resolution.options[0]).toMatchObject({
      unit: 'bar',
      baseValue: 21.5,
      source: 'explicit_multipack_quantity',
      recommended: true,
      smallestEdibleUnit: true
    });
    expect(resolution.options.some((option) => option.unit === 'portion')).toBe(true);
    expect(resolution.options.some((option) => option.unit === 'package')).toBe(true);
    expect(resolution.options.some((option) => option.unit === 'g')).toBe(true);
  });

  it('keeps the smallest proven unit first when defaultUnitKind is portion', () => {
    const product = bueno({
      unitEvidence: { ...bueno().unitEvidence, defaultUnitKind: 'portion' }
    });
    expect(resolveCatalogUnits(product, request('portion', false)).options[0]).toMatchObject({
      unit: 'bar',
      source: 'explicit_multipack_quantity',
      recommended: true
    });
  });

  it('treats defaultUnitKind none as no implicit user option', () => {
    const product = bueno({
      unitEvidence: {
        manufacturerServing: null,
        productQuantity: null,
        provenSmallestUnit: null,
        defaultUnitKind: 'none'
      }
    });
    const resolution = resolveCatalogUnits(product, request('portion', false));
    expect(resolution.status).toBe('resolved');
    expect(resolution.options[0]).toMatchObject({ unit: 'g', source: 'direct_mass' });
    expect(resolution.options.every((option) => option.unit !== ('none' as never))).toBe(true);
  });

  it('preserves an explicit bar and never converts a 43 g serving into one bar', () => {
    const product = bueno({
      unitEvidence: {
        manufacturerServing: { baseValue: 43, basis: 'mass' },
        productQuantity: { baseValue: 43, basis: 'mass' },
        provenSmallestUnit: null,
        defaultUnitKind: 'bar'
      }
    });
    const resolution = resolveCatalogUnits(product, request('bar', true));
    expect(resolution.status).toBe('needs_unit_calibration');
    expect(resolution.reason).toBe('countable-weight-missing');
    expect(resolution.options[0]).toMatchObject({
      unit: 'bar',
      baseValue: null,
      source: 'unresolved',
      recommended: true
    });
    const calculation = calculateCatalogCarbohydrates(product, request('bar', true), resolution);
    expect(calculation.carbohydratesG).toBeNull();
    expect(calculation.totalMassG).toBeNull();
  });

  it('returns calibration-needed for an implicit countable default even when a serving exists', () => {
    const product = bueno({
      unitEvidence: { ...bueno().unitEvidence, provenSmallestUnit: null }
    });
    const resolution = resolveCatalogUnits(product, request('portion', false));
    expect(resolution.status).toBe('needs_unit_calibration');
    expect(resolution.options[0]).toMatchObject({ unit: 'bar', source: 'unresolved' });
  });

  it('uses matching user calibration before catalog evidence and recomputes from current nutrition', () => {
    const calibration: MatchingUnitCalibration = {
      calibrationId: 'personal-bueno',
      scope: 'catalog-product',
      unit: 'bar',
      measuredCount: 8,
      measuredTotalWeightG: 168,
      updatedAt: '2026-07-13T12:00:00.000Z',
      active: true
    };
    const product = bueno({
      nutrition: { carbohydratesPer100: 50, basis: 'mass', source: 'as_sold' }
    });
    const resolution = resolveCatalogUnits(product, request('portion', false), [calibration]);
    expect(resolution.options[0]).toMatchObject({
      source: 'user_calibration',
      unit: 'bar',
      baseValue: 21
    });
    const calculation = calculateCatalogCarbohydrates(product, request('portion', false), resolution);
    expect(calculation.carbohydratesG).toBe(10.5);
    expect(calculation.provenance.source).toBe('user_calibration');
  });

  it('selects calibrations independently per unit', () => {
    const piece: MatchingUnitCalibration = {
      calibrationId: 'piece-stronger',
      scope: 'catalog-product',
      unit: 'piece',
      measuredCount: 20,
      measuredTotalWeightG: 40,
      updatedAt: '2026-07-14T12:00:00.000Z',
      active: true
    };
    const bar: MatchingUnitCalibration = {
      calibrationId: 'bar-specific',
      scope: 'exact-product',
      unit: 'bar',
      measuredCount: 8,
      measuredTotalWeightG: 168,
      updatedAt: '2026-07-13T12:00:00.000Z',
      active: true
    };
    const product = bueno({
      unitEvidence: { ...bueno().unitEvidence, provenSmallestUnit: null }
    });
    const resolution = resolveCatalogUnits(product, request('bar', true), [piece, bar]);
    expect(resolution.options[0]).toMatchObject({ unit: 'bar', source: 'user_calibration', baseValue: 21 });
  });

  it('uses a personally calibrated portion as the next implicit default', () => {
    const portion: MatchingUnitCalibration = {
      calibrationId: 'personal-portion',
      scope: 'catalog-product',
      unit: 'portion',
      measuredCount: 10,
      measuredTotalWeightG: 300,
      updatedAt: '2026-07-13T12:00:00.000Z',
      active: true
    };
    const resolution = resolveCatalogUnits(bueno(), request('g', false), [portion]);
    expect(resolution.options[0]).toMatchObject({ unit: 'portion', source: 'user_calibration', baseValue: 30 });
    expect(resolution.reason).toBe('calibration-preferred');
  });

  it('does not reuse a different calibrated unit for an explicit request', () => {
    const pieceCalibration: MatchingUnitCalibration = {
      calibrationId: 'piece-only',
      scope: 'catalog-product',
      unit: 'piece',
      measuredCount: 10,
      measuredTotalWeightG: 24,
      updatedAt: '2026-07-13T12:00:00.000Z',
      active: true
    };
    const product = bueno({
      unitEvidence: { ...bueno().unitEvidence, provenSmallestUnit: null }
    });
    const resolution = resolveCatalogUnits(product, request('bar', true), [pieceCalibration]);
    expect(resolution.status).toBe('needs_unit_calibration');
    expect(resolution.options[0]).toMatchObject({ unit: 'bar', source: 'unresolved' });
  });

  it('uses a manufacturer serving only as a portion', () => {
    const product = bueno({
      productId: 99,
      code: 'nutella',
      displayName: 'Nutella',
      unitEvidence: {
        manufacturerServing: { baseValue: 15, basis: 'mass' },
        productQuantity: { baseValue: 450, basis: 'mass' },
        provenSmallestUnit: null,
        defaultUnitKind: 'portion'
      }
    });
    expect(resolveCatalogUnits(product, request('portion', true)).options[0]).toMatchObject({
      unit: 'portion',
      baseValue: 15,
      source: 'manufacturer_serving'
    });
  });

  it('keeps mass calibration out of a volume-based product', () => {
    const calibration: MatchingUnitCalibration = {
      calibrationId: 'invalid-density-assumption',
      scope: 'catalog-product',
      unit: 'piece',
      measuredCount: 2,
      measuredTotalWeightG: 20,
      updatedAt: '2026-07-13T12:00:00.000Z',
      active: true
    };
    const drink = bueno({
      productId: 100,
      code: 'drink',
      displayName: 'Testgetränk',
      nutrition: { carbohydratesPer100: 12, basis: 'volume', source: 'as_sold' },
      unitEvidence: {
        manufacturerServing: { baseValue: 250, basis: 'volume' },
        productQuantity: { baseValue: 750, basis: 'volume' },
        provenSmallestUnit: null,
        defaultUnitKind: 'volume'
      }
    });
    const resolution = resolveCatalogUnits(drink, request('ml', true, 250), [calibration]);
    expect(resolution.options.some((option) => option.source === 'user_calibration')).toBe(false);
    const calculation = calculateCatalogCarbohydrates(drink, request('ml', true, 250), resolution);
    expect(calculation.totalVolumeMl).toBe(250);
    expect(calculation.totalMassG).toBeNull();
    expect(calculation.carbohydratesG).toBe(30);
  });
});

describe('deterministic carbohydrate calculation', () => {
  it('retains full precision until display formatting', () => {
    const product = bueno();
    const input = request('bar', true, 3);
    const resolution = resolveCatalogUnits(product, input);
    const calculation = calculateCatalogCarbohydrates(product, input, resolution);
    expect(calculation.status).toBe('calculated');
    expect(calculation.totalMassG).toBe(64.5);
    expect(calculation.carbohydratesG).toBe(31.9275);
  });

  it('rejects invalid amounts instead of silently clamping them', () => {
    const product = bueno();
    const resolution = resolveCatalogUnits(product, request('bar', true));
    expect(() => calculateCatalogCarbohydrates(product, request('bar', true, 0), resolution)).toThrow(RangeError);
  });
});
