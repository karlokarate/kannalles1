import { describe, expect, it } from 'vitest';
import { DEFAULT_OFFLINE_SETTINGS, normalizeOfflineSettings } from './settings';

describe('offline diabetes settings migration', () => {
  it('adds safe active-insulin defaults to existing settings', () => {
    const normalized = normalizeOfflineSettings({ ...DEFAULT_OFFLINE_SETTINGS, insulinActivityDurationHours: undefined, manualBolusTrackingEnabled: undefined });
    expect(normalized.insulinActivityDurationHours).toBe(5);
    expect(normalized.manualBolusTrackingEnabled).toBe(false);
  });

  it('preserves a configured duration and optional pen-bolus mode', () => {
    const normalized = normalizeOfflineSettings({ ...DEFAULT_OFFLINE_SETTINGS, insulinActivityDurationHours: 4.5, manualBolusTrackingEnabled: true });
    expect(normalized.insulinActivityDurationHours).toBe(4.5);
    expect(normalized.manualBolusTrackingEnabled).toBe(true);
  });

  it('rejects durations outside the supported one-to-six-hour range', () => {
    expect(normalizeOfflineSettings({ ...DEFAULT_OFFLINE_SETTINGS, insulinActivityDurationHours: 0.5 }).insulinActivityDurationHours).toBe(5);
    expect(normalizeOfflineSettings({ ...DEFAULT_OFFLINE_SETTINGS, insulinActivityDurationHours: 6.5 }).insulinActivityDurationHours).toBe(5);
    expect(normalizeOfflineSettings({ ...DEFAULT_OFFLINE_SETTINGS, insulinActivityDurationHours: 4.3 }).insulinActivityDurationHours).toBe(5);
  });
});
