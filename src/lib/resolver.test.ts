import { describe, expect, it } from 'vitest';
import type { OffProduct, ParsedFoodRequest, SearchHit } from '../types';
import {
  buildExactResult,
  buildGenericResult,
  displayCarbohydrateValue,
  rankExactCandidates,
  recalculateWithManualTotalMass,
  recalculateWithManualTotalVolume,
  recalculateWithPortion,
  resolveGenericCandidates
} from './resolver';

function request(
  rawInput: string,
  productName: string,
  amount: number,
  unit: ParsedFoodRequest['amount']['unit'],
  resolutionMode: ParsedFoodRequest['resolutionMode'] = 'generic_category',
  explicit = true
): ParsedFoodRequest {
  return {
    status: 'parsed',
    rawInput,
    product: { name: productName, brand: null, variant: null },
    amount: { value: amount, unit, valueExplicit: explicit, unitExplicit: explicit },
    resolutionMode,
    barcode: null,
    clarificationQuestion: null,
    parser: 'local'
  };
}

const saltStickHits: SearchHit[] = [71, 72, 73, 74, 75].map((carbs, index) => ({
  code: String(index + 1),
  product_name_de: 'Salzstangen',
  brands: `Marke ${index}`,
  countries_tags: ['en:germany'],
  completeness: 0.8,
  nutriments: { carbohydrates_100g: carbs }
}));

describe('generic resolution', () => {
  it('uses a robust median', () => {
    const resolved = resolveGenericCandidates('Salzstangen', saltStickHits, true);
    expect(resolved.median).toBe(73);
    expect(resolved.confidence).toBe('high');
  });

  it('calculates an explicit gram amount deterministically', () => {
    const resolved = resolveGenericCandidates('Salzstangen', saltStickHits, true);
    const result = buildGenericResult(request('100 g Salzstangen', 'Salzstangen', 100, 'g'), resolved, null);
    expect(result.status).toBe('calculated');
    expect(result.carbohydratesG).toBe(73);
  });

  it('uses the explicit millilitre basis when OFF exposes both mass and volume values', () => {
    const hits: SearchHit[] = [
      {
        code: 'drink-both', product_name_de: 'Testgetränk', completeness: 0.9,
        nutrition_data_per: '100ml',
        nutriments: { carbohydrates_100g: 10, carbohydrates_100ml: 12 }
      }
    ];
    const resolved = resolveGenericCandidates('Testgetränk', hits, false, 'ml');
    const result = buildGenericResult(request('250 ml Testgetränk', 'Testgetränk', 250, 'ml'), resolved, null);
    expect(result.basis).toBe('100ml');
    expect(result.totalVolumeMl).toBe(250);
    expect(result.carbohydratesG).toBe(30);
  });

  it('reports and displays only the products that actually formed a mixed-basis median', () => {
    const hits: SearchHit[] = [
      ...[10, 12, 14].map((carbohydrates, index) => ({
        code: `40000000003${index}`, product_name_de: 'Basisprodukt', brands: `Mass ${index}`,
        completeness: 0.9, nutriments: { carbohydrates_100g: carbohydrates }
      })),
      ...[4, 6].map((carbohydrates, index) => ({
        code: `40000000004${index}`, product_name_de: 'Basisprodukt', brands: `Volume ${index}`,
        completeness: 0.9, nutrition_data_per: '100ml',
        nutriments: { carbohydrates_100ml: carbohydrates }
      }))
    ];
    const resolved = resolveGenericCandidates('Basisprodukt', hits, false);
    const result = buildGenericResult(
      request('100 g Basisprodukt', 'Basisprodukt', 100, 'g'), resolved, null
    );
    expect(resolved.basis).toBe('100g');
    expect(resolved.sampleSize).toBe(3);
    expect(resolved.hits).toHaveLength(3);
    expect(result.sampleSize).toBe(3);
    expect(result.candidates).toHaveLength(3);
    expect(result.notes).toContain('Median aus 3 gefilterten Basisprodukten.');
  });
});

