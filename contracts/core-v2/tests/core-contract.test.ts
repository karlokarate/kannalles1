import { describe, expect, it } from 'vitest';
import {
  calibrationLookupKeys,
  createPieceCalibration,
  deriveGroupCalibration,
  selectCalibration
} from '../../../src/lib/calibration';
import {
  createSearchWorkflowState,
  currentWorkflowIssue,
  searchWorkflowReducer
} from '../../../src/lib/searchState';
import type { PieceCalibration } from '../../../src/types';

describe('KH Checker core contracts', () => {
  it('derives a deterministic unit weight and carbohydrate amount from group weighing', () => {
    const result = deriveGroupCalibration(10, 24, 12, 72);
    expect(result).not.toBeNull();
    expect(result.unitWeightG).toBeCloseTo(2.4, 10);
    expect(result.carbsPerUnitG).toBeCloseTo(1.728, 10);
    expect(result.requestedTotalWeightG).toBeCloseTo(28.8, 10);
    expect(result.requestedTotalCarbsG).toBeCloseTo(20.736, 10);
  });

  it('never persists a package as a piece calibration', () => {
    expect(createPieceCalibration({
      productName: 'Kinder Bueno', unit: 'package', measuredCount: 1,
      measuredTotalWeightG: 43
    })).toBeNull();
  });

  it('builds calibration lookup keys from most to least specific', () => {
    expect(calibrationLookupKeys({
      productName: 'Salzstangen',
      brand: 'Snack Day',
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

    const records: PieceCalibration[] = [
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

  it('represents offline/configuration issues in the production state machine', () => {
    const issue = {
      kind: 'offline' as const,
      title: 'Offline', message: 'Keine Netzwerkdaten verfügbar.', technical: 'offline',
      attempts: [], occurredAt: '2026-07-12T00:00:00.000Z', retryLabel: 'Erneut prüfen'
    };
    const state = searchWorkflowReducer(createSearchWorkflowState(), { type: 'issue', issue });
    expect(currentWorkflowIssue(state)).toEqual(issue);
  });
});
