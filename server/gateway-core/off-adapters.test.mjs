import { describe, expect, it } from 'vitest';
import {
  adaptV2ProductResponse,
  adaptV3ProductResponse,
  hasCarbohydrateData,
  nutritionToNutriments,
  safeOffImageUrl
} from './off-adapters.mjs';
import { normalizeBarcode } from './normalization.mjs';

function set({ preparation = 'as_sold', per, value, valueComputed, unit = 'g' }) {
  return {
    preparation,
    per,
    nutrients: {
      carbohydrates: {
        ...(value === undefined ? {} : { value }),
        ...(valueComputed === undefined ? {} : { value_computed: valueComputed }),
        unit
      }
    }
  };
}

describe('OFF v3.6 nutrition compatibility adapter', () => {
  it('maps authoritative 100g, 100ml and serving bases without conflating them', () => {
    const nutriments = nutritionToNutriments({
      aggregated_set: set({ per: '100g', value: 42 }),
      input_sets: [
        set({ per: '100ml', value: 7.5 }),
        set({ per: 'serving', value: 18 })
      ]
    });
    expect(nutriments).toEqual({
      carbohydrates_100g: 42,
      carbohydrates_100ml: 7.5,
      carbohydrates_serving: 18
    });
  });

  it('keeps prepared values separate and converts documented mass units to grams', () => {
    const nutriments = nutritionToNutriments({
      aggregated_set: set({ preparation: 'prepared', per: '100g', value: 22_000, unit: 'mg' }),
      input_sets: [set({ preparation: 'prepared', per: '100ml', value: 0.031, unit: 'kg' })]
    });
    expect(nutriments).toEqual({
      carbohydrates_prepared_100g: 22,
      carbohydrates_prepared_100ml: 31
    });
  });

  it('uses value_computed only when value is missing and rejects unknown units', () => {
    expect(nutritionToNutriments({
      aggregated_set: set({ per: '100g', valueComputed: 12.5 }),
      input_sets: [set({ per: '100ml', value: 99, unit: 'kcal' })]
    })).toEqual({ carbohydrates_100g: 12.5 });
  });

  it('returns no compatibility values for missing nutrition', () => {
    expect(nutritionToNutriments(undefined)).toEqual({});
    expect(adaptV3ProductResponse({ status: 'success', product: { code: '1234567' } }).product.nutriments)
      .toEqual({});
  });

  it('rejects impossible per-100 values before they can suppress v2 enrichment', () => {
    expect(nutritionToNutriments({
      aggregated_set: set({ per: '100g', value: -5 }),
      input_sets: [set({ per: '100ml', value: 500 })]
    })).toEqual({});
    expect(hasCarbohydrateData({ nutriments: { carbohydrates_100g: -5 } })).toBe(false);
    expect(hasCarbohydrateData({ nutriments: { carbohydrates_100ml: 500 } })).toBe(false);
  });

  it('accepts serving-only carbohydrates only with one consistent dimensional serving', () => {
    expect(hasCarbohydrateData({
      serving_size: '1 Riegel (30 g)',
      serving_quantity: 30,
      nutriments: { carbohydrates_serving: 18 }
    })).toBe(true);
    expect(hasCarbohydrateData({
      serving_size: '250 ml',
      serving_quantity: 250,
      nutriments: { carbohydrates_prepared_serving: 25 }
    })).toBe(true);
    expect(hasCarbohydrateData({
      serving_size: '1 Portion',
      serving_quantity: 30,
      nutriments: { carbohydrates_serving: 18 }
    })).toBe(false);
    expect(hasCarbohydrateData({
      serving_size: '30 g',
      serving_quantity: 250,
      nutriments: { carbohydrates_serving: 18 }
    })).toBe(false);
    expect(hasCarbohydrateData({
      serving_size: '30 g / 60 ml',
      nutriments: { carbohydrates_serving: 18 }
    })).toBe(false);
  });

  it('does not accept a serving whose derived per-100 value is impossible', () => {
    expect(hasCarbohydrateData({
      serving_size: '30 g',
      serving_quantity: 30,
      nutriments: { carbohydrates_serving: 35 }
    })).toBe(false);
    expect(hasCarbohydrateData({
      serving_size: '100 ml',
      serving_quantity: 100,
      nutriments: { carbohydrates_serving: 200 }
    })).toBe(true);
  });

  it('normalizes the v2 numeric status to the public string contract', () => {
    expect(adaptV2ProductResponse({ status: 1, code: 1234567, product: { code: 1234567 } })).toMatchObject({
      status: '1',
      code: '1234567',
      product: { code: '1234567' }
    });
  });
});

describe('OFF barcode normalization', () => {
  it.each([
    ['1234567', '01234567'],
    ['01234567', '1234567'.padStart(8, '0')],
    ['034000470693', '0034000470693'],
    ['4000417025005', '4000417025005'],
    ['04000417025005', '4000417025005']
  ])('normalizes %s to %s', (input, expected) => {
    expect(normalizeBarcode(input)).toBe(expected);
  });
});

describe('OFF image URL policy', () => {
  it('rejects non-OFF, insecure and malformed product image URLs', () => {
    expect(safeOffImageUrl('https://images.openfoodfacts.org/images/products/1/front.jpg'))
      .toBe('https://images.openfoodfacts.org/images/products/1/front.jpg');
    expect(safeOffImageUrl('https://tracker.example/pixel')).toBeUndefined();
    expect(safeOffImageUrl('http://images.openfoodfacts.org/pixel')).toBeUndefined();
    expect(safeOffImageUrl('not a url')).toBeUndefined();
  });
});
