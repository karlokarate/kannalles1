import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const suite = JSON.parse(readFileSync(new URL('./acceptance-cases.json', import.meta.url), 'utf8')) as {
  suite: string;
  version: string;
  cases: Array<{ id: string; given: Record<string, unknown>; expect: Record<string, unknown> }>;
};
const byId = new Map(suite.cases.map((entry) => [entry.id, entry]));

describe('normative v2 acceptance data', () => {
  it('contains unique stable identifiers', () => {
    expect(new Set(suite.cases.map((entry) => entry.id)).size).toBe(suite.cases.length);
    expect(suite.suite).toBe('kh-checker-core-acceptance');
  });

  it('keeps immediate retry and no local countdown as hard failure semantics', () => {
    expect(byId.get('search-all-fail-no-cache')?.expect).toMatchObject({
      status: 'temporarily_unavailable', retryAllowedImmediately: true, localCountdown: false
    });
  });

  it('limits the primary plus fallback search to two requests', () => {
    expect(byId.get('search-primary-fails-fallback-succeeds')?.expect.networkRequests).toBe(2);
  });

  it('derives group weighing without premature rounding', () => {
    const item = byId.get('group-weighing-derivation');
    const given = item?.given as { requestedAmount: number; measuredCount: number; measuredTotalWeightG: number; carbohydratesPer100g: number };
    const unitWeightG = given.measuredTotalWeightG / given.measuredCount;
    const requestedTotalCarbsG = given.requestedAmount * unitWeightG * given.carbohydratesPer100g / 100;
    expect(unitWeightG).toBe(item?.expect.unitWeightG);
    expect(requestedTotalCarbsG).toBe(item?.expect.requestedTotalCarbsG);
  });

  it('never crosses a piece calibration into a package unit', () => {
    expect(byId.get('calibration-does-not-cross-package-boundary')?.expect.calibrationApplied).toBe(false);
  });
});
