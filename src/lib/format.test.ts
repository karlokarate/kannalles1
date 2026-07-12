import { describe, expect, it } from 'vitest';
import { parseLocalizedDecimal } from './format';

describe('locale-aware decimal parsing', () => {
  it('accepts German comma and invariant point decimals identically', () => {
    expect(parseLocalizedDecimal('21,5')).toBe(21.5);
    expect(parseLocalizedDecimal('21.5')).toBe(21.5);
    expect(parseLocalizedDecimal('0')).toBe(0);
  });

  it('rejects grouping, negative and non-numeric input', () => {
    expect(parseLocalizedDecimal('1.234,5')).toBeNull();
    expect(parseLocalizedDecimal('-1')).toBeNull();
    expect(parseLocalizedDecimal('abc')).toBeNull();
  });
});
