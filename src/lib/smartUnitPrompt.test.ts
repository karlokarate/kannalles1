import { describe, expect, it } from 'vitest';
import type { CatalogProduct } from './catalog/catalogDomain';
import { genericCookedProductForQuery } from './genericFoods';
import { calculateCatalogCarbohydrates, resolveCatalogUnits } from './resolution/catalogResolution';
import {
  applySmartUnitPromptDefault,
  createSmartUnitPrompt,
  resolveSmartUnitState,
  updateSmartUnitPromptValue
} from './smartUnitPrompt';

function product(overrides: Partial<CatalogProduct> = {}): CatalogProduct {
  return {
    productId: 1,
    code: '4000000000001',
    displayName: 'Testprodukt',
    brand: 'Test',
    nutrition: { carbohydratesPer100: 50, basis: 'mass', source: 'as_sold' },
    unitEvidence: { manufacturerServing: null, productQuantity: null, provenSmallestUnit: null, defaultUnitKind: 'mass' },
    imageReference: null,
    hasQualityErrors: false,
    rankOrdinal: 1,
    ...overrides
  };
}

describe('smart unit prompts', () => {
  it('uses the editable 200 g default for a requested generic portion', () => {
    const noodles = genericCookedProductForQuery('Nudeln');
    expect(noodles).not.toBeNull();
    if (!noodles) throw new Error('expected built-in cooked noodles');
    const request = { amount: 1, unit: 'portion' as const, unitExplicit: true };
    const state = resolveSmartUnitState(noodles, request, resolveCatalogUnits(noodles, request));
    expect(state.prompt).toMatchObject({ mode: 'unit-weight', value: '200', baseValueG: 200 });
    expect(state.resolution.options[0]).toMatchObject({ unit: 'portion', source: 'unresolved', baseValue: 200 });
    expect(state.resolution.options[0]?.id).toContain('editable_default');
    const calculation = calculateCatalogCarbohydrates(noodles, request, state.resolution);
    expect(calculation.totalMassG).toBe(200);
    expect(calculation.carbohydratesG).toBeCloseTo(57.36, 10);
  });

  it('derives two pizza pieces from an editable eight-piece whole-pizza split', () => {
    const pizza = product({
      displayName: 'Pizza Salami',
      nutrition: { carbohydratesPer100: 20, basis: 'mass', source: 'as_sold' },
      unitEvidence: { manufacturerServing: null, productQuantity: { baseValue: 400, basis: 'mass' }, provenSmallestUnit: null, defaultUnitKind: 'mass' }
    });
    const request = { amount: 2, unit: 'piece' as const, unitExplicit: true };
    const state = resolveSmartUnitState(pizza, request, resolveCatalogUnits(pizza, request));
    expect(state.prompt).toMatchObject({ mode: 'whole-split', value: '8', wholeWeightG: 400, baseValueG: 50 });
    expect(calculateCatalogCarbohydrates(pizza, request, state.resolution).carbohydratesG).toBe(20);
    if (!state.prompt) throw new Error('expected a pizza split prompt');
    const sixPieces = updateSmartUnitPromptValue(state.prompt, '6');
    const sixPieceResolution = applySmartUnitPromptDefault(resolveCatalogUnits(pizza, request), sixPieces);
    expect(calculateCatalogCarbohydrates(pizza, request, sixPieceResolution).carbohydratesG).toBeCloseTo(26.666666666666668, 12);
  });

  it('does not ask again when Kinder Bueno already has a proven bar', () => {
    const bueno = product({
      displayName: 'Kinder Bueno',
      unitEvidence: {
        manufacturerServing: { baseValue: 43, basis: 'mass' },
        productQuantity: { baseValue: 172, basis: 'mass' },
        provenSmallestUnit: { baseValue: 21.5, basis: 'mass', unitKind: 'bar', source: 'explicit_multipack_quantity', smallestEdibleUnit: true },
        defaultUnitKind: 'bar'
      }
    });
    const request = { amount: 2, unit: 'bar' as const, unitExplicit: true };
    expect(createSmartUnitPrompt(bueno, request, resolveCatalogUnits(bueno, request))).toBeNull();
  });

  it('does not ask again when Schoko-Bons already has a proven piece', () => {
    const bons = product({
      displayName: 'Kinder Schoko-Bons',
      unitEvidence: {
        manufacturerServing: { baseValue: 6, basis: 'mass' },
        productQuantity: { baseValue: 200, basis: 'mass' },
        provenSmallestUnit: { baseValue: 6, basis: 'mass', unitKind: 'piece', source: 'explicit_serving_count', smallestEdibleUnit: true },
        defaultUnitKind: 'piece'
      }
    });
    const request = { amount: 4, unit: 'piece' as const, unitExplicit: true };
    expect(createSmartUnitPrompt(bons, request, resolveCatalogUnits(bons, request))).toBeNull();
  });

  it('does not ask again for an existing manufacturer portion', () => {
    const cereal = product({
      displayName: 'Müsli',
      unitEvidence: {
        manufacturerServing: { baseValue: 45, basis: 'mass' },
        productQuantity: { baseValue: 500, basis: 'mass' },
        provenSmallestUnit: null,
        defaultUnitKind: 'portion'
      }
    });
    const request = { amount: 1, unit: 'portion' as const, unitExplicit: true };
    expect(createSmartUnitPrompt(cereal, request, resolveCatalogUnits(cereal, request))).toBeNull();
  });

  it('asks for a missing piece weight without inventing a default', () => {
    const unknown = product({ displayName: 'Unbekannter Snack' });
    const request = { amount: 3, unit: 'piece' as const, unitExplicit: true };
    const prompt = createSmartUnitPrompt(unknown, request, resolveCatalogUnits(unknown, request));
    expect(prompt).toMatchObject({ mode: 'unit-weight', value: '', baseValueG: null });
  });

  it('never asks for direct grams', () => {
    const direct = product();
    const request = { amount: 200, unit: 'g' as const, unitExplicit: true };
    expect(createSmartUnitPrompt(direct, request, resolveCatalogUnits(direct, request))).toBeNull();
  });
});
