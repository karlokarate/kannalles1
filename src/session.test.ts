import { describe, expect, it } from 'vitest';
import { parseCatalogQuery, parseProductList, parseSpokenProductList } from './app/queryParser';
import { autoSelectionEligibility, catalogProductImageUrl, selectDefaultCatalogCandidate } from './app/catalogViewModel';
import type { CatalogSearchHit } from './lib/catalog/catalogDomain';
import { catalogProductEligibility } from './lib/resolution/catalogResolution';
import {
  decodeSearchSession,
  decodeMealCalculation,
  encodeMealCalculation,
  encodeSearchSession,
  type SavedMealCalculation,
  type SearchSessionSnapshot
} from './lib/userDataStore';

const hit: CatalogSearchHit = {
  productId: 1,
  code: '4008400322728',
  displayName: 'Kinder Bueno',
  brand: 'Kinder',
  nutrition: { carbohydratesPer100: 49.5, basis: 'mass', source: 'as_sold' },
  unitEvidence: {
    manufacturerServing: { baseValue: 43, basis: 'mass' },
    productQuantity: { baseValue: 172, basis: 'mass' },
    provenSmallestUnit: {
      baseValue: 21.5,
      basis: 'mass',
      unitKind: 'bar',
      source: 'explicit_multipack_quantity',
      smallestEdibleUnit: true
    },
    defaultUnitKind: 'bar'
  },
  imageReference: null,
  hasQualityErrors: false,
  rankOrdinal: 7,
  resultIndex: 0
};

