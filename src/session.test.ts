import { describe, expect, it } from 'vitest';
import { parseCatalogQuery } from './app/queryParser';
import { autoSelectionEligibility, catalogProductImageUrl, selectDefaultCatalogCandidate } from './app/catalogViewModel';
import type { CatalogSearchHit } from './lib/catalog/catalogDomain';
import { catalogProductEligibility } from './lib/resolution/catalogResolution';
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
