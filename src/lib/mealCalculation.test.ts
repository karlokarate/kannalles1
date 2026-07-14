import { describe, expect, it } from 'vitest';
import type { CatalogProduct } from './catalog/catalogDomain';
import { createMealCalculationItem, totalMealCarbohydrates, updateMealCalculationItem } from './mealCalculation';
import type { CatalogUnitResolution } from './resolution/catalogResolution';

const product: CatalogProduct = {
  productId: 1,
  code: 'test-bread',
  displayName: 'Mehrkornbrot',
  brand: null,
  nutrition: { carbohydratesPer100: 40, basis: 'mass', source: 'as_sold' },
  unitEvidence: { manufacturerServing: null, productQuantity: null, provenSmallestUnit: null, defaultUnitKind: 'none' },
  imageReference: null,
  hasQualityErrors: false,
  rankOrdinal: 1
};

const resolution: CatalogUnitResolution = {
  status: 'resolved',
  selectedOptionId: 'slice',
  reason: 'smallest-proven-unit',
  options: [
    { id: 'slice', unit: 'slice', label: 'Scheibe', basis: 'mass', baseValue: 50, source: 'user_calibration', recommended: true, smallestEdibleUnit: true, priority: 1, note: '' },
    { id: 'gram', unit: 'g', label: 'Gramm', basis: 'mass', baseValue: 1, source: 'direct_mass', recommended: false, smallestEdibleUnit: false, priority: 2, note: '' }
  ]
};

describe('meal calculation', () => {
  it('keeps products independently editable and totals without intermediate rounding', () => {
    const bread = createMealCalculationItem('bread', product, { amount: 2, unit: 'slice', unitExplicit: true }, resolution, 'slice');
    expect(bread?.calculation.carbohydratesG).toBe(40);
    if (!bread) throw new Error('expected a calculable meal item');
    const changed = updateMealCalculationItem(bread, 75, 'gram');
    expect(changed.request).toMatchObject({ amount: 75, unit: 'g' });
    expect(changed.calculation.carbohydratesG).toBe(30);
    expect(totalMealCarbohydrates([bread, changed])).toBe(70);
  });

  it('does not create an item from a missing unit value', () => {
    const unresolved = { ...resolution, selectedOptionId: null, status: 'needs_unit_calibration' as const };
    expect(createMealCalculationItem('missing', product, { amount: 1, unit: 'slice', unitExplicit: true }, unresolved, null)).toBeNull();
  });
});
