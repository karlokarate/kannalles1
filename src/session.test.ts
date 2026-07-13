import { describe, expect, it } from 'vitest';
import { parseCatalogQuery } from './app/queryParser';
import {
  autoSelectionEligibility,
  toResolutionProduct
} from './app/catalogViewModel';
import type { CatalogSearchHit } from './lib/catalog/catalogDomain';
import {
  decodeSearchSession,
  encodeSearchSession,
  type SearchSessionSnapshot
} from './lib/userDataStore';

const hit: CatalogSearchHit = {
  productId: 1,
  code: '4008400322728',
  displayName: 'Kinder Bueno',
  brand: 'Kinder',
  carbohydratesPer100: 49.5,
  nutritionBasis: 'mass',
  nutritionSource: 'as_sold',
  manufacturerServing: { value: 43, basis: 'mass' },
  productQuantity: { value: 172, basis: 'mass' },
  provenUnit: {
    value: 21.5,
    basis: 'mass',
    kind: 'bar',
    source: 'explicit_multipack_quantity',
    countability: 'countable',
    smallestEdibleUnit: true,
    proven: true
  },
  defaultUnitKind: 'bar',
  image: null,
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
  });

  it('projects only structured catalog evidence into the resolver boundary', () => {
    const projected = toResolutionProduct(hit);
    expect(projected.unitEvidence).toEqual({
      baseValue: 21.5,
      basis: 'mass',
      unitKind: 'bar',
      source: 'explicit-multipack-quantity'
    });
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
});
