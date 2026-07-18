import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CatalogProduct } from '../lib/catalog/catalogDomain';
import type { ClinicCatalogProduct } from '../lib/clinicCatalog';
import { genericCookedProductForQuery } from '../lib/genericFoods';
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
import type { CatalogUnitRequest } from '../lib/resolution/catalogResolution';

const storeMocks = vi.hoisted(() => ({
  findMatchingCatalogCalibrations: vi.fn()
}));

vi.mock('../lib/userDataStore', () => ({
  findMatchingCatalogCalibrations: storeMocks.findMatchingCatalogCalibrations
}));

import {
  catalogCalibrationForUnit,
  catalogCalibrationIdentity,
  defaultClinicCatalogUnitRequest,
  normalizeCatalogUnitRequest,
  resolveCatalogUnitRuntime
} from './catalogUnitRuntime';

function product(overrides: Partial<CatalogProduct> = {}): CatalogProduct {
  return {
    productId: 1,
    code: '4008400322728',
    displayName: 'Testprodukt',
    brand: 'Testmarke',
    nutrition: { carbohydratesPer100: 50, basis: 'mass', source: 'as_sold' },
    unitEvidence: {
      manufacturerServing: null,
      productQuantity: null,
      provenSmallestUnit: null,
      defaultUnitKind: 'mass'
    },
    imageReference: null,
    hasQualityErrors: false,
    rankOrdinal: 0,
    ...overrides
  };
}

function clinicProduct(input: {
  directCarbohydratesPerUnit?: number | null;
  referenceAmount?: number;
  referenceUnit?: 'g' | 'ml' | 'piece';
} = {}): ClinicCatalogProduct {
  const direct = input.directCarbohydratesPerUnit === undefined ? 19 : input.directCarbohydratesPerUnit;
  const referenceUnit = input.referenceUnit ?? (direct === null ? 'g' : 'piece');
  const referenceAmount = input.referenceAmount ?? (referenceUnit === 'piece' ? 1 : 100);
  const basis = referenceUnit === 'ml' ? 'volume' : 'mass';
  return {
    ...product({
      productId: -2_000_001,
      code: 'clinic:test-product',
      displayName: 'Klinik-Testprodukt',
      brand: 'Klinikum Leverkusen',
      nutrition: {
        carbohydratesPer100: direct ?? 66,
        basis,
        source: 'prepared'
      },
      unitEvidence: direct === null
        ? {
            manufacturerServing: null,
            productQuantity: null,
            provenSmallestUnit: null,
            defaultUnitKind: basis
          }
        : {
            manufacturerServing: null,
            productQuantity: null,
            provenSmallestUnit: {
              unitKind: 'piece',
              baseValue: 100,
              basis: 'mass',
              source: 'explicit_serving_count',
              smallestEdibleUnit: true
            },
            defaultUnitKind: 'piece'
          }
    }),
    clinic: {
      source: 'klinikum-leverkusen',
      categoryId: 'test',
      referenceAmount,
      referenceUnit,
      directCarbohydratesPerUnit: direct,
      valueStatus: 'numeric',
      reviewRequired: false
    }
  };
}

function calibration(input: {
  product: CatalogProduct;
  unit: CatalogCalibrationUnit;
  scope?: CatalogUnitCalibration['scope'];
  measuredCount?: number;
  measuredTotalWeightG?: number;
  updatedAt?: string;
  smartIdentity?: boolean;
}): CatalogUnitCalibration {
  const timestamp = input.updatedAt ?? '2026-07-18T10:00:00.000Z';
  const created = createCatalogCalibration({
    calibrationId: `${input.scope ?? 'catalog-product'}-${input.unit}-${timestamp}`,
    scope: input.scope ?? 'catalog-product',
    identity: catalogCalibrationIdentity(input.product, input.smartIdentity ? 'smart' : 'standard'),
    unit: input.unit,
    measuredCount: input.measuredCount ?? 1,
    measuredTotalWeightG: input.measuredTotalWeightG ?? 25,
    smallestEdibleUnit: input.unit !== 'portion',
    now: timestamp
  });
  if (!created) throw new Error('valid test calibration expected');
  return created;
}

function useCalibrations(records: readonly CatalogUnitCalibration[]): void {
  storeMocks.findMatchingCatalogCalibrations.mockImplementation((
    identity: CatalogCalibrationIdentity,
    unit: CatalogCalibrationUnit,
    allowGenericScope = false
  ): CatalogUnitCalibration[] => {
    const keys = catalogCalibrationLookupKeys(identity, unit, allowGenericScope);
    const keyOrder = new Map(keys.map((key, index) => [key, index]));
    return records
      .filter((record) => record.active && keyOrder.has(record.scopeKey))
      .sort((left, right) => {
        const scope = (keyOrder.get(left.scopeKey) ?? 99) - (keyOrder.get(right.scopeKey) ?? 99);
        if (scope !== 0) return scope;
        const sample = right.measurement.measuredCount - left.measurement.measuredCount;
        return sample !== 0 ? sample : right.updatedAt.localeCompare(left.updatedAt);
      });
  });
}

