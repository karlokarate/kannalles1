import { describe, expect, it } from 'vitest';
import {
  calibrationLookupKeys,
  chooseDefaultUnitOption,
  deriveGroupCalibration,
  selectCalibration
} from '../reference/core-algorithms';
import type { PieceCalibrationV2, UnitOptionV2 } from '../reference/target-types';

describe('KH Checker core contracts', () => {
  it('derives a deterministic unit weight and carbohydrate amount from group weighing', () => {
    const result = deriveGroupCalibration(10, 24, 12, 72);
    expect(result.unitWeightG).toBeCloseTo(2.4, 10);
    expect(result.carbsPerUnitG).toBeCloseTo(1.728, 10);
    expect(result.requestedTotalWeightG).toBeCloseTo(28.8, 10);
    expect(result.requestedTotalCarbsG).toBeCloseTo(20.736, 10);
  });

  it('prefers a proven smallest edible unit before the package', () => {
    const options: UnitOptionV2[] = [
      {
        id: 'package', unit: 'package', label: 'Packung',
        unitWeightG: 43, source: 'package', confidence: 'high',
        recommended: false, smallestEdibleUnit: false, priority: 90
      },
      {
        id: 'bar', unit: 'bar', label: 'Riegel',
        unitWeightG: 21.5, source: 'explicit-multipack', confidence: 'high',
        recommended: true, smallestEdibleUnit: true, priority: 40
      }
    ];
    expect(chooseDefaultUnitOption(options, 'portion', false, 'countable')?.id).toBe('bar');
  });

  it('does not silently replace an explicit piece request', () => {
    const options: UnitOptionV2[] = [
      {
        id: 'portion', unit: 'portion', label: 'Portion',
        unitWeightG: 30, source: 'manufacturer-serving', confidence: 'medium',
        recommended: false, smallestEdibleUnit: false, priority: 80
      }
    ];
    expect(chooseDefaultUnitOption(options, 'piece', true, 'countable')).toBeNull();
  });

  it('builds calibration lookup keys from most to least specific', () => {
    expect(calibrationLookupKeys({
      canonicalName: 'salzstangen',
      brandCanonical: 'snack-day',
      barcode: '12345678',
      unit: 'piece',
      allowGenericScope: true
    })).toEqual([
      'barcode:12345678|piece',
      'exact:salzstangen|snack-day|piece',
      'generic:salzstangen|piece'
    ]);
  });

  it('selects the most specific and best measured calibration', () => {
    const base = {
      schemaVersion: 2 as const,
      calibrationId: '',
      scopeKey: '',
      product: {
        canonicalName: 'salzstangen',
        displayName: 'Salzstangen',
        brandCanonical: null,
        barcode: null
      },
      unit: { kind: 'piece' as const, label: 'Stück', smallestEdibleUnit: true },
      measurement: {
        mode: 'group_weighing' as const,
        measuredCount: 10,
        measuredTotalWeightG: 24
      },
      derivedUnitWeightG: 2.4,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
      active: true
    };

    const records: PieceCalibrationV2[] = [
      { ...base, calibrationId: 'generic', scope: 'generic_food', scopeKey: 'generic:salzstangen|piece' },
      {
        ...base,
        calibrationId: 'barcode',
        scope: 'barcode',
        scopeKey: 'barcode:12345678|piece',
        product: { ...base.product, barcode: '12345678' },
        measurement: { ...base.measurement, measuredCount: 5, measuredTotalWeightG: 12 }
      }
    ];
    expect(selectCalibration(records)?.calibrationId).toBe('barcode');
  });
});