describe('nutrition basis and upstream value validation', () => {
  it('calculates an exact liquid from the 100 ml field when both bases exist', () => {
    const hit: SearchHit = {
      code: 'liquid', product_name_de: 'Testgetränk', nutrition_data_per: '100ml',
      nutriments: { carbohydrates_100g: 10, carbohydrates_100ml: 12 }
    };
    const result = buildExactResult(
      request('250 ml Testgetränk', 'Testgetränk', 250, 'ml', 'exact_product'),
      hit,
      undefined,
      null
    );
    expect(result.status).toBe('calculated');
    expect(result.basis).toBe('100ml');
    expect(result.totalMassG).toBeNull();
    expect(result.totalVolumeMl).toBe(250);
    expect(result.carbohydratesG).toBe(30);
  });

  it('applies the same basis selection to explicitly prepared values', () => {
    const hit: SearchHit = {
      code: 'prepared-liquid', product_name_de: 'Zubereitetes Testgetränk',
      nutrition_data_prepared_per: '100ml',
      nutriments: {
        carbohydrates_100g: 9,
        carbohydrates_100ml: 10,
        carbohydrates_prepared_100g: 10,
        carbohydrates_prepared_100ml: 12
      }
    };
    const result = buildExactResult(
      request('250 ml zubereitetes Testgetränk', 'zubereitetes Testgetränk', 250, 'ml', 'exact_product'),
      hit,
      undefined,
      null
    );
    expect(result.basis).toBe('100ml');
    expect(result.carbohydratesPer100).toBe(12);
    expect(result.carbohydratesG).toBe(30);
  });

  it.each([-1, Number.NaN, '', '   ', 101])('rejects an invalid 100 g carbohydrate value %p', (value) => {
    const hit: SearchHit = {
      code: 'invalid', product_name_de: 'Ungültig',
      nutriments: { carbohydrates_100g: value as number }
    };
    const exact = buildExactResult(request('100 g Ungültig', 'Ungültig', 100, 'g', 'exact_product'), hit, undefined, null);
    const generic = resolveGenericCandidates('Ungültig', [{ ...hit, completeness: 0.9 }], false, 'g');
    expect(exact.carbohydratesPer100).toBeNull();
    expect(exact.carbohydratesG).toBeNull();
    expect(generic.median).toBeNull();
  });

  it('allows a credible dense 100 ml value while rejecting a clearly absurd one', () => {
    const dense: SearchHit = {
      code: 'dense', product_name_de: 'Sirup',
      nutriments: { carbohydrates_100ml: 140 }
    };
    const absurd: SearchHit = {
      ...dense,
      code: 'absurd',
      nutriments: { carbohydrates_100ml: 201 }
    };
    const denseResult = buildExactResult(request('100 ml Sirup', 'Sirup', 100, 'ml', 'exact_product'), dense, undefined, null);
    const absurdResult = buildExactResult(request('100 ml Sirup', 'Sirup', 100, 'ml', 'exact_product'), absurd, undefined, null);
    expect(denseResult.carbohydratesG).toBe(140);
    expect(absurdResult.carbohydratesPer100).toBeNull();
  });

  it('projects candidate nutrition with the same safe 100 ml/prepared basis as calculation', () => {
    const sold: SearchHit = {
      code: '4000000000101', product_name_de: 'Getränk', nutrition_data_per: '100ml',
      nutriments: { carbohydrates_100ml: 8 }
    };
    expect(displayCarbohydrateValue(sold, 'Getränk', 'ml')).toEqual({
      value: 8, basis: '100ml', prepared: false
    });

    const prepared: SearchHit = {
      ...sold,
      nutrition_data_prepared_per: '100ml',
      nutriments: { carbohydrates_100ml: 10, carbohydrates_prepared_100ml: 7 }
    };
    expect(displayCarbohydrateValue(prepared, 'zubereitetes Getränk', 'ml')).toEqual({
      value: 7, basis: '100ml', prepared: true
    });
  });

  it('converts a serving-only 30 g value only from consistent dimensional evidence', () => {
    const hit: SearchHit = {
      code: '4000000000201', product_name_de: 'Portionsriegel',
      serving_size: '1 Riegel (30 g)', serving_quantity: 30,
      nutriments: { carbohydrates_serving: 18 }
    };
    const result = buildExactResult(
      request('1 Portion Portionsriegel', 'Portionsriegel', 1, 'portion', 'exact_product'),
      hit,
      undefined,
      null
    );
    expect(result.basis).toBe('100g');
    expect(result.carbohydratesPer100).toBe(60);
    expect(result.totalMassG).toBe(30);
    expect(result.carbohydratesG).toBe(18);
  });

  it('converts a serving-only 250 ml value and keeps prepared values separate', () => {
    const hit: SearchHit = {
      code: '4000000000202', product_name_de: 'Zubereitetes Getränk',
      serving_size: '250 ml', serving_quantity: 250,
      nutriments: { carbohydrates_serving: 30, carbohydrates_prepared_serving: 25 }
    };
    const result = buildExactResult(
      request('1 Portion zubereitetes Getränk', 'zubereitetes Getränk', 1, 'portion', 'exact_product'),
      hit,
      undefined,
      null
    );
    expect(result.basis).toBe('100ml');
    expect(result.carbohydratesPer100).toBe(10);
    expect(result.totalVolumeMl).toBe(250);
    expect(result.carbohydratesG).toBe(25);
  });

  it('never guesses the dimension of a serving-only value', () => {
    const ambiguous: SearchHit = {
      code: '4000000000203', product_name_de: 'Uneindeutige Portion',
      serving_size: '1 Portion', serving_quantity: 30,
      nutriments: { carbohydrates_serving: 18 }
    };
    const contradictory: SearchHit = {
      ...ambiguous,
      code: '4000000000204', serving_size: '30 g', serving_quantity: 250
    };
    for (const hit of [ambiguous, contradictory]) {
      const result = buildExactResult(
        request('1 Portion Test', 'Test', 1, 'portion', 'exact_product'), hit, undefined, null
      );
      expect(result.carbohydratesPer100).toBeNull();
      expect(result.carbohydratesG).toBeNull();
    }
  });
});

