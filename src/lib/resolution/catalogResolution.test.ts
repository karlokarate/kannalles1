import { describe, expect, it } from 'vitest';
import {
  calculateCatalogCarbohydrates,
  catalogProductEligibility,
  filterEligibleCatalogProducts,
  resolveCatalogUnits
} from './catalogResolution';
import type {
  CatalogResolutionProduct,
  CatalogUnitRequest,
  MatchingUnitCalibration
} from './catalogResolution';

function bueno(overrides: Partial<CatalogResolutionProduct> = {}): CatalogResolutionProduct {
  return {
    id: '4008400321622',
    displayName: 'Kinder Bueno',
    brand: 'Kinder',
    carbohydratesPer100: 49.5,
    carbohydrateBasis: 'mass',
    defaultUnitKind: 'bar',
    manufacturerServing: { baseValue: 43, basis: 'mass' },
    productQuantity: { baseValue: 172, basis: 'mass' },
    unitEvidence: {
      unitKind: 'bar',
      baseValue: 21.5,
      basis: 'mass',
      source: 'explicit-multipack-quantity'
    },
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
  it('preserves the SQLite result order while removing only ineligible rows', () => {
    const first = bueno({ id: 'first' });
    const invalid = bueno({ id: 'invalid', carbohydratesPer100: 101 });
    const third = bueno({ id: 'third' });
    expect(filterEligibleCatalogProducts([first, invalid, third]).map((item) => item.id)).toEqual([
      'first',
      'third'
    ]);
  });

  it('keeps quality flags diagnostic and ignores invalid optional evidence', () => {
    const product = bueno({
      hasQualityErrors: true,
      unitEvidence: {
        unitKind: 'bar',
        baseValue: 6_000,
        basis: 'mass',
        source: 'explicit-multipack-quantity'
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
      source: 'catalog-explicit-multipack',
      recommended: true,
      smallestEdibleUnit: true
    });
    expect(resolution.options.some((option) => option.unit === 'portion')).toBe(true);
    expect(resolution.options.some((option) => option.unit === 'package')).toBe(true);
    expect(resolution.options.some((option) => option.unit === 'g')).toBe(true);
  });

  it('preserves an explicit bar and never converts a 43 g serving into one bar', () => {
    const product = bueno({ unitEvidence: null, productQuantity: { baseValue: 43, basis: 'mass' } });
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
    const product = bueno({ unitEvidence: null });
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
    const product = bueno({ carbohydratesPer100: 50 });
    const resolution = resolveCatalogUnits(product, request('portion', false), [calibration]);
    expect(resolution.options[0]).toMatchObject({
      source: 'user-calibration',
      unit: 'bar',
      baseValue: 21
    });
    const calculation = calculateCatalogCarbohydrates(product, request('portion', false), resolution);
    expect(calculation.carbohydratesG).toBe(10.5);
    expect(calculation.provenance.source).toBe('user-calibration');
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
    const product = bueno({ unitEvidence: null });
    const resolution = resolveCatalogUnits(product, request('bar', true), [pieceCalibration]);
    expect(resolution.status).toBe('needs_unit_calibration');
    expect(resolution.options[0]).toMatchObject({ unit: 'bar', source: 'unresolved' });
  });

  it('uses a manufacturer serving only as a portion', () => {
    const spread = bueno({
      id: 'nutella',
      displayName: 'Nutella',
      defaultUnitKind: 'portion',
      unitEvidence: null,
      manufacturerServing: { baseValue: 15, basis: 'mass' },
      productQuantity: { baseValue: 450, basis: 'mass' }
    });
    const resolution = resolveCatalogUnits(spread, request('portion', true));
    expect(resolution.options[0]).toMatchObject({
      unit: 'portion',
      baseValue: 15,
      source: 'manufacturer-serving'
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
      id: 'drink',
      displayName: 'Testgetränk',
      carbohydrateBasis: 'volume',
      carbohydratesPer100: 12,
      defaultUnitKind: 'volume',
      unitEvidence: null,
      manufacturerServing: { baseValue: 250, basis: 'volume' },
      productQuantity: { baseValue: 750, basis: 'volume' }
    });
    const resolution = resolveCatalogUnits(drink, request('ml', true, 250), [calibration]);
    expect(resolution.options.some((option) => option.source === 'user-calibration')).toBe(false);
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
    expect(() => calculateCatalogCarbohydrates(product, request('bar', true, 0), resolution)).toThrow(
      RangeError
    );
  });
});
