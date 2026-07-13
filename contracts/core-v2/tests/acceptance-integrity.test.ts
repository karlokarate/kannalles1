import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OffProduct, ParsedFoodRequest, SearchHit } from '../../../src/types';
import type { CatalogProductRecord } from '../../../src/lib/catalog/catalogProtocol';

vi.mock('../../../src/lib/catalog/catalogClient', () => ({
  searchOfflineCatalog: vi.fn(),
  getOfflineCatalogProduct: vi.fn(),
  cancelOfflineCatalogRequests: vi.fn()
}));

import {
  getOfflineCatalogProduct,
  searchOfflineCatalog
} from '../../../src/lib/catalog/catalogClient';
import {
  cancelPendingApiRequests,
  clearApiGovernor,
  searchFoodCandidatesOutcome
} from '../../../src/lib/api';
import {
  calibrationLookupKeys,
  createPieceCalibration,
  deriveGroupCalibration
} from '../../../src/lib/calibration';
import {
  buildExactResult,
  buildGenericResult,
  resolveGenericCandidates
} from '../../../src/lib/resolver';
import {
  clearCalibrations,
  findCalibration,
  saveCalibration
} from '../../../src/lib/storage';

const suite = JSON.parse(readFileSync(new URL('./acceptance-cases.json', import.meta.url), 'utf8')) as {
  suite: string;
  version: string;
  cases: Array<{ id: string; given: Record<string, unknown>; expect: Record<string, unknown> }>;
};
const byId = new Map(suite.cases.map((entry) => [entry.id, entry]));

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, String(value)); }
}

function request(
  rawInput: string,
  productName: string,
  amount: number,
  unit: ParsedFoodRequest['amount']['unit'],
  explicit = true
): ParsedFoodRequest {
  return {
    status: 'parsed', rawInput,
    product: { name: productName, brand: null, variant: null },
    amount: { value: amount, unit, valueExplicit: explicit, unitExplicit: explicit },
    resolutionMode: 'exact_product', barcode: null,
    clarificationQuestion: null, parser: 'local'
  };
}

const buenoHit: SearchHit = {
  code: '4008400321622', product_name_de: 'Kinder Bueno', brands: 'Kinder',
  nutriments: { carbohydrates_100g: 49.5 }
};

const catalogBueno: CatalogProductRecord = {
  code: '4008400321622',
  name: 'Kinder Bueno',
  brand: 'Kinder',
  carbohydratesPer100: 49.5,
  carbohydrateBasis: 'mass',
  carbohydrateSourcePrepared: false,
  servingValue: 43,
  servingBasis: 'mass',
  productQuantityValue: 43,
  productQuantityBasis: 'mass',
  provenUnitValue: 21.5,
  provenUnitKind: 'bar',
  provenUnitSource: 'explicitServingCount',
  provenUnitBasis: 'mass',
  defaultUnitKind: 'bar',
  imageUrl: null,
  hasQualityErrors: false,
  rankOrdinal: 1000
};

beforeEach(async () => {
  vi.stubGlobal('localStorage', new MemoryStorage());
  vi.stubGlobal('indexedDB', undefined);
  vi.mocked(searchOfflineCatalog).mockReset();
  vi.mocked(getOfflineCatalogProduct).mockReset();
  cancelPendingApiRequests();
  clearApiGovernor();
  await clearCalibrations();
});

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  cancelPendingApiRequests();
  clearApiGovernor();
  await clearCalibrations();
});

