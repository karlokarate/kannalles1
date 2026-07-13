import { describe, expect, it } from 'vitest';
import { activeDiabetesSegment, addDiabetesSegment, calculateBolus, changeSegmentBoundary, defaultDiabetesSegments, normalizeDiabetesSegments, removeDiabetesSegment } from './diabetesProfile';

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
