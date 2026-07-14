import { describe, expect, it } from 'vitest';
import { createTransferFile, parseTransferFile, serializeTransferFile } from './dataTransfer';
import { DEFAULT_OFFLINE_SETTINGS } from './settings';
import { createCatalogCalibration } from './resolution/catalogCalibration';

describe('portable history and diabetes settings', () => {
  it('round-trips the versioned direct-transfer file', () => {
    const calibration = createCatalogCalibration({ calibrationId: 'portion-1', scope: 'catalog-product', identity: { catalogProductId: 42, barcode: null, canonicalName: 'Testbrot', brandCanonical: null, genericFoodKey: null }, unit: 'slice', measuredCount: 5, measuredTotalWeightG: 200, smallestEdibleUnit: true, now: '2026-07-14T05:00:00.000Z' });
    if (!calibration) throw new Error('expected valid calibration');
    const file = createTransferFile(DEFAULT_OFFLINE_SETTINGS, '2026-07-14T06:00:00.000Z', { calculations: [], meals: [], calibrations: [calibration] });
    expect(parseTransferFile(serializeTransferFile(file))).toEqual(file);
    expect(file.history.calibrations[0].unit).toBe('slice');
    expect(file.diabetes.factorSegments.carbohydrateRatioG).not.toBe(file.diabetes.factorSegments.correctionFactorMgDl);
    expect(file.diabetes).toMatchObject({ insulinActivityDurationHours: 5, manualBolusTrackingEnabled: false });
  });

  it('imports legacy transfer files with shared segments without losing values', () => {
    const legacySegments = DEFAULT_OFFLINE_SETTINGS.diabetesFactorSegments.carbohydrateRatioG.map((segment) => ({
      ...segment,
      carbohydrateRatioG: 11,
      correctionFactorMgDl: 55,
      targetGlucoseMgDl: 105
    }));
    const parsed = parseTransferFile(JSON.stringify({
      format: 'fishit-kh-checker-transfer',
      schemaVersion: 1,
      exportedAt: '2026-07-14T06:00:00.000Z',
      diabetes: { enabled: true, segments: legacySegments },
      history: { calculations: [], meals: [], calibrations: [] }
    }));
    expect(parsed?.diabetes.factorSegments.carbohydrateRatioG[0].value).toBe(11);
    expect(parsed?.diabetes.factorSegments.correctionFactorMgDl[0].value).toBe(55);
    expect(parsed?.diabetes.factorSegments.targetGlucoseMgDl[0].value).toBe(105);
    expect(parsed?.diabetes).toMatchObject({ insulinActivityDurationHours: 5, manualBolusTrackingEnabled: false });
  });

  it('rejects unrelated JSON files', () => {
    expect(parseTransferFile('{"schemaVersion":1}')).toBeNull();
    expect(parseTransferFile('not json')).toBeNull();
  });
});