describe('normative v2 acceptance cases bound to production code', () => {
  it('binds every stable case id exactly once', () => {
    const bound = [
      'search-primary-fails-fallback-succeeds',
      'search-all-fail-stale-cache',
      'search-all-fail-no-cache',
      'kinder-bueno-default-single-bar',
      'explicit-unit-never-replaced',
      'group-weighing-derivation',
      'saved-calibration-reused',
      'current-nutrition-replaces-snapshot',
      'calibration-does-not-cross-package-boundary',
      'nutella-not-forced-to-piece'
    ];
    expect(suite.suite).toBe('kh-checker-core-acceptance');
    expect(suite.version).toBe('2.1.0');
    expect(bound.sort()).toEqual(suite.cases.map((entry) => entry.id).sort());
  });

  it('[search-primary-fails-fallback-succeeds] resolves from the local catalog with zero product-network requests', async () => {
    const fixture = byId.get('search-primary-fails-fallback-succeeds');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    vi.mocked(searchOfflineCatalog).mockResolvedValue([catalogBueno]);

    const outcome = await searchFoodCandidatesOutcome('Kinder Bueno', 10);

    expect(outcome.status).toBe(fixture?.expect.status);
    expect(outcome.candidates).toHaveLength(1);
    expect(outcome.diagnostics.networkAttempted).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(fixture?.expect.networkRequests as number);
  });

  it('[search-all-fail-stale-cache] remains available offline because the installed catalog is authoritative', async () => {
    const fixture = byId.get('search-all-fail-stale-cache');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    vi.mocked(searchOfflineCatalog).mockResolvedValue([catalogBueno]);

    const outcome = await searchFoodCandidatesOutcome('Kinder Bueno', 10);

    expect(outcome.status).not.toBe(fixture?.expect.statusNot);
    expect(outcome.diagnostics.cacheStatus).toBe(fixture?.expect.cacheStatus);
    expect(fetchMock).toHaveBeenCalledTimes(fixture?.expect.networkRequests as number);
  });

  it('[search-all-fail-no-cache] maps catalog integrity failure to an immediately retryable typed state', async () => {
    const fixture = byId.get('search-all-fail-no-cache');
    vi.mocked(searchOfflineCatalog).mockRejectedValue(
      Object.assign(new Error('SQLite quick_check fehlgeschlagen'), { code: 'CATALOG_INTEGRITY_FAILED' })
    );

    const outcome = await searchFoodCandidatesOutcome('No-cache acceptance', 10);

    expect(outcome.status).toBe(fixture?.expect.status);
    expect(outcome.diagnostics.retryAllowedImmediately).toBe(fixture?.expect.retryAllowedImmediately);
    expect(outcome.diagnostics.networkAttempted).toBe(false);
    expect(outcome.diagnostics).not.toHaveProperty('localCountdown');
  });

  it('[kinder-bueno-default-single-bar] selects the proven smallest bar first', () => {
    const fixture = byId.get('kinder-bueno-default-single-bar');
    const product: OffProduct = {
      ...buenoHit,
      quantity: '2 x 21.5 g', product_quantity: 43, product_quantity_unit: 'g',
      serving_size: '1 Riegel (21.5 g)', serving_quantity: 21.5,
      categories_tags: ['kh-catalog-unit-bar']
    };
    const result = buildExactResult(request('Kinder Bueno', 'Kinder Bueno', 1, 'portion', false), buenoHit, product, null);
    expect(result.unit).toBe(fixture?.expect.selectedUnit);
    expect(result.unitWeightG).toBe(fixture?.expect.unitWeightG);
    expect(result.carbohydratesG).toBeCloseTo(fixture?.expect.carbsPerUnitG as number, 8);
    expect(result.portionOptions[0]?.unit).toBe(fixture?.expect.firstSelectorOption);
    expect(result.portionOptions.some((option) => option.unit === 'package')).toBe(fixture?.expect.packageStillAvailable);
  });

  it('[explicit-unit-never-replaced] preserves an unresolved explicit piece', () => {
    const fixture = byId.get('explicit-unit-never-replaced');
    const hits: SearchHit[] = [
      { code: 'a', product_name_de: 'Salzstangen', brands: 'A', completeness: 0.8, serving_size: '30 g', serving_quantity: 30, nutriments: { carbohydrates_100g: 72 } },
      { code: 'b', product_name_de: 'Salzstangen', brands: 'B', completeness: 0.8, serving_size: '30 g', serving_quantity: 30, nutriments: { carbohydrates_100g: 73 } },
      { code: 'c', product_name_de: 'Salzstangen', brands: 'C', completeness: 0.8, nutriments: { carbohydrates_100g: 71 } }
    ];
    const explicitRequest = request('12 Salzstangen', 'Salzstangen', 12, 'piece');
    const result = buildGenericResult(
      { ...explicitRequest, resolutionMode: 'generic_category' },
      resolveGenericCandidates('Salzstangen', hits, false),
      null
    );
    expect(result.status).toBe(fixture?.expect.status);
    expect(result.unit).toBe(fixture?.expect.selectedUnit);
    expect(result.carbohydratesG).toBe(fixture?.expect.totalCarbsG);
  });

  it('[group-weighing-derivation] derives without premature rounding', () => {
    const fixture = byId.get('group-weighing-derivation');
    const given = fixture?.given as {
      requestedAmount: number; measuredCount: number; measuredTotalWeightG: number; carbohydratesPer100g: number
    };
    const result = deriveGroupCalibration(
      given.measuredCount, given.measuredTotalWeightG, given.requestedAmount, given.carbohydratesPer100g
    );
    expect(result?.unitWeightG).toBeCloseTo(fixture?.expect.unitWeightG as number, 10);
    expect(result?.carbsPerUnitG).toBeCloseTo(fixture?.expect.carbsPerUnitG as number, 10);
    expect(result?.requestedTotalWeightG).toBeCloseTo(fixture?.expect.requestedTotalWeightG as number, 10);
    expect(result?.requestedTotalCarbsG).toBeCloseTo(fixture?.expect.requestedTotalCarbsG as number, 10);
  });

  it('[saved-calibration-reused] persists, resolves and injects the barcode calibration first', async () => {
    const fixture = byId.get('saved-calibration-reused');
    const calibration = createPieceCalibration({
      productName: 'Salzstangen', barcode: '12345678', unit: 'piece',
      measuredCount: 10, measuredTotalWeightG: 24, carbohydratesPer100g: 72
    });
    expect(calibration).not.toBeNull();
    if (!calibration) return;
    await saveCalibration(calibration);
    const restored = await findCalibration({
      productName: 'Salzstangen', barcode: '12345678', unit: 'piece', allowGenericScope: true
    });
    const hit: SearchHit = {
      code: '12345678', product_name_de: 'Salzstangen', nutriments: { carbohydrates_100g: 73 }
    };
    const result = buildExactResult(request('1 Salzstange', 'Salzstangen', 1, 'piece'), hit, undefined, restored);
    expect(result.portionOptions[0]?.source).toBe(fixture?.expect.firstSelectorOptionSource);
    expect(result.unitWeightG).toBe(fixture?.expect.unitWeightG);
    expect(result.carbohydratesG).toBeCloseTo(fixture?.expect.carbsPerUnitG as number, 8);
  });

  it('[current-nutrition-replaces-snapshot] combines saved weight with current nutrition', () => {
    const fixture = byId.get('current-nutrition-replaces-snapshot');
    const calibration = createPieceCalibration({
      productName: 'Kinder Bueno', barcode: '4008400321622', unit: 'bar',
      measuredCount: 2, measuredTotalWeightG: 43, carbohydratesPer100g: 49.5
    });
    const hit = { ...buenoHit, nutriments: { carbohydrates_100g: 50 } };
    const result = buildExactResult(request('1 Riegel Kinder Bueno', 'Kinder Bueno', 1, 'bar'), hit, undefined, calibration);
    expect(result.unitWeightG).toBe(fixture?.expect.authoritativeWeightG);
    expect(result.carbohydratesG).toBe(fixture?.expect.carbsPerUnitG);
  });

  it('[calibration-does-not-cross-package-boundary] produces no package lookup key', () => {
    const fixture = byId.get('calibration-does-not-cross-package-boundary');
    const keys = calibrationLookupKeys({
      productName: 'Salzstangen', barcode: '12345678', unit: 'package', allowGenericScope: true
    });
    expect(keys.length > 0).toBe(fixture?.expect.calibrationApplied);
  });

  it('[nutella-not-forced-to-piece] keeps the manufacturer portion editable', () => {
    const fixture = byId.get('nutella-not-forced-to-piece');
    const hit: SearchHit = {
      code: 'nutella', product_name_de: 'Nutella', nutriments: { carbohydrates_100g: 57.5 }
    };
    const product: OffProduct = {
      ...hit, quantity: '450 g', product_quantity: 450, product_quantity_unit: 'g',
      serving_size: '15 g', serving_quantity: 15
    };
    const result = buildExactResult(request('Nutella', 'Nutella', 1, 'portion', false), hit, product, null);
    expect(result.unit).toBe(fixture?.expect.selectedUnit);
    expect(result.unitWeightG).toBe(fixture?.expect.selectedWeightG);
    expect(result.status === 'needs_unit_calibration').toBe(fixture?.expect.needsUnitCalibration);
  });
});
