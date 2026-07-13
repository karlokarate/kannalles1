import { describe, expect, it } from 'vitest';
import {
  catalogCalibrationLookupKeys,
  createCatalogCalibration,
  deriveCatalogCalibration,
  deriveGroupCalibration,
  normalizeCatalogCalibration,
  selectCatalogCalibration,
  toMatchingUnitCalibration
} from './catalogCalibration';
import type {
  CatalogCalibrationIdentity,
  CatalogUnitCalibration
} from './catalogCalibration';

const identity: CatalogCalibrationIdentity = {
  catalogProductId: '1234',
  barcode: '4008400321622',
  canonicalName: 'Kinder Bueno',
  brandCanonical: 'Kinder',
  genericFoodKey: 'schokoriegel'
};

function record(overrides: Partial<CatalogUnitCalibration> = {}): CatalogUnitCalibration {
  const created = createCatalogCalibration({
    calibrationId: 'base',
    scope: 'catalog-product',
    identity,
    unit: 'bar',
    measuredCount: 8,
    measuredTotalWeightG: 172,
    smallestEdibleUnit: true,
    now: '2026-07-13T12:00:00.000Z'
  });
  if (!created) throw new Error('test calibration could not be created');
  return { ...created, ...overrides };
}

describe('catalog calibration derivation', () => {
  it('derives group weight and current carbohydrate totals without rounding', () => {
    const result = deriveGroupCalibration(10, 24, 12, 72);
    expect(result).toEqual({
      measuredCount: 10,
      measuredTotalWeightG: 24,
      unitWeightG: 2.4,
      carbsPerUnitG: 1.728,
      requestedAmount: 12,
      requestedTotalWeightG: 28.8,
      requestedTotalCarbsG: 20.736
    });
  });

  it('supports single-unit measurement only through the single-unit derivation', () => {
    expect(deriveGroupCalibration(1, 21.5, 2, 50)).toBeNull();
    expect(deriveCatalogCalibration(1, 21.5, 2, 50)).toMatchObject({
      unitWeightG: 21.5,
      requestedTotalWeightG: 43,
      requestedTotalCarbsG: 21.5
    });
  });

  it('returns null carbohydrate previews when current nutrition is unavailable', () => {
    expect(deriveGroupCalibration(10, 24, 12, null)).toMatchObject({
      unitWeightG: 2.4,
      carbsPerUnitG: null,
      requestedTotalCarbsG: null
    });
  });
});

describe('catalog calibration identity and persistence', () => {
  it('builds strict same-unit lookup keys from strongest to explicitly allowed generic scope', () => {
    expect(catalogCalibrationLookupKeys(identity, 'bar', true)).toEqual([
      'catalog:1234|bar',
      'barcode:4008400321622|bar',
      'exact:kinder-bueno|kinder|bar',
      'generic:schokoriegel|bar'
    ]);
    expect(catalogCalibrationLookupKeys(identity, 'piece', false)).toEqual([
      'catalog:1234|piece',
      'barcode:4008400321622|piece',
      'exact:kinder-bueno|kinder|piece'
    ]);
  });

  it('persists measurement provenance without a carbohydrate snapshot', () => {
    const calibration = record();
    expect(calibration.schemaVersion).toBe(3);
    expect(calibration.measurement).toEqual({
      mode: 'group-weighing',
      measuredCount: 8,
      measuredTotalWeightG: 172
    });
    expect(calibration.derivedUnitWeightG).toBe(21.5);
    expect(calibration).not.toHaveProperty('nutritionSnapshot');
    expect(calibration).not.toHaveProperty('derivedCarbsPerUnitG');
  });

  it('rejects legacy calibration records instead of silently migrating them', () => {
    expect(normalizeCatalogCalibration({
      schemaVersion: 2,
      calibrationId: 'legacy',
      derivedUnitWeightG: 21.5
    })).toBeNull();
  });

  it('recomputes the unit weight from measurement evidence during normalization', () => {
    const normalized = normalizeCatalogCalibration({
      ...record(),
      derivedUnitWeightG: 999,
      scopeKey: 'tampered'
    });
    expect(normalized?.derivedUnitWeightG).toBe(21.5);
    expect(normalized?.scopeKey).toBe('catalog:1234|bar');
  });

  it('never labels a generic portion as the smallest edible unit', () => {
    const calibration = createCatalogCalibration({
      calibrationId: 'portion',
      scope: 'catalog-product',
      identity,
      unit: 'portion',
      measuredCount: 1,
      measuredTotalWeightG: 30,
      smallestEdibleUnit: true,
      now: '2026-07-13T12:00:00.000Z'
    });
    expect(calibration?.smallestEdibleUnit).toBe(false);
  });
});

describe('catalog calibration selection', () => {
  it('selects by scope, measured sample size and recency', () => {
    const catalogSpecific = record();
    const barcode = record({
      calibrationId: 'barcode',
      scope: 'barcode',
      scopeKey: 'barcode:4008400321622|bar',
      measurement: { mode: 'group-weighing', measuredCount: 20, measuredTotalWeightG: 430 },
      updatedAt: '2026-07-14T12:00:00.000Z'
    });
    const largerOlder = record({
      calibrationId: 'larger-older',
      measurement: { mode: 'group-weighing', measuredCount: 12, measuredTotalWeightG: 258 },
      updatedAt: '2026-07-12T12:00:00.000Z'
    });
    const smallerNewer = record({
      calibrationId: 'smaller-newer',
      measurement: { mode: 'group-weighing', measuredCount: 9, measuredTotalWeightG: 193.5 },
      updatedAt: '2026-07-14T12:00:00.000Z'
    });

    expect(selectCatalogCalibration([barcode, catalogSpecific])?.calibrationId).toBe('base');
    expect(selectCatalogCalibration([largerOlder, smallerNewer])?.calibrationId).toBe('larger-older');
  });

  it('adapts only measured evidence into the resolver input', () => {
    expect(toMatchingUnitCalibration(record())).toEqual({
      calibrationId: 'base',
      scope: 'catalog-product',
      unit: 'bar',
      measuredCount: 8,
      measuredTotalWeightG: 172,
      updatedAt: '2026-07-13T12:00:00.000Z',
      active: true
    });
  });
});
