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
  });

  it('rejects unrelated JSON files', () => {
    expect(parseTransferFile('{"schemaVersion":1}')).toBeNull();
    expect(parseTransferFile('not json')).toBeNull();
  });
});
