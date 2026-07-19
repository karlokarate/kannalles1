import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CatalogProduct } from '../lib/catalog/catalogDomain';
import {
  catalogCalibrationLookupKeys,
  createCatalogCalibration
} from '../lib/resolution/catalogCalibration';
import type {
  CatalogCalibrationIdentity,
  CatalogCalibrationUnit,
  CatalogUnitCalibration
} from '../lib/resolution/catalogCalibration';
import { calculateCatalogCarbohydrates } from '../lib/resolution/catalogResolution';

const storeMocks = vi.hoisted(() => ({
  findMatchingCatalogCalibrations: vi.fn()
}));

vi.mock('../lib/userDataStore', () => ({
  findMatchingCatalogCalibrations: storeMocks.findMatchingCatalogCalibrations
}));

import {
  catalogCalibrationIdentity,
  catalogPersonalDefaultUnitRequest,
  resolveCatalogUnitRuntime
} from './catalogUnitRuntime';

function saltSticks(): CatalogProduct {
  return {
    productId: 1,
    code: '20005627',
    displayName: 'Salzstangen',
    brand: 'Snack Day',
    nutrition: { carbohydratesPer100: 72, basis: 'mass', source: 'as_sold' },
    unitEvidence: {
      manufacturerServing: null,
      productQuantity: { baseValue: 250, basis: 'mass' },
      provenSmallestUnit: null,
      defaultUnitKind: 'mass'
    },
    imageReference: null,
    hasQualityErrors: false,
    rankOrdinal: 1
  };
}

function personalPortion(product: CatalogProduct): CatalogUnitCalibration {
  const record = createCatalogCalibration({
    calibrationId: 'personal-portion-0-4',
    scope: 'catalog-product',
    identity: catalogCalibrationIdentity(product),
    unit: 'portion',
    measuredCount: 10,
    measuredTotalWeightG: 4,
    smallestEdibleUnit: false,
    now: '2026-07-19T12:00:00.000Z'
  });
  if (!record) throw new Error('personal calibration expected');
  return record;
}

function useCalibrations(records: readonly CatalogUnitCalibration[]): void {
  storeMocks.findMatchingCatalogCalibrations.mockImplementation((
    identity: CatalogCalibrationIdentity,
    unit: CatalogCalibrationUnit,
    allowGenericScope = false
  ): CatalogUnitCalibration[] => {
    const keys = catalogCalibrationLookupKeys(identity, unit, allowGenericScope);
    const order = new Map(keys.map((key, index) => [key, index]));
    return records
      .filter((record) => record.active && order.has(record.scopeKey))
      .sort((left, right) =>
        (order.get(left.scopeKey) ?? 99) - (order.get(right.scopeKey) ?? 99)
        || right.measurement.measuredCount - left.measurement.measuredCount
        || right.updatedAt.localeCompare(left.updatedAt)
      );
  });
}

beforeEach(() => {
  storeMocks.findMatchingCatalogCalibrations.mockReset();
  useCalibrations([]);
});

describe('personal standard unit runtime', () => {
  it('maps an implicit-unit amount to the saved personal portion', () => {
    const product = saltSticks();
    useCalibrations([personalPortion(product)]);

    expect(catalogPersonalDefaultUnitRequest(product, 13)).toEqual({
      amount: 13,
      unit: 'portion',
      unitExplicit: false
    });
  });

  it('calculates 13 saved portions with 0.4 grams per portion', () => {
    const product = saltSticks();
    useCalibrations([personalPortion(product)]);
    const request = catalogPersonalDefaultUnitRequest(product, 13);
    if (!request) throw new Error('personal default request expected');

    const state = resolveCatalogUnitRuntime(product, request);
    expect(state.resolution).toMatchObject({
      status: 'resolved',
      reason: 'calibration-preferred'
    });
    expect(state.resolution.options[0]).toMatchObject({
      unit: 'portion',
      source: 'user_calibration',
      baseValue: 0.4,
      recommended: true
    });

    expect(calculateCatalogCarbohydrates(
      product,
      request,
      state.resolution
    )).toMatchObject({
      amount: 13,
      unit: 'portion',
      unitBaseValue: 0.4,
      totalMassG: 5.2,
      carbohydratesG: 3.744
    });
  });

  it('does not override an explicit gram request', () => {
    const product = saltSticks();
    useCalibrations([personalPortion(product)]);
    const request = { amount: 13, unit: 'g' as const, unitExplicit: true };
    const state = resolveCatalogUnitRuntime(product, request);

    expect(state.resolution.options[0]).toMatchObject({
      unit: 'g',
      source: 'direct_mass',
      baseValue: 1,
      recommended: true
    });
    expect(calculateCatalogCarbohydrates(product, request, state.resolution))
      .toMatchObject({ totalMassG: 13, carbohydratesG: 9.36 });
  });

  it('returns no personal default when no calibration matches', () => {
    expect(catalogPersonalDefaultUnitRequest(saltSticks(), 13)).toBeNull();
  });
});