describe('manual total amount editing', () => {
  it('turns a measured Salzstangen total into a reusable piece weight', () => {
    const resolved = resolveGenericCandidates('Salzstangen', saltStickHits, true);
    const unresolved = buildGenericResult(
      request('12 Salzstangen', 'Salzstangen', 12, 'piece'),
      resolved,
      null
    );

    const result = recalculateWithManualTotalMass(unresolved, 28.8);
    expect(result.status).toBe('calculated');
    expect(result.unit).toBe('piece');
    expect(result.amount).toBe(12);
    expect(result.unitWeightG).toBeCloseTo(2.4, 8);
    expect(result.totalMassG).toBeCloseTo(28.8, 8);
    expect(result.carbohydratesG).toBeCloseTo(21.024, 8);
  });

  it('replaces rather than accumulates manual options when a slider is adjusted repeatedly', () => {
    const resolved = resolveGenericCandidates('Salzstangen', saltStickHits, true);
    const unresolved = buildGenericResult(
      request('10 Salzstangen', 'Salzstangen', 10, 'piece'),
      resolved,
      null
    );

    const first = recalculateWithManualTotalMass(unresolved, 25);
    const second = recalculateWithManualTotalMass(first, 27);
    const manualPieceOptions = second.portionOptions.filter((option) => option.source === 'manual' && option.unit === 'piece');
    expect(manualPieceOptions).toHaveLength(1);
    expect(second.unitWeightG).toBeCloseTo(2.7, 8);
    expect(second.totalMassG).toBeCloseTo(27, 8);
  });

  it('updates a direct gram selection without changing it into a counted unit', () => {
    const resolved = resolveGenericCandidates('Salzstangen', saltStickHits, true);
    const original = buildGenericResult(request('100 g Salzstangen', 'Salzstangen', 100, 'g'), resolved, null);
    const edited = recalculateWithManualTotalMass(original, 42);
    expect(edited.unit).toBe('g');
    expect(edited.amount).toBe(42);
    expect(edited.totalMassG).toBe(42);
    expect(edited.carbohydratesG).toBeCloseTo(30.66, 8);
  });

  it('uses millilitres for a 100 ml nutrition basis', () => {
    const liquidHits: SearchHit[] = [
      {
        code: 'drink-1', product_name_de: 'Testgetränk', completeness: 0.9,
        nutriments: { carbohydrates_100ml: 8 }
      }
    ];
    const resolved = resolveGenericCandidates('Testgetränk', liquidHits, false);
    const original = buildGenericResult(request('100 ml Testgetränk', 'Testgetränk', 100, 'ml'), resolved, null);
    const edited = recalculateWithManualTotalVolume(original, 250);
    expect(edited.basis).toBe('100ml');
    expect(edited.unit).toBe('ml');
    expect(edited.totalVolumeMl).toBe(250);
    expect(edited.carbohydratesG).toBe(20);
  });
});