function request(unit: CatalogUnitRequest['unit'], unitExplicit: boolean, amount = 1): CatalogUnitRequest {
  return { amount, unit, unitExplicit };
}

describe('catalog unit request normalization', () => {
  it('converts kilograms to canonical grams without rounding', () => {
    const normalized = normalizeCatalogUnitRequest(request('kg', false, 0.333));
    expect(normalized).toEqual({ amount: 333, unit: 'g', unitExplicit: true });
  });

  it('returns non-kilogram requests unchanged and never mutates them', () => {
    const counted = Object.freeze(request('piece', true, 0.5));
    expect(normalizeCatalogUnitRequest(counted)).toBe(counted);
    expect(counted).toEqual({ amount: 0.5, unit: 'piece', unitExplicit: true });
  });
});

describe('catalog calibration identity and lookup', () => {
  beforeEach(() => {
    storeMocks.findMatchingCatalogCalibrations.mockReset();
    useCalibrations([]);
  });

  it('projects only valid numeric catalog codes as barcode identity', () => {
    expect(catalogCalibrationIdentity(product()).barcode).toBe('4008400322728');
    expect(catalogCalibrationIdentity(product({ code: '12345678' })).barcode).toBe('12345678');
    expect(catalogCalibrationIdentity(product({ code: '12345678901234' })).barcode).toBe('12345678901234');
    expect(catalogCalibrationIdentity(product({ code: '1234567' })).barcode).toBeNull();
    expect(catalogCalibrationIdentity(product({ code: 'ABC-12345678' })).barcode).toBeNull();
  });

  it('exposes a generic-food key only in explicitly smart scope', () => {
    const generic = product({ productId: -1, code: 'generic:pasta-cooked' });
    expect(catalogCalibrationIdentity(generic).genericFoodKey).toBeNull();
    expect(catalogCalibrationIdentity(generic, 'smart').genericFoodKey).toBe('pasta-cooked');
  });

  it('returns the strongest matching concrete calibration for the requested unit', () => {
    const concrete = product();
    const exact = calibration({
      product: concrete,
      unit: 'bar',
      scope: 'exact-product',
      measuredCount: 20,
      measuredTotalWeightG: 400
    });
    const catalog = calibration({
      product: concrete,
      unit: 'bar',
      scope: 'catalog-product',
      measuredCount: 1,
      measuredTotalWeightG: 21
    });
    useCalibrations([exact, catalog]);

    expect(catalogCalibrationForUnit(concrete, 'bar')).toMatchObject({
      calibrationId: catalog.calibrationId,
      scope: 'catalog-product'
    });
  });

  it('blocks generic calibration lookup in standard mode and permits it only in smart mode', () => {
    const generic = product({ productId: -401032, code: 'generic:pasta-cooked', displayName: 'Nudeln, gekocht' });
    const genericRecord = calibration({
      product: generic,
      unit: 'portion',
      scope: 'generic-food',
      measuredTotalWeightG: 240,
      smartIdentity: true
    });
    useCalibrations([genericRecord]);

    expect(catalogCalibrationForUnit(generic, 'portion')).toBeNull();
    expect(storeMocks.findMatchingCatalogCalibrations).not.toHaveBeenCalled();
    expect(catalogCalibrationForUnit(generic, 'portion', 'smart')).toMatchObject({
      calibrationId: genericRecord.calibrationId,
      scope: 'generic-food'
    });
    expect(storeMocks.findMatchingCatalogCalibrations).toHaveBeenCalledWith(
      expect.objectContaining({ genericFoodKey: 'pasta-cooked' }),
      'portion',
      true
    );
  });
});

