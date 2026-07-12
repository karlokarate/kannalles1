import { describe, expect, it } from 'vitest';
import { getBaseFoodReference } from './baseFoods';

describe('bundled BLS 4.0 base-food references', () => {
  it('normalizes a misspelled spaghetti query before reference lookup through the parser path', () => {
    const reference = getBaseFoodReference('spaghetti');
    expect(reference?.id).toBe('pasta-cooked');
    expect(reference?.carbohydratesPer100g).toBe(28.68);
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
    expect(reference?.carbohydratesPer100g).toBe(9.9);
    expect(getBaseFoodReference('Erdnussbutter')).toBeNull();
    expect(getBaseFoodReference('Wasabi Erdnüsse ummantelt')).toBeNull();
    expect(getBaseFoodReference('Erdnussflips')).toBeNull();
  });

  it.each([
    ['Erdnuss', 'H110600', 9.9],
    ['Nudeln gekocht', 'E401032', 28.68],
    ['Reis gekocht', 'C352032', 24.8],
    ['Couscous gekocht', 'C119232', 31.05],
    ['Bulgur gekocht', 'C119132', 29.1],
    ['Quinoa gekocht', 'C118032', 16.92],
    ['Linsen gekocht', 'H730132', 15.5],
    ['Kichererbsen gekocht', 'G770432', 17.4],
    ['Kartoffeln gekocht', 'K110132', 15.832]
  ])('uses official available-carbohydrate data for %s (%s)', (query, code, carbohydrates) => {
    const reference = getBaseFoodReference(query);
    expect(reference?.blsCode).toBe(code);
    expect(reference?.carbohydratesPer100g).toBe(carbohydrates);
    expect(reference?.middleRange).toEqual({ from: carbohydrates, to: carbohydrates });
    expect(reference?.sourceLabel).toContain(`BLS 4.0 · ${code}`);
    expect(reference?.note).toContain('Max Rubner-Institut 2025');
    expect(reference?.note).toContain('CC BY 4.0');
    expect(reference?.note).toContain('10.25826/Data20251217-134202-0');
    expect(reference?.note).toContain('Kohlenhydrate, verfügbar');
  });

  it('keeps legume pasta excluded without hiding plain cooked legumes', () => {
    expect(getBaseFoodReference('Linsen gekocht')?.blsCode).toBe('H730132');
    expect(getBaseFoodReference('Linsennudeln')).toBeNull();
    expect(getBaseFoodReference('Kichererbsen Pasta')).toBeNull();
  });
});