describe('counted-unit and manufacturer-portion resolution', () => {
  const buenoHit: SearchHit = {
    code: '4008400935225',
    product_name_de: 'Kinder Bueno',
    brands: ['Kinder'],
    categories_tags: ['en:chocolate-nuts-cookie-bars'],
    countries_tags: ['en:germany'],
    completeness: 0.9,
    nutriments: { carbohydrates_100g: 49.5 }
  };

  it('never treats an ambiguous 43 g serving as one explicitly requested bar', () => {
    const product: OffProduct = {
      code: '4008400935225',
      product_name_de: 'Kinder Bueno',
      brands: 'Kinder',
      quantity: '43 g',
      product_quantity: 43,
      product_quantity_unit: 'g',
      serving_size: '43 g',
      serving_quantity: 43,
      categories_tags: ['en:chocolate-nuts-cookie-bars']
    };
    const result = buildExactResult(request('1 Riegel Kinder Bueno', 'Kinder Bueno', 1, 'bar', 'exact_product'), buenoHit, product, null);
    expect(result.status).toBe('needs_unit_calibration');
    expect(result.unitWeightG).toBeNull();
    expect(result.carbohydratesG).toBeNull();
    expect(result.portionOptions.some((option) => option.unit === 'portion' && option.weightG === 43)).toBe(true);
  });

  it('derives 21.5 g from an explicit 2 x 21.5 g multipack', () => {
    const product: OffProduct = {
      code: '4008400935225',
      product_name_de: 'Kinder Bueno',
      brands: 'Kinder',
      quantity: '2 x 21.5 g',
      product_quantity: 43,
      product_quantity_unit: 'g',
      serving_size: '43 g',
      serving_quantity: 43,
      categories_tags: ['en:chocolate-nuts-cookie-bars']
    };
    const result = buildExactResult(request('1 Riegel Kinder Bueno', 'Kinder Bueno', 1, 'bar', 'exact_product'), buenoHit, product, null);
    expect(result.status).toBe('calculated');
    expect(result.unitWeightG).toBe(21.5);
    expect(result.carbohydratesG).toBeCloseTo(10.6425, 4);
  });

  it('uses the smallest explicit bar for a product-only Bueno query', () => {
    const product: OffProduct = {
      code: '4008400321622',
      product_name_de: 'Kinder Bueno',
      brands: 'Kinder',
      quantity: '8 x 21.5 g',
      product_quantity: 172,
      product_quantity_unit: 'g',
      serving_size: '21.5 g',
      serving_quantity: 21.5,
      categories_tags: ['en:chocolate-nuts-cookie-bars']
    };
    const implicit = request('Kinder Bueno', 'Kinder Bueno', 1, 'portion', 'exact_product', false);
    const result = buildExactResult(implicit, buenoHit, product, null);
    expect(result.unit).toBe('bar');
    expect(result.unitWeightG).toBe(21.5);
    expect(result.carbohydratesG).toBeCloseTo(10.6425, 4);
  });

  it('uses an editable manufacturer serving for a spread such as Nutella', () => {
    const hit: SearchHit = {
      code: 'nutella', product_name_de: 'Nutella', brands: 'Nutella',
      nutriments: { carbohydrates_100g: 57.5 }, completeness: 0.9
    };
    const product: OffProduct = {
      code: 'nutella', product_name_de: 'Nutella', brands: 'Nutella',
      quantity: '450 g', product_quantity: 450, product_quantity_unit: 'g',
      serving_size: '15 g', serving_quantity: 15
    };
    const implicit = request('Nutella', 'Nutella', 1, 'portion', 'exact_product', false);
    const result = buildExactResult(implicit, hit, product, null);
    expect(result.unit).toBe('portion');
    expect(result.unitWeightG).toBe(15);
    expect(result.carbohydratesG).toBeCloseTo(8.625, 4);
    const grams = result.portionOptions.find((option) => option.unit === 'g');
    expect(grams).toBeTruthy();
    if (!grams) throw new Error('Gramm-Option fehlt im Testergebnis.');
    const edited = recalculateWithPortion(result, 25, grams.id);
    expect(edited.carbohydratesG).toBeCloseTo(14.375, 4);
  });

  it('never exposes negative or absurd structured weights as product portions', () => {
    const hit: SearchHit = {
      code: 'bad-weights', product_name_de: 'Testprodukt',
      product_quantity: -50, product_quantity_unit: 'g',
      serving_quantity: -5, nutriments: { carbohydrates_100g: 20 }
    };
    const result = buildExactResult(request('1 Packung Testprodukt', 'Testprodukt', 1, 'package', 'exact_product'), hit, undefined, null);
    expect(result.product.packageWeightG).toBeNull();
    expect(result.product.servingWeightG).toBeNull();
    expect(result.portionOptions.some((option) => option.weightG !== null && option.weightG < 0)).toBe(false);

    const absurd: SearchHit = {
      ...hit,
      code: 'absurd-weights',
      quantity: '2 x 6000 g',
      product_quantity: 200_000,
      serving_quantity: 20_000
    };
    const absurdResult = buildExactResult(request('1 Stück Testprodukt', 'Testprodukt', 1, 'piece', 'exact_product'), absurd, undefined, null);
    expect(absurdResult.product.packageWeightG).toBe(12000);
    expect(absurdResult.product.servingWeightG).toBeNull();
    expect(absurdResult.portionOptions.some((option) =>
      ['explicit-multipack', 'explicit-unit', 'count-and-net-weight'].includes(option.source)
      && (option.weightG ?? 0) > 5_000
    )).toBe(false);
  });

  it('supports dimensioned kg, ml and litre package quantities without mass-volume guessing', () => {
    const kilogram = buildExactResult(
      request('1 Packung Trockenprodukt', 'Trockenprodukt', 1, 'package', 'exact_product'),
      {
        code: '4000000000210', product_name_de: 'Trockenprodukt', quantity: '1 kg',
        product_quantity: 1, product_quantity_unit: 'kg', nutriments: { carbohydrates_100g: 75 }
      },
      undefined,
      null
    );
    expect(kilogram.totalMassG).toBe(1_000);
    expect(kilogram.carbohydratesG).toBe(750);

    for (const [quantity, numeric, unit, expectedMl] of [
      ['750 ml', 750, 'ml', 750],
      ['1,5 l', 1.5, 'l', 1_500]
    ] as const) {
      const liquid = buildExactResult(
        request(`1 Packung Saft ${quantity}`, 'Saft', 1, 'package', 'exact_product'),
        {
          code: `4000000000${expectedMl}`, product_name_de: 'Saft', quantity,
          product_quantity: numeric, product_quantity_unit: unit,
          nutrition_data_per: '100ml', nutriments: { carbohydrates_100ml: 10 }
        },
        undefined,
        null
      );
      expect(liquid.totalMassG).toBeNull();
      expect(liquid.totalVolumeMl).toBe(expectedMl);
      expect(liquid.carbohydratesG).toBe(expectedMl / 10);
    }
  });
});

