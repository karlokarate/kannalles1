import { describe, expect, it } from 'vitest';
import { getBaseFoodReference } from './baseFoods';

 describe('bundled base-food references', () => {
  it('normalizes a misspelled spaghetti query before reference lookup through the parser path', () => {
    const reference = getBaseFoodReference('spaghetti');
    expect(reference?.id).toBe('pasta-cooked');
    expect(reference?.carbohydratesPer100g).toBeCloseTo(30.9, 1);
  });

  it('uses cooked rice by default but not for an explicit dry request', () => {
    expect(getBaseFoodReference('200 g Reis')?.id).toBe('rice-cooked');
    expect(getBaseFoodReference('200 g trockener Reis')).toBeNull();
  });

  it('does not replace specialty pasta with the generic pasta reference', () => {
    expect(getBaseFoodReference('Edamame Spaghetti')).toBeNull();
    expect(getBaseFoodReference('Instant Nudeln')).toBeNull();
  });

  it('resolves plain Erdnüsse locally but never substitutes processed peanut products', () => {
    const reference = getBaseFoodReference('Erdnuss');
    expect(reference?.id).toBe('peanuts-roasted-unsalted');
    expect(reference?.carbohydratesPer100g).toBeCloseTo(9.4, 1);
    expect(getBaseFoodReference('Erdnussbutter')).toBeNull();
    expect(getBaseFoodReference('Wasabi Erdnüsse ummantelt')).toBeNull();
    expect(getBaseFoodReference('Erdnussflips')).toBeNull();
  });
});
