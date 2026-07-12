import { describe, expect, it } from 'vitest';
import { resultDataAttribution } from './attribution';

describe('source-specific result attribution', () => {
  it('does not claim OFF for manual values', () => {
    const text = resultDataAttribution({ mode: 'manual', sourceLabel: 'Eigene Angabe' });
    expect(text).toContain('eigene Eingabe');
    expect(text).toContain('keine Open-Food-Facts-Nährwerte');
  });

  it('attributes BLS references under CC BY 4.0', () => {
    const text = resultDataAttribution({ mode: 'generic', sourceLabel: 'BLS 4.0 · C352032 · MRI 2025' });
    expect(text).toContain('Max Rubner-Institut 2025');
    expect(text).toContain('CC BY 4.0');
    expect(text).not.toContain('ODbL');
  });

  it('attributes OFF community product data under ODbL', () => {
    const text = resultDataAttribution({ mode: 'exact', sourceLabel: 'Open Food Facts' });
    expect(text).toContain('Open Food Facts');
    expect(text).toContain('ODbL');
  });
});