describe('catalog unit runtime resolution', () => {
  beforeEach(() => {
    storeMocks.findMatchingCatalogCalibrations.mockReset();
    useCalibrations([]);
  });

  it('keeps manufacturer evidence authoritative in standard and smart modes', () => {
    const serving = product({
      unitEvidence: {
        manufacturerServing: { baseValue: 15, basis: 'mass' },
        productQuantity: { baseValue: 450, basis: 'mass' },
        provenSmallestUnit: null,
        defaultUnitKind: 'portion'
      }
    });
    const standard = resolveCatalogUnitRuntime(serving, request('g', false));
    const smart = resolveCatalogUnitRuntime(serving, request('g', false), 'smart');

    expect(standard.resolution.options.find((option) => option.recommended)).toMatchObject({
      unit: 'portion',
      baseValue: 15,
      source: 'manufacturer_serving'
    });
    expect(smart.resolution.selectedOptionId).toBe(standard.resolution.selectedOptionId);
    expect(smart.prompt).toBeNull();
  });

  it('uses a matching saved calibration before catalog evidence and current nutrition for calculation', () => {
    const calibratedProduct = product({
      nutrition: { carbohydratesPer100: 48.5, basis: 'mass', source: 'as_sold' },
      unitEvidence: {
        manufacturerServing: { baseValue: 30, basis: 'mass' },
        productQuantity: { baseValue: 120, basis: 'mass' },
        provenSmallestUnit: null,
        defaultUnitKind: 'portion'
      }
    });
    const saved = calibration({
      product: calibratedProduct,
      unit: 'bar',
      measuredCount: 10,
      measuredTotalWeightG: 200
    });
    useCalibrations([saved]);

    const state = resolveCatalogUnitRuntime(calibratedProduct, request('g', false));
    expect(state.resolution.options[0]).toMatchObject({
      unit: 'bar',
      baseValue: 20,
      source: 'user_calibration',
      recommended: true
    });
    const calculation = calculateCatalogCarbohydrates(
      calibratedProduct,
      request('bar', false, 2),
      state.resolution
    );
    expect(calculation.carbohydratesG).toBe(19.4);
  });

  it('never reuses a different calibrated unit for an explicit request', () => {
    const calibratedProduct = product();
    useCalibrations([calibration({ product: calibratedProduct, unit: 'bar', measuredTotalWeightG: 20 })]);

    const standard = resolveCatalogUnitRuntime(calibratedProduct, request('slice', true));
    const smart = resolveCatalogUnitRuntime(calibratedProduct, request('slice', true), 'smart');
    expect(standard.resolution).toMatchObject({ status: 'needs_unit_calibration', reason: 'countable-weight-missing' });
    expect(standard.resolution.options[0]).toMatchObject({ unit: 'slice', baseValue: null, source: 'unresolved' });
    expect(smart.prompt).toMatchObject({ unit: 'slice', baseValueG: null });
  });

  it('applies an editable smart prompt override only to the exact explicit unit', () => {
    const unresolved = product();
    const standard = resolveCatalogUnitRuntime(unresolved, request('piece', true));
    const smart = resolveCatalogUnitRuntime(unresolved, request('piece', true), 'smart');
    const overridden = resolveCatalogUnitRuntime(unresolved, request('piece', true), 'smart', '25');

    expect(standard.prompt).toBeNull();
    expect(standard.resolution.status).toBe('needs_unit_calibration');
    expect(smart.prompt).toMatchObject({ unit: 'piece', defaultValue: null, baseValueG: null });
    expect(overridden.prompt).toMatchObject({ unit: 'piece', value: '25', baseValueG: 25 });
    expect(overridden.resolution).toMatchObject({ status: 'resolved', reason: 'explicit-unit-preserved' });
    expect(overridden.resolution.options[0]).toMatchObject({ unit: 'piece', baseValue: 25, source: 'unresolved' });
  });

  it('uses the built-in cooked-food portion only in smart mode', () => {
    const noodles = genericCookedProductForQuery('Nudeln');
    if (!noodles) throw new Error('generic noodles expected');

    const standard = resolveCatalogUnitRuntime(noodles, request('portion', true));
    const smart = resolveCatalogUnitRuntime(noodles, request('portion', true), 'smart');
    expect(standard.resolution.status).toBe('needs_unit_calibration');
    expect(standard.prompt).toBeNull();
    expect(smart.prompt).toMatchObject({ unit: 'portion', defaultValue: 200, baseValueG: 200 });
    expect(smart.resolution.options[0]).toMatchObject({ unit: 'portion', baseValue: 200, recommended: true });
  });

  it('keeps gram calibrations out of volume-based products', () => {
    const drink = product({
      code: 'drink',
      nutrition: { carbohydratesPer100: 12, basis: 'volume', source: 'as_sold' },
      unitEvidence: {
        manufacturerServing: { baseValue: 250, basis: 'volume' },
        productQuantity: { baseValue: 750, basis: 'volume' },
        provenSmallestUnit: null,
        defaultUnitKind: 'volume'
      }
    });
    useCalibrations([calibration({ product: drink, unit: 'piece', measuredTotalWeightG: 20 })]);

    const state = resolveCatalogUnitRuntime(drink, request('ml', true, 250));
    expect(state.resolution.options.some((option) => option.source === 'user_calibration')).toBe(false);
    const calculation = calculateCatalogCarbohydrates(drink, request('ml', true, 250), state.resolution);
    expect(calculation).toMatchObject({ carbohydratesG: 30, totalMassG: null, totalVolumeMl: 250 });
  });

  it('normalizes kilograms before resolving direct mass', () => {
    const state = resolveCatalogUnitRuntime(product(), request('kg', true, 0.5));
    expect(state.resolution.options[0]).toMatchObject({ unit: 'g', source: 'direct_mass', baseValue: 1 });
  });
});

