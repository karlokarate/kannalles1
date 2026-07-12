import { describe, expect, it } from 'vitest';
import { buildManualResult } from './manual';
import { parseSearchHits, parseStoredCalculationResult } from './resultValidation';

describe('untrusted result isolation', () => {
  it('removes a corrupt third-party product image without hiding the valid result', () => {
    const result = buildManualResult({
      productName: 'Test', brand: '', amount: 100, unit: 'g', barcode: '',
      unitWeightG: null, nutritionBasis: '100g', carbsPer100: 20
    });
    const parsed = parseStoredCalculationResult({
      ...result,
      product: { ...result.product, imageUrl: 'https://tracker.example/pixel.gif' }
    });
    expect(parsed).not.toBeNull();
    expect(parsed?.product.imageUrl).toBeNull();
  });

  it('keeps valid hits while isolating strict-contract and image violations independently', () => {
    const safeImage = 'https://images.openfoodfacts.org/images/products/400/000/000/0001/front_de.1.400.jpg';
    expect(parseSearchHits([
      { code: '4000000000001', image_front_url: safeImage },
      { code: '4000000000002', image_front_url: 'https://tracker.example/pixel.gif' },
      { code: 42 }
    ])).toEqual([
      { code: '4000000000001', image_front_url: safeImage },
      { code: '4000000000002' }
    ]);
  });

  it('rejects adversarial amounts and nutrition values in a stored result', () => {
    const result = buildManualResult({
      productName: 'Test', brand: '', amount: 100, unit: 'g', barcode: '',
      unitWeightG: null, nutritionBasis: '100g', carbsPer100: 20
    });
    expect(parseStoredCalculationResult({ ...result, amount: 100_001 })).toBeNull();
    expect(parseStoredCalculationResult({ ...result, carbohydratesPer100: 101 })).toBeNull();
  });
});
