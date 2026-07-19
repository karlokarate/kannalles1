import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CatalogProduct } from '../lib/catalog/catalogDomain';
import type { ClinicCatalogProduct } from '../lib/clinicCatalog';
import { genericCookedProductForQuery } from '../lib/genericFoods';
import { createCatalogCalibration } from '../lib/resolution/catalogCalibration';
import { saveCatalogCalibration } from '../lib/userDataStore';
import {
  catalogCalibrationIdentity
} from './catalogUnitRuntime';
import type { ParsedCatalogQuery } from './queryParser';
import {
  requestForBareCatalogProduct,
  requestForCatalogVariant,
  requestForInitialCatalogProduct,
  requestFromParsedCatalogInput
} from './catalogInputRequest';

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length(): number { return this.values.size; }
  clear(): void { this.values.clear(); }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string): void { this.values.delete(key); }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

function product(overrides: Partial<CatalogProduct> = {}): CatalogProduct {
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
    rankOrdinal: 1,
    ...overrides
  };
}

function parsed(overrides: Partial<ParsedCatalogQuery> = {}): ParsedCatalogQuery {
  return {
    raw: '24 Salzstangen',
    catalogQuery: 'Salzstangen',
    barcode: null,
    amount: 24,
    amountExplicit: true,
    unit: 'g',
    unitExplicit: false,
    ...overrides
  };
}

function clinicProduct(): ClinicCatalogProduct {
  return {
    ...product({
      productId: -2_000_001,
      code: 'clinic:test',
      displayName: 'Klinikprodukt',
      nutrition: { carbohydratesPer100: 25, basis: 'mass', source: 'prepared' },
      unitEvidence: {
        manufacturerServing: null,
        productQuantity: null,
        provenSmallestUnit: null,
        defaultUnitKind: 'mass'
      }
    }),
    clinic: {
      source: 'klinikum-leverkusen',
      categoryId: 'test',
      referenceAmount: 100,
      referenceUnit: 'g',
      directCarbohydratesPerUnit: null,
      valueStatus: 'numeric',
      reviewRequired: false
    }
  };
}

function savePersonalPortion(target: CatalogProduct, unitWeightG = 0.4): void {
  const record = createCatalogCalibration({
    calibrationId: 'personal-portion',
    scope: 'catalog-product',
    identity: catalogCalibrationIdentity(target),
    unit: 'portion',
    measuredCount: 10,
    measuredTotalWeightG: unitWeightG * 10,
    smallestEdibleUnit: false,
    now: '2026-07-19T12:00:00.000Z'
  });
  if (!record || !saveCatalogCalibration(record)) {
    throw new Error('personal portion calibration expected');
  }
}

beforeEach(() => {
  vi.stubGlobal('window', {
    localStorage: new MemoryStorage(),
    dispatchEvent: vi.fn()
  });
  if (typeof CustomEvent === 'undefined') {
    vi.stubGlobal('CustomEvent', class<T> extends Event {
      readonly detail: T | undefined;
      constructor(type: string, init?: CustomEventInit<T>) {
        super(type);
        this.detail = init?.detail;
      }
    });
  }
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('catalog input request SSOT', () => {
  it('preserves a recognized amount exactly', () => {
    expect(requestFromParsedCatalogInput(parsed())).toEqual({
      amount: 24,
      unit: 'g',
      unitExplicit: false
    });
  });

  it('combines an explicit amount with the saved personal standard unit', () => {
    const saltSticks = product();
    savePersonalPortion(saltSticks, 0.4);

    expect(requestForInitialCatalogProduct(
      parsed({ raw: '13 Salzstangen', amount: 13 }),
      saltSticks
    )).toEqual({
      amount: 13,
      unit: 'portion',
      unitExplicit: false
    });
  });

  it('uses the personal standard unit for bare searches and product variants', () => {
    const saltSticks = product();
    savePersonalPortion(saltSticks, 0.4);

    expect(requestForBareCatalogProduct(saltSticks)).toEqual({
      amount: 1,
      unit: 'portion',
      unitExplicit: false
    });
    expect(requestForCatalogVariant(
      { amount: 13, unit: 'g', unitExplicit: false },
      saltSticks
    )).toEqual({
      amount: 13,
      unit: 'portion',
      unitExplicit: false
    });
  });

  it('keeps an explicitly entered unit authoritative over a personal default', () => {
    const saltSticks = product();
    savePersonalPortion(saltSticks, 0.4);

    expect(requestForInitialCatalogProduct(parsed({
      raw: '13 g Salzstangen',
      amount: 13,
      unit: 'g',
      unitExplicit: true
    }), saltSticks)).toEqual({
      amount: 13,
      unit: 'g',
      unitExplicit: true
    });
  });

  it('never replaces an explicit amount during product-specific defaulting', () => {
    const generic = genericCookedProductForQuery('Nudeln');
    if (!generic) throw new Error('generic noodles expected');

    expect(requestForInitialCatalogProduct(parsed(), product()).amount).toBe(24);
    expect(requestForInitialCatalogProduct(parsed(), generic, 'smart')).toEqual({
      amount: 24,
      unit: 'g',
      unitExplicit: false
    });
    expect(requestForInitialCatalogProduct(parsed(), clinicProduct())).toEqual({
      amount: 24,
      unit: 'g',
      unitExplicit: false
    });
  });

  it('applies generic and clinic defaults only to a bare product name', () => {
    const bare = parsed({
      raw: 'Nudeln',
      catalogQuery: 'Nudeln',
      amount: 1,
      amountExplicit: false,
      unitExplicit: false
    });
    const generic = genericCookedProductForQuery('Nudeln');
    if (!generic) throw new Error('generic noodles expected');

    expect(requestForInitialCatalogProduct(bare, generic, 'smart')).toEqual({
      amount: 200,
      unit: 'g',
      unitExplicit: true
    });
    expect(requestForInitialCatalogProduct(bare, clinicProduct())).toEqual({
      amount: 100,
      unit: 'g',
      unitExplicit: false
    });
  });

  it('keeps amount as SSOT when selecting another product variant', () => {
    expect(requestForCatalogVariant(
      { amount: 24, unit: 'g', unitExplicit: false },
      product({ nutrition: { carbohydratesPer100: 8, basis: 'volume', source: 'as_sold' } })
    )).toEqual({ amount: 24, unit: 'ml', unitExplicit: false });
  });

  it('preserves an explicit user unit during variant selection', () => {
    const request = { amount: 24, unit: 'piece' as const, unitExplicit: true };
    expect(requestForCatalogVariant(request, product())).toBe(request);
  });
});
