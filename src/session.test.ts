import { describe, expect, it } from 'vitest';
import {
  decodeSearchSession,
  deriveCalibrationValues,
  encodeSearchSession,
  type SearchSessionSnapshot
} from './lib/userDataStore';
import {
  catalogSearchReducer,
  createCatalogIssue,
  createCatalogSearchState
} from './lib/searchState';

const product = {
  code: '4008400322728',
  name: 'Kinder Bueno',
  brand: 'Kinder',
  carbohydratesPer100: 49.5,
  carbohydrateBasis: 'mass',
  carbohydrateSourcePrepared: false,
  servingValue: 43,
  servingBasis: 'mass',
  productQuantityValue: 172,
  productQuantityBasis: 'mass',
  provenUnitValue: 21.5,
  provenUnitKind: 'bar',
  provenUnitSource: 'explicitMultipackQuantity',
  provenUnitBasis: 'mass',
  defaultUnitKind: 'bar',
  imageUrl: null,
  hasQualityErrors: false,
  rankOrdinal: 0
} as const;

describe('offline session and search state', () => {
  it('stores only minimal local session fields and rejects incompatible payloads', () => {
    const snapshot: SearchSessionSnapshot = {
      schemaVersion: 1,
      query: 'Kinder Bueno',
      selectedProductCode: product.code,
      amount: 1,
      unitKind: 'bar',
      activeSection: 'calculator',
      savedAt: '2026-07-13T18:00:00.000Z'
    };
    const encoded = encodeSearchSession(snapshot);
    expect(encoded).not.toContain('carbohydratesPer100');
    expect(encoded).not.toContain('imageUrl');
    expect(decodeSearchSession(encoded)).toEqual(snapshot);
    expect(decodeSearchSession('{"schemaVersion":2}')).toBeNull();
  });

  it('keeps the ordered catalog candidate list unchanged', () => {
    const second = { ...product, code: '4008400322735', rankOrdinal: 1 };
    const state = catalogSearchReducer(createCatalogSearchState(), {
      type: 'choose',
      query: 'Kinder Bueno',
      candidates: [product, second]
    });
    expect(state.phase).toBe('needs_product_choice');
    expect(state.candidates.map((candidate) => candidate.code)).toEqual([
      product.code,
      second.code
    ]);
  });

  it('represents missing unit evidence as calibration instead of a guessed result', () => {
    const issue = createCatalogIssue(
      'calibration',
      'Einheit wiegen',
      'Für einen Riegel ist kein belegtes Gewicht vorhanden.',
      'missing_proven_unit_weight'
    );
    const state = catalogSearchReducer(createCatalogSearchState(), {
      type: 'needs-calibration',
      product: { ...product, provenUnitValue: null },
      issue
    });
    expect(state.phase).toBe('needs_unit_calibration');
    expect(state.issue?.retryAllowedImmediately).toBe(true);
  });

  it('derives group calibration without rounding and recomputes current carbs', () => {
    const derived = deriveCalibrationValues(8, 172, 3, 49.5);
    expect(derived?.unitWeightG).toBe(21.5);
    expect(derived?.carbsPerUnitG).toBe(10.6425);
    expect(derived?.requestedTotalCarbsG).toBe(31.9275);
  });
});