describe('prepared base-food resolution', () => {
  const riceRequest = request('200 g gekochter Reis', 'gekochter Reis', 200, 'g');

  it('uses cooked rice values and rejects dry rice values', () => {
    const hits: SearchHit[] = [
      { code: 'cooked-1', product_name_de: 'Gekochter Reis', brands: 'A', countries_tags: ['en:germany'], completeness: 0.8, nutriments: { carbohydrates_100g: 28 } },
      { code: 'cooked-2', product_name_de: 'Reis gekocht', brands: 'B', countries_tags: ['en:germany'], completeness: 0.8, nutriments: { carbohydrates_100g: 30 } },
      { code: 'dry', product_name_de: 'Langkornreis trocken', brands: 'C', countries_tags: ['en:germany'], completeness: 0.9, nutriments: { carbohydrates_100g: 75 } }
    ];
    const resolved = resolveGenericCandidates('gekochter Reis', hits, true);
    const result = buildGenericResult(riceRequest, resolved, null);
    expect(resolved.hits.map((hit) => hit.code)).not.toContain('dry');
    expect(resolved.median).toBe(29);
    expect(result.carbohydratesG).toBe(58);
  });

  it('rejects instant noodles and spaghetti seasoning mixes for a generic pasta request', () => {
    const hits: SearchHit[] = [
      { code: 'plain', product_name_de: 'Spaghetti gekocht', brands: 'Basis', completeness: 0.8, nutriments: { carbohydrates_100g: 29 } },
      { code: 'instant', product_name_de: 'Instant Nudeln Huhn', brands: 'Snack', completeness: 0.9, nutriments: { carbohydrates_100g: 25 } },
      { code: 'fix', product_name_de: 'Maggi Fix für Spaghetti Bolognese', brands: 'Maggi', completeness: 0.9, nutriments: { carbohydrates_100g: 42 } }
    ];
    const resolved = resolveGenericCandidates('spaghetti', hits, false);
    expect(resolved.hits.map((hit) => hit.code)).toEqual(['plain']);
    expect(resolved.median).toBe(29);
  });

  it('does not calculate dry rice as cooked for an exact product', () => {
    const dryHit: SearchHit = { code: 'dry-rice', product_name_de: 'Langkornreis', countries_tags: ['en:germany'], completeness: 0.9, nutriments: { carbohydrates_100g: 75 } };
    const dryProduct: OffProduct = { code: 'dry-rice', product_name_de: 'Langkornreis', nutriments: { carbohydrates_100g: 75 } };
    const result = buildExactResult(riceRequest, dryHit, dryProduct, null);
    expect(result.status).toBe('not_found');
    expect(result.carbohydratesG).toBeNull();
  });

  it('prefers an explicit prepared nutrient field', () => {
    const hit: SearchHit = {
      code: 'prepared-rice', product_name_de: 'Langkornreis', countries_tags: ['en:germany'], completeness: 0.9,
      nutriments: { carbohydrates_100g: 75, carbohydrates_prepared_100g: 28 }
    };
    const result = buildExactResult(riceRequest, hit, undefined, null);
    expect(result.status).toBe('calculated');
    expect(result.carbohydratesPer100).toBe(28);
    expect(result.carbohydratesG).toBe(56);
  });
});


