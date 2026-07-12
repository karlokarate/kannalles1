import { describe, expect, it } from 'vitest';
import type { ManualFormValues } from '../types';
import { buildManualResult } from './manual';

const base: ManualFormValues = {
  productName: 'Test',
  brand: '',
  amount: 250,
  unit: 'ml',
  barcode: '',
  unitWeightG: null,
  nutritionBasis: '100ml',
  carbsPer100: 8
};

describe('manual nutrition basis', () => {
  it('calculates volume only against a 100 ml basis', () => {
    const result = buildManualResult(base);
    expect(result.basis).toBe('100ml');
    expect(result.totalVolumeMl).toBe(250);
    expect(result.carbohydratesG).toBe(20);
  });

  it('does not silently treat millilitres as grams', () => {
    const result = buildManualResult({ ...base, nutritionBasis: '100g' });
    expect(result.carbohydratesG).toBeNull();
    expect(result.status).toBe('needs_unit_calibration');
  });

  it('requires total millilitres for a 100 ml label instead of accepting an unusable piece weight', () => {
    expect(() => buildManualResult({
      ...base,
      amount: 2,
      unit: 'portion',
      unitWeightG: 200,
      nutritionBasis: '100ml'
    })).toThrow(/Gesamtmenge in Millilitern/);
    const twoGlasses = buildManualResult({ ...base, amount: 500, unit: 'ml', nutritionBasis: '100ml' });
    expect(twoGlasses.totalVolumeMl).toBe(500);
    expect(twoGlasses.carbohydratesG).toBe(40);
  });

  it('rejects zero amounts and zero unit weights', () => {
    expect(() => buildManualResult({ ...base, amount: 0 })).toThrow(/ungültig|größer als 0/);
    expect(() => buildManualResult({
      ...base, unit: 'piece', unitWeightG: 0, nutritionBasis: '100g'
    })).toThrow(/ungültig|Stückgewicht/);
  });

  it('marks manually entered pieces as countable for group weighing', () => {
    const result = buildManualResult({
      ...base,
      amount: 10,
      unit: 'piece',
      unitWeightG: null,
      nutritionBasis: '100g'
    });
    expect(result.countability).toBe('countable');
    expect(result.status).toBe('needs_unit_calibration');
  });

  it('uses basis-specific carbohydrate corruption limits for dense liquids', () => {
    expect(buildManualResult({ ...base, carbsPer100: 140 }).carbohydratesG).toBe(350);
    expect(() => buildManualResult({ ...base, carbsPer100: 201 })).toThrow(/zwischen 0 und 200/);
    expect(() => buildManualResult({
      ...base, unit: 'g', nutritionBasis: '100g', carbsPer100: 101
    })).toThrow(/zwischen 0 und 100/);
  });

  it('rejects adversarial amounts and derived total weights before building a result', () => {
    expect(() => buildManualResult({ ...base, amount: 100_001 })).toThrow(/zu groß/);
    expect(() => buildManualResult({
      ...base, unit: 'piece', amount: 100, unitWeightG: 2_000, nutritionBasis: '100g'
    })).toThrow(/100 kg/);
  });
});
