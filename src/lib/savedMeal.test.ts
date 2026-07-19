import { describe, expect, it } from 'vitest';
import { formatMealPerformedAt } from './savedMeal';

describe('saved meal calculation time', () => {
  it('formats both date and time for the German history view', () => {
    const formatted = formatMealPerformedAt('2026-07-19T14:32:45.123Z');
    expect(formatted).toContain('2026');
    expect(formatted).toMatch(/\d{1,2}:\d{2}/);
  });

  it('keeps corrupted legacy timestamps transparent', () => {
    expect(formatMealPerformedAt('not-a-date')).toBe('Zeitpunkt unbekannt');
  });
});