describe('Lumen hard-cutover state', () => {
  it('parses explicit amount and unit without remote AI', () => {
    expect(parseCatalogQuery('3 Riegel Kinder Bueno')).toMatchObject({
      catalogQuery: 'Kinder Bueno',
      amount: 3,
      amountExplicit: true,
      unit: 'bar',
      unitExplicit: true,
      barcode: null
    });
    expect(parseCatalogQuery('4008400322728')).toMatchObject({
      barcode: '4008400322728',
      amount: 1,
      unitExplicit: false
    });
    expect(parseCatalogQuery('zwei Scheiben Mehrkornbrot')).toMatchObject({ amount: 2, unit: 'slice', catalogQuery: 'Mehrkornbrot' });
    expect(parseCatalogQuery('2 Scheiben Mehrkornbrot')).toMatchObject({ amount: 2, unit: 'slice', catalogQuery: 'Mehrkornbrot' });
    expect(parseCatalogQuery('zwei Stücke Pizza')).toMatchObject({ amount: 2, unit: 'piece', catalogQuery: 'Pizza' });
    expect(parseCatalogQuery('eine Sprite')).toMatchObject({ amount: 1, amountExplicit: true, catalogQuery: 'Sprite' });
    expect(parseSpokenProductList('2 Scheiben Mehrkornbrot mit 20 g Nutella und eine Sprite')).toEqual(['2 Scheiben Mehrkornbrot', '20 g Nutella', 'eine Sprite']);
    expect(parseProductList('2 Scheiben Mehrkornbrot mit Nutella und 400 ml Sprite')).toEqual(['2 Scheiben Mehrkornbrot', 'Nutella', '400 ml Sprite']);
    expect(parseProductList('zwei Scheiben Mehrkornbrot mit Nutella und 400 Milliliter Sprite')).toEqual(['zwei Scheiben Mehrkornbrot', 'Nutella', '400 Milliliter Sprite']);
    expect(parseProductList('zwei Stücke Pizza und eine Portion Nudeln')).toEqual(['zwei Stücke Pizza', 'eine Portion Nudeln']);
    expect(parseCatalogQuery('400 ml Sprite')).toMatchObject({ amount: 400, unit: 'ml', catalogQuery: 'Sprite' });
  });

  it('preserves German decimal commas while still accepting list commas', () => {
    expect(parseProductList('0,5 kg Nutella')).toEqual(['0,5 kg Nutella']);
    expect(parseCatalogQuery('0,5 kg Nutella')).toMatchObject({
      amount: 0.5,
      amountExplicit: true,
      unit: 'kg',
      unitExplicit: true,
      catalogQuery: 'Nutella'
    });
    expect(parseProductList('0,5 kg Nutella, 200 ml Milch')).toEqual([
      '0,5 kg Nutella',
      '200 ml Milch'
    ]);
    expect(parseProductList('1,25 Portionen Nudeln; 0,33 l Cola')).toEqual([
      '1,25 Portionen Nudeln',
      '0,33 l Cola'
    ]);
  });

  it('does not split connector words inside an exact clinic product name', () => {
    expect(parseProductList('100 g Pfannkuchen mit Quark')).toEqual([
      '100 g Pfannkuchen mit Quark'
    ]);
    expect(parseCatalogQuery('100 g Pfannkuchen mit Quark')).toMatchObject({
      amount: 100,
      unit: 'g',
      unitExplicit: true,
      catalogQuery: 'Pfannkuchen mit Quark'
    });
    expect(parseProductList('Pfannkuchen mit Quark und eine Portion Reis')).toEqual([
      'Pfannkuchen',
      'Quark',
      'eine Portion Reis'
    ]);
  });

  it('uses the frozen structured catalog evidence directly at the resolver boundary', () => {
    expect(hit.unitEvidence.provenSmallestUnit).toEqual({
      baseValue: 21.5,
      basis: 'mass',
      unitKind: 'bar',
      source: 'explicit_multipack_quantity',
      smallestEdibleUnit: true
    });
    expect(catalogProductEligibility(hit).eligible).toBe(true);
  });

  it('keeps auto-selection eligibility separate from visible SQLite order', () => {
    expect(autoSelectionEligibility(hit, 'Kinder Bueno', true, 4)).toMatchObject({
      eligible: false,
      exactNameMatch: true,
      reason: 'choice-required'
    });
    expect(autoSelectionEligibility(hit, 'Bueno', true, 4)).toMatchObject({
      eligible: false,
      reason: 'choice-required'
    });
  });

  it('defaults to a proven regular bar with an image without preferring the lighter mini', () => {
    const imageReference = { keyId: 1, key: 'front_de', revision: 3, resolution: 400 };
    const regular = { ...hit, imageReference, resultIndex: 1 };
    const mini = { ...hit, productId: 2, displayName: 'Kinder Bueno Mini', imageReference, unitEvidence: { ...hit.unitEvidence, provenSmallestUnit: { baseValue: 10, basis: 'mass' as const, unitKind: 'bar' as const, source: 'explicit_multipack_quantity' as const, smallestEdibleUnit: true as const } }, resultIndex: 0 };
    expect(selectDefaultCatalogCandidate([mini, regular], 'Kinder Bueno', [true, true])).toBe(regular);
    expect(catalogProductImageUrl(regular)).toContain('/400/840/032/2728/front_de.3.400.jpg');
  });

  it('falls back to the first eligible SQLite-ranked result for an immediate default', () => {
    const second = { ...hit, productId: 2, resultIndex: 1 };
    expect(selectDefaultCatalogCandidate([hit, second], 'Bueno', [true, true])).toBe(hit);
  });

  it('persists only a minimal versioned session snapshot', () => {
    const snapshot: SearchSessionSnapshot = {
      schemaVersion: 2,
      query: 'Kinder Bueno',
      selectedProductCode: hit.code,
      amount: 3,
      unit: 'bar',
      activeSection: 'calculator',
      manualMode: false,
      savedAt: '2026-07-13T18:30:00.000Z'
    };
    const encoded = encodeSearchSession(snapshot);
    expect(encoded).not.toContain('carbohydratesPer100');
    expect(encoded).not.toContain('provenUnit');
    expect(decodeSearchSession(encoded)).toEqual(snapshot);
    expect(decodeSearchSession('{"schemaVersion":1}')).toBeNull();
  });

  it('validates reusable multi-product calculations at the persistence boundary', () => {
    const snapshot: SavedMealCalculation = {
      schemaVersion: 1,
      id: 'meal-1',
      createdAt: '2026-07-14T06:00:00.000Z',
      items: [{ id: 'line-1', productCode: hit.code, productName: hit.displayName, amount: 2, unit: 'bar', selectedOptionId: 'bar:evidence', unitBaseValue: 21.5, carbohydratesG: 21.285 }],
      totalCarbohydratesG: 21.285
    };
    expect(decodeMealCalculation(encodeMealCalculation(snapshot))).toEqual(snapshot);
    expect(decodeMealCalculation('{"schemaVersion":1,"items":[]}')).toBeNull();
  });
});