describe('identity-first candidate ranking', () => {
  it('keeps plain Bifi ahead of Carazza and Roll variants', () => {
    const hits: SearchHit[] = [
      { code: 'carazza', product_name_de: 'Bifi Carazza 3er-Pack', brands: 'Bifi', completeness: 0.9, nutriments: { carbohydrates_100g: 33 } },
      { code: 'plain', product_name_de: 'Bifi', brands: 'Bifi', quantity: '20 g', completeness: 0.7, nutriments: { carbohydrates_100g: 1 } },
      { code: 'roll', product_name_de: 'Bifi Roll', brands: 'Bifi', completeness: 0.9, nutriments: { carbohydrates_100g: 32 } }
    ];
    const ranked = rankExactCandidates('Bifi', hits, false);
    expect(ranked.map((hit) => hit.code)).toEqual(['plain', 'carazza', 'roll']);
  });

  it('does not let Kinder Bueno represent the generic Cookies query', () => {
    const hits: SearchHit[] = [
      { code: 'bueno', product_name_de: 'Kinder Bueno', brands: 'Kinder', categories_tags: ['en:chocolate-nuts-cookie-bars'], completeness: 0.9, nutriments: { carbohydrates_100g: 49.5 } },
      { code: 'cookie', product_name_de: 'Chocolate Mountain Cookies', brands: 'Griesson', completeness: 0.8, nutriments: { carbohydrates_100g: 62 } }
    ];
    const resolved = resolveGenericCandidates('Cookies', hits, false);
    expect(resolved.hits.map((hit) => hit.code)).toEqual(['cookie']);
  });

  it('keeps variants visible but ranks the non-mini exact product first', () => {
    const hits: SearchHit[] = [
      { code: 'mini', product_name_de: 'Chocolate Mountain Cookies Minis', brands: 'Griesson', completeness: 0.9, nutriments: { carbohydrates_100g: 62 } },
      { code: 'standard', product_name_de: 'Chocolate Mountain Cookies', brands: 'Griesson', completeness: 0.8, nutriments: { carbohydrates_100g: 61 } }
    ];
    const ranked = rankExactCandidates('Griesson Chocolate Mountain Cookies', hits, false);
    expect(ranked.map((hit) => hit.code)).toEqual(['standard', 'mini']);
  });

  it('offers a single Bifi package as one editable piece', () => {
    const hit: SearchHit = {
      code: 'bifi', product_name_de: 'Bifi', brands: 'Bifi', quantity: '20 g',
      product_quantity: 20, product_quantity_unit: 'g', nutriments: { carbohydrates_100g: 1 }
    };
    const implicit = request('Bifi', 'Bifi', 1, 'portion', 'exact_product', false);
    const result = buildExactResult(implicit, hit, undefined, null);
    expect(result.status).toBe('calculated');
    expect(result.unit).toBe('piece');
    expect(result.unitWeightG).toBe(20);
  });
});

