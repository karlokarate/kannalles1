import { describe, expect, it } from 'vitest';
import type { PieceCalibration } from '../types';
import {
  calibrationLookupKeys,
  createPieceCalibration,
  deriveGroupCalibration,
  normalizeStoredCalibration,
  selectCalibration
} from './calibration';
import { buildExactResult } from './resolver';

function calibration(overrides: Partial<PieceCalibration> = {}): PieceCalibration {
  const base = createPieceCalibration({
    productName: 'Kinder Bueno',
    displayName: 'Kinder Bueno',
    brand: 'Kinder',
    barcode: '8000500037560',
    unit: 'bar',
    measuredCount: 2,
    measuredTotalWeightG: 43,
    carbohydratesPer100g: 49.5,
    now: '2026-07-10T10:00:00.000Z'
  });
  if (!base) throw new Error('test calibration could not be created');
  return { ...base, ...overrides };
}

describe('calibration contract v2', () => {
  it('derives group weight and both carbohydrate totals without early rounding', () => {
    const result = deriveGroupCalibration(10, 24, 12, 72);
    expect(result).not.toBeNull();
    expect(result?.measuredCount).toBe(10);
    expect(result?.measuredTotalWeightG).toBe(24);
    expect(result?.unitWeightG).toBeCloseTo(2.4, 12);
    expect(result?.carbsPerUnitG).toBeCloseTo(1.728, 12);
    expect(result?.requestedTotalWeightG).toBeCloseTo(28.8, 12);
    expect(result?.requestedTotalCarbsG).toBeCloseTo(20.736, 12);
  });

  it('rejects non-integer group counts instead of silently truncating them', () => {
    expect(createPieceCalibration({
      productName: 'Salzstangen',
      unit: 'piece',
      measuredCount: 2.5,
      measuredTotalWeightG: 6
    })).toBeNull();
  });

  it('rejects excessive counts, weights and requested derived totals before persistence', () => {
    const base = { productName: 'Test', unit: 'piece' as const };
    expect(createPieceCalibration({ ...base, measuredCount: 10_001, measuredTotalWeightG: 10_001 })).toBeNull();
    expect(createPieceCalibration({ ...base, measuredCount: 1, measuredTotalWeightG: 5_001 })).toBeNull();
    expect(createPieceCalibration({ ...base, measuredCount: 100, measuredTotalWeightG: 100_001 })).toBeNull();
    expect(deriveGroupCalibration(2, 10_000, 100, 50)).toBeNull();
  });

  it('looks up barcode, exact product and explicitly-authorized generic scopes in order', () => {
    expect(calibrationLookupKeys({
      productName: 'Salzstangen Classic',
      brand: 'Testmarke',
      barcode: '12345678',
      unit: 'piece',
      allowGenericScope: true
    })).toEqual([
      'barcode:12345678|piece',
      'exact:salzstangen-classic|testmarke|piece',
      'generic:salzstangen-classic|piece'
    ]);
    expect(calibrationLookupKeys({
      productName: 'Salzstangen Classic',
      brand: 'Testmarke',
      barcode: '12345678',
      unit: 'package',
      allowGenericScope: true
    })).toEqual([]);
  });

  it('uses the same OFF barcode normalization for UPC-E and short UPC identities', () => {
    expect(calibrationLookupKeys({
      productName: 'Test', barcode: '1234567', unit: 'piece', allowGenericScope: false
    })[0]).toBe('barcode:01234567|piece');
    expect(calibrationLookupKeys({
      productName: 'Test', barcode: '123456789', unit: 'piece', allowGenericScope: false
    })[0]).toBe('barcode:0000123456789|piece');
    expect(calibrationLookupKeys({
      productName: 'Test', barcode: '000123456', unit: 'piece', allowGenericScope: false
    })[0]).toBe('barcode:00123456|piece');
  });

  it('resolves conflicts by scope, measured count, then recency', () => {
    const barcode = calibration();
    const exact = calibration({
      calibrationId: 'exact',
      scope: 'exact_product',
      scopeKey: 'exact:kinder-bueno|kinder|bar',
      measurement: { mode: 'group_weighing', measuredCount: 20, measuredTotalWeightG: 430 },
      updatedAt: '2026-07-11T10:00:00.000Z'
    });
    const olderLargeSample = calibration({
      calibrationId: 'older-large',
      measurement: { mode: 'group_weighing', measuredCount: 10, measuredTotalWeightG: 215 },
      updatedAt: '2026-07-09T10:00:00.000Z'
    });
    const newerSmallSample = calibration({
      calibrationId: 'newer-small',
      measurement: { mode: 'group_weighing', measuredCount: 3, measuredTotalWeightG: 64.5 },
      updatedAt: '2026-07-11T10:00:00.000Z'
    });

    expect(selectCalibration([exact, barcode])?.calibrationId).toBe(barcode.calibrationId);
    expect(selectCalibration([exact, newerSmallSample, olderLargeSample])?.calibrationId).toBe('older-large');
    expect(selectCalibration([exact, newerSmallSample])?.calibrationId).toBe('newer-small');
  });

  it('rebuilds a v2 scope key from normalized product identity and rejects package reuse', () => {
    const calibration = createPieceCalibration({
      productName: 'Salzstangen',
      brand: 'Snack Day',
      barcode: '12345678',
      unit: 'piece',
      measuredCount: 10,
      measuredTotalWeightG: 24,
      now: '2026-07-11T00:00:00.000Z'
    });
    expect(calibration).not.toBeNull();

    const normalized = normalizeStoredCalibration({
      ...calibration,
      scopeKey: 'generic:tampered|package',
      product: { ...calibration?.product, canonicalName: ' Salzstangen ' }
    });
    expect(normalized?.scopeKey).toBe('barcode:12345678|piece');
    expect(calibrationLookupKeys({
      productName: 'Salzstangen',
      brand: 'Snack Day',
      barcode: '12345678',
      unit: 'package',
      allowGenericScope: true
    })).toEqual([]);
  });

  it('recomputes derived v2 values from the immutable measurement evidence', () => {
    const stored = calibration({
      derivedUnitWeightG: 1,
      nutritionSnapshot: { carbohydratesPer100g: 50, derivedCarbsPerUnitG: 999 }
    });
    const normalized = normalizeStoredCalibration(stored);
    expect(normalized?.derivedUnitWeightG).toBe(21.5);
    expect(normalized?.nutritionSnapshot?.derivedCarbsPerUnitG).toBe(10.75);
  });

  it('migrates legacy measurements while preserving their proven unit weight', () => {
    const migrated = normalizeStoredCalibration({
      key: '12345678|piece',
      productName: 'Salzstangen',
      barcode: '12345678',
      unit: 'piece',
      weightG: 2.4,
      measuredPieces: 10,
      measuredTotalWeightG: 24,
      updatedAt: '2026-07-01T12:00:00.000Z'
    });
    expect(migrated?.schemaVersion).toBe(2);
    expect(migrated?.scope).toBe('barcode');
    expect(migrated?.derivedUnitWeightG).toBe(2.4);
    expect(migrated?.measurement).toEqual({
      mode: 'group_weighing',
      measuredCount: 10,
      measuredTotalWeightG: 24
    });
  });

  it('reuses only the saved weight and recomputes carbohydrates from current nutrition', () => {
    const saved = calibration();
    const result = buildExactResult(
      {
        status: 'parsed',
        rawInput: '1 Riegel Kinder Bueno',
        product: { name: 'Kinder Bueno', brand: 'Kinder', variant: null },
        amount: { value: 1, unit: 'bar', valueExplicit: true, unitExplicit: true },
        resolutionMode: 'exact_product',
        barcode: null,
        clarificationQuestion: null,
        parser: 'local'
      },
      {
        code: '8000500037560',
        product_name_de: 'Kinder Bueno',
        brands: 'Kinder',
        nutriments: { carbohydrates_100g: 50 }
      },
      undefined,
      saved
    );

    expect(result.portionOptions[0]?.source).toBe('user-calibration');
    expect(result.unitWeightG).toBe(21.5);
    expect(result.carbohydratesG).toBe(10.75);
  });
});
