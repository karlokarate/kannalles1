import { describe, expect, it } from 'vitest';
import { activeDiabetesFactors, activeDiabetesSegment, addDiabetesSegment, calculateBolus, changeSegmentBoundary, defaultDiabetesFactorSchedules, defaultDiabetesSegments, normalizeDiabetesFactorSchedules, normalizeDiabetesSegments, removeDiabetesSegment } from './diabetesProfile';

describe('diabetes profile time segments', () => {
  it('provides the seven requested contiguous default windows', () => {
    expect(defaultDiabetesSegments().map((segment) => [segment.startMinute, segment.endMinute])).toEqual([
      [0, 360], [360, 540], [540, 660], [660, 840], [840, 1020], [1020, 1260], [1260, 1440]
    ]);
  });

  it('moves shared boundaries without permitting overlap', () => {
    const segments = defaultDiabetesSegments();
    const changed = changeSegmentBoundary(segments, 1, 390);
    expect(changed[0].endMinute).toBe(390);
    expect(changed[1].startMinute).toBe(390);
    expect(changeSegmentBoundary(changed, 1, 0)).toEqual(changed);
  });

  it('adds and removes windows while preserving full-day coverage', () => {
    const added = addDiabetesSegment(defaultDiabetesSegments());
    expect(added).toHaveLength(8);
    expect(normalizeDiabetesSegments(added)).toEqual(added);
    const removed = removeDiabetesSegment(added, 2);
    expect(removed).toHaveLength(7);
    expect(removed[0].startMinute).toBe(0);
    expect(removed.at(-1)?.endMinute).toBe(1440);
  });

  it('selects the local-time segment', () => {
    const date = new Date(2026, 6, 14, 10, 30);
    expect(activeDiabetesSegment(defaultDiabetesSegments(), date).startMinute).toBe(540);
  });

  it('keeps boundaries and segment counts independent for every factor', () => {
    const schedules = defaultDiabetesFactorSchedules();
    const changedRatios = changeSegmentBoundary(addDiabetesSegment(schedules.carbohydrateRatioG), 1, 210);
    expect(changedRatios).toHaveLength(8);
    expect(changedRatios[0].endMinute).toBe(210);
    expect(schedules.correctionFactorMgDl).toHaveLength(7);
    expect(schedules.correctionFactorMgDl[0].endMinute).toBe(360);
    expect(schedules.targetGlucoseMgDl).toHaveLength(7);
  });

  it('migrates shared legacy windows into three independent factor schedules', () => {
    const legacy = defaultDiabetesSegments().map((segment) => ({ ...segment, carbohydrateRatioG: 10, correctionFactorMgDl: 50, targetGlucoseMgDl: 100 }));
    const schedules = normalizeDiabetesFactorSchedules(undefined, legacy);
    expect(schedules.carbohydrateRatioG[0]).toMatchObject({ startMinute: 0, endMinute: 360, value: 10 });
    expect(schedules.correctionFactorMgDl[0].value).toBe(50);
    expect(schedules.targetGlucoseMgDl[0].value).toBe(100);
    expect(schedules.carbohydrateRatioG).not.toBe(schedules.correctionFactorMgDl);
  });

  it('selects each active factor from its own current window', () => {
    const schedules = defaultDiabetesFactorSchedules();
    schedules.carbohydrateRatioG = [{ id: 'ratio-all-day', startMinute: 0, endMinute: 1440, value: 12 }];
    schedules.correctionFactorMgDl = changeSegmentBoundary(schedules.correctionFactorMgDl, 1, 420).map((segment, index) => ({ ...segment, value: index === 0 ? 60 : 45 }));
    schedules.targetGlucoseMgDl = changeSegmentBoundary(schedules.targetGlucoseMgDl, 1, 480).map((segment, index) => ({ ...segment, value: index === 0 ? 110 : 95 }));
    expect(activeDiabetesFactors(schedules, new Date(2026, 6, 14, 7, 30))).toEqual({ carbohydrateRatioG: 12, correctionFactorMgDl: 45, targetGlucoseMgDl: 110 });
  });
});

describe('bolus calculation', () => {
  const segment = { ...defaultDiabetesSegments()[0], carbohydrateRatioG: 10, correctionFactorMgDl: 50, targetGlucoseMgDl: 100 };

  it('adds a positive correction to the meal bolus', () => {
    expect(calculateBolus(60, 200, segment)).toEqual({ carbohydrateBolus: 6, correctionBolus: 2, totalBolus: 8 });
  });

  it('subtracts a below-target correction without returning a negative dose', () => {
    expect(calculateBolus(10, 50, segment)).toEqual({ carbohydrateBolus: 1, correctionBolus: -1, totalBolus: 0 });
  });

  it('calculates correction without a meal and requires configured factors', () => {
    expect(calculateBolus(null, 200, segment)).toEqual({ carbohydrateBolus: null, correctionBolus: 2, totalBolus: 2 });
    expect(calculateBolus(50, 200, defaultDiabetesSegments()[0])).toEqual({ carbohydrateBolus: null, correctionBolus: null, totalBolus: null });
  });
});