describe('deterministic missing-unit handling', () => {
  it('never turns 12 Salzstangen into 12 manufacturer portions', () => {
    const hits: SearchHit[] = [
      {
        code: 'salt-1', product_name_de: 'Salzstangen', brands: 'A', completeness: 0.8,
        serving_size: '100 g', serving_quantity: 100,
        nutriments: { carbohydrates_100g: 72 }
      },
      {
        code: 'salt-2', product_name_de: 'Salzstangen', brands: 'B', completeness: 0.8,
        serving_size: '30 g', serving_quantity: 30,
        nutriments: { carbohydrates_100g: 73 }
      },
      {
        code: 'salt-3', product_name_de: 'Salzstangen', brands: 'C', completeness: 0.8,
        nutriments: { carbohydrates_100g: 71 }
      }
    ];
    const resolved = resolveGenericCandidates('Salzstangen', hits, false);
    const result = buildGenericResult(request('12 Salzstangen', 'Salzstangen', 12, 'piece'), resolved, null);
    expect(result.status).toBe('needs_unit_calibration');
    expect(result.unit).toBe('piece');
    expect(result.unitWeightG).toBeNull();
    expect(result.totalMassG).toBeNull();
    expect(result.carbohydratesG).toBeNull();
  });

  it('derives one Salzstange from explicit count plus package weight', () => {
    const hit: SearchHit = {
      code: 'salt-counted', product_name_de: 'Salzstangen', brands: 'A',
      quantity: '75 g (30 Salzstangen)', product_quantity: 75, product_quantity_unit: 'g',
      completeness: 0.9, nutriments: { carbohydrates_100g: 72 }
    };
    const result = buildExactResult(request('12 Salzstangen', 'Salzstangen', 12, 'piece', 'exact_product'), hit, undefined, null);
    expect(result.status).toBe('calculated');
    expect(result.unitWeightG).toBe(2.5);
    expect(result.totalMassG).toBe(30);
    expect(result.carbohydratesG).toBeCloseTo(21.6, 5);
  });

  it('uses a generic piece-weight consensus only from two compatible explicit products', () => {
    const hits: SearchHit[] = [
      {
        code: 'a', product_name_de: 'Salzstangen', brands: 'A', quantity: '50 g (20 Salzstangen)',
        product_quantity: 50, product_quantity_unit: 'g', completeness: 0.9,
        nutriments: { carbohydrates_100g: 72 }
      },
      {
        code: 'b', product_name_de: 'Salzstangen', brands: 'B', quantity: '75 g (30 Salzstangen)',
        product_quantity: 75, product_quantity_unit: 'g', completeness: 0.9,
        nutriments: { carbohydrates_100g: 73 }
      }
    ];
    const resolved = resolveGenericCandidates('Salzstangen', hits, false);
    const result = buildGenericResult(request('12 Salzstangen', 'Salzstangen', 12, 'piece'), resolved, null);
    expect(result.status).toBe('calculated');
    expect(result.unitWeightG).toBe(2.5);
    expect(result.carbohydratesG).toBeCloseTo(21.75, 5);
  });

  it('does not generalize a piece weight from only one branded product', () => {
    const hits: SearchHit[] = [
      {
        code: 'a', product_name_de: 'Salzstangen', brands: 'A', quantity: '50 g (20 Salzstangen)',
        product_quantity: 50, product_quantity_unit: 'g', completeness: 0.9,
        nutriments: { carbohydrates_100g: 72 }
      },
      {
        code: 'b', product_name_de: 'Salzstangen', brands: 'B', completeness: 0.9,
        nutriments: { carbohydrates_100g: 73 }
      }
    ];
    const resolved = resolveGenericCandidates('Salzstangen', hits, false);
    const result = buildGenericResult(request('12 Salzstangen', 'Salzstangen', 12, 'piece'), resolved, null);
    expect(result.status).toBe('needs_unit_calibration');
    expect(result.unitWeightG).toBeNull();
  });

  it('normalizes OFF brand arrays without crashing the product summary', () => {
    const hit: SearchHit = {
      code: '4000000000042', product_name_de: 'Testprodukt', nutriments: { carbohydrates_100g: 20 }
    };
    const product: OffProduct = { ...hit, brands: ['Marke A', 'Marke B'] };
    const result = buildExactResult(
      request('100 g Testprodukt', 'Testprodukt', 100, 'g', 'exact_product'),
      hit,
      product,
      null
    );
    expect(result.product.brand).toBe('Marke A, Marke B');
  });

  it('captures immutable fetched-at and cache-age provenance in calculated results', () => {
    const fetchedAt = '2026-07-12T10:00:00.000Z';
    const hit: SearchHit = {
      code: '4000000000043',
      product_name_de: 'Provenienzprodukt',
      nutriments: { carbohydrates_100g: 20 },
      api_meta: {
        cacheStatus: 'fresh-cache', fetchedAt, sourceUrl: 'index://snapshot', cacheAgeMs: 5_000
      }
    };
    const result = buildExactResult(
      request('100 g Provenienzprodukt', 'Provenienzprodukt', 100, 'g', 'exact_product'),
      hit,
      undefined,
      null
    );
    expect(result.dataFetchedAt).toBe(fetchedAt);
    expect(result.dataCacheAgeMs).toBe(5_000);
  });

  it('rejects adversarial portion edits before producing an invalid result', () => {
    const hit: SearchHit = {
      code: '4000000000044', product_name_de: 'Testprodukt', nutriments: { carbohydrates_100g: 20 }
    };
    const result = buildExactResult(
      request('100 g Testprodukt', 'Testprodukt', 100, 'g', 'exact_product'),
      hit,
      undefined,
      null
    );
    const grams = result.portionOptions.find((option) => option.unit === 'g');
    if (!grams) throw new Error('Gramm-Option fehlt.');
    expect(() => recalculateWithPortion(result, 100_001, grams.id)).toThrow(/ungültig|zu groß/);
    expect(() => buildExactResult(
      request('100 Stück Testprodukt', 'Testprodukt', 100, 'piece', 'exact_product'),
      hit,
      undefined,
      null,
      5_001
    )).toThrow(/Einheitengewicht|Gesamtgewicht/);
  });
});