describe('direct clinic runtime safety', () => {
  beforeEach(() => {
    storeMocks.findMatchingCatalogCalibrations.mockReset();
    useCalibrations([]);
  });

  it('calculates implicit and explicit piece requests from the direct clinic value', () => {
    const direct = clinicProduct();
    for (const explicit of [false, true]) {
      const pieceRequest = request('piece', explicit, 2);
      const state = resolveCatalogUnitRuntime(direct, pieceRequest);
      expect(state.resolution.options).toHaveLength(1);
      expect(state.resolution.options[0]).toMatchObject({ unit: 'piece', baseValue: 100 });
      expect(calculateCatalogCarbohydrates(direct, pieceRequest, state.resolution).carbohydratesG).toBe(38);
    }
  });

  it('preserves an explicit non-piece unit and never multiplies it as pieces', () => {
    const direct = clinicProduct();
    const gramRequest = request('g', true, 100);
    const state = resolveCatalogUnitRuntime(direct, gramRequest, 'smart');
    const calculation = calculateCatalogCarbohydrates(direct, gramRequest, state.resolution);

    expect(state.prompt).toBeNull();
    expect(state.resolution).toMatchObject({
      status: 'not_calculable',
      reason: 'requested-unit-unavailable'
    });
    expect(state.resolution.options[0]).toMatchObject({
      unit: 'g',
      baseValue: null,
      source: 'unresolved',
      recommended: true
    });
    expect(state.resolution.options[1]).toMatchObject({
      unit: 'piece',
      baseValue: 100,
      recommended: false
    });
    expect(calculation.carbohydratesG).toBeNull();
    expect(calculation.totalMassG).toBeNull();
    expect(storeMocks.findMatchingCatalogCalibrations).not.toHaveBeenCalled();
  });

  it('normalizes explicit kilograms to unavailable grams for a piece-only clinic value', () => {
    const state = resolveCatalogUnitRuntime(clinicProduct(), request('kg', true, 1));
    expect(state.resolution.options[0]).toMatchObject({ unit: 'g', baseValue: null });
  });
});

describe('clinic default request selection', () => {
  beforeEach(() => {
    storeMocks.findMatchingCatalogCalibrations.mockReset();
    useCalibrations([]);
  });

  it('uses the institutional reference when no calibration exists', () => {
    expect(defaultClinicCatalogUnitRequest(clinicProduct({
      directCarbohydratesPerUnit: null,
      referenceAmount: 100,
      referenceUnit: 'g'
    }))).toEqual({ amount: 100, unit: 'g', unitExplicit: false });
  });

  it('ignores stale calibrations for direct piece values', () => {
    const direct = clinicProduct();
    useCalibrations([calibration({ product: direct, unit: 'portion', measuredTotalWeightG: 50 })]);

    expect(defaultClinicCatalogUnitRequest(direct)).toEqual({ amount: 1, unit: 'piece', unitExplicit: false });
    expect(storeMocks.findMatchingCatalogCalibrations).not.toHaveBeenCalled();
  });

  it('selects the strongest saved calibration across all units instead of array order', () => {
    const clinic = clinicProduct({
      directCarbohydratesPerUnit: null,
      referenceAmount: 100,
      referenceUnit: 'g'
    });
    const exactPiece = calibration({
      product: clinic,
      unit: 'piece',
      scope: 'exact-product',
      measuredCount: 20,
      measuredTotalWeightG: 1_000,
      updatedAt: '2026-07-18T12:00:00.000Z'
    });
    const barcodePortion = calibration({
      product: clinic,
      unit: 'portion',
      scope: 'barcode',
      measuredCount: 1,
      measuredTotalWeightG: 80,
      updatedAt: '2026-07-17T12:00:00.000Z'
    });
    useCalibrations([exactPiece, barcodePortion]);

    expect(defaultClinicCatalogUnitRequest(clinic)).toEqual({
      amount: 1,
      unit: 'portion',
      unitExplicit: false
    });
  });
});
