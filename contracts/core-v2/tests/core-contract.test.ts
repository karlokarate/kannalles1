import { describe, expect, it } from 'vitest';
import { catalogDiagnostics, CatalogFailure, toCatalogFailure } from '../../../src/lib/catalog/catalogErrors';
import type {
  CatalogCountability,
  CatalogDiagnosticValue,
  CatalogDiagnostics,
  CatalogFailureCode,
  CatalogImageReference,
  CatalogMeasure,
  CatalogNutrition,
  CatalogNutritionBasis,
  CatalogNutritionSource,
  CatalogOperation,
  CatalogProduct,
  CatalogProvenUnitEvidence,
  CatalogSearchHit,
  CatalogSlotId,
  CatalogSlotState,
  CatalogStatus,
  CatalogStatusState,
  CatalogUnitEvidence,
  CatalogUnitEvidenceSource,
  CatalogUnitKind
} from '../../../src/lib/catalog/catalogDomain';

type FrozenCatalogDomainExportContract = {
  CatalogCountability: CatalogCountability;
  CatalogDiagnosticValue: CatalogDiagnosticValue;
  CatalogDiagnostics: CatalogDiagnostics;
  CatalogFailureCode: CatalogFailureCode;
  CatalogImageReference: CatalogImageReference;
  CatalogMeasure: CatalogMeasure;
  CatalogNutrition: CatalogNutrition;
  CatalogNutritionBasis: CatalogNutritionBasis;
  CatalogNutritionSource: CatalogNutritionSource;
  CatalogOperation: CatalogOperation;
  CatalogProduct: CatalogProduct;
  CatalogProvenUnitEvidence: CatalogProvenUnitEvidence;
  CatalogSearchHit: CatalogSearchHit;
  CatalogSlotId: CatalogSlotId;
  CatalogSlotState: CatalogSlotState;
  CatalogStatus: CatalogStatus;
  CatalogStatusState: CatalogStatusState;
  CatalogUnitEvidence: CatalogUnitEvidence;
  CatalogUnitEvidenceSource: CatalogUnitEvidenceSource;
  CatalogUnitKind: CatalogUnitKind;
};

const imageReference: CatalogImageReference = {
  keyId: 1,
  key: 'front_de',
  revision: 17,
  resolution: 200
};

const buenoUnit: CatalogProvenUnitEvidence = {
  unitKind: 'bar',
  baseValue: 21.5,
  basis: 'mass',
  source: 'explicit_multipack_quantity',
  smallestEdibleUnit: true
};

const bueno: CatalogProduct = {
  productId: 1,
  code: '4008400321622',
  displayName: 'Kinder Bueno',
  brand: 'Kinder',
  nutrition: {
    carbohydratesPer100: 49.5,
    basis: 'mass',
    source: 'as_sold'
  },
  unitEvidence: {
    manufacturerServing: { baseValue: 43, basis: 'mass' },
    productQuantity: { baseValue: 43, basis: 'mass' },
    provenSmallestUnit: buenoUnit,
    defaultUnitKind: 'bar'
  },
  imageReference,
  hasQualityErrors: false,
  rankOrdinal: 1000
};

const searchHit: CatalogSearchHit = { ...bueno, resultIndex: 0 };

// Compile-time assertion: this exact type-only export set is the frozen v1 surface.
const frozenExportContract: FrozenCatalogDomainExportContract | null = null;
void frozenExportContract;

describe('frozen catalog-native core boundary', () => {
  it('projects nutrition and unit evidence without legacy API fields', () => {
    expect(bueno.nutrition).toEqual({
      carbohydratesPer100: 49.5,
      basis: 'mass',
      source: 'as_sold'
    });
    expect(bueno.unitEvidence.provenSmallestUnit).toEqual(buenoUnit);
    expect(searchHit.resultIndex).toBe(0);
    expect(bueno).not.toHaveProperty('serving_size');
    expect(bueno).not.toHaveProperty('product_quantity');
    expect(bueno).not.toHaveProperty('nutriments');
  });

  it('exposes an image key and never a prebuilt image URL', () => {
    expect(bueno.imageReference).toEqual(imageReference);
    expect(bueno.imageReference).not.toHaveProperty('url');
    expect(bueno).not.toHaveProperty('imageUrl');
  });

  it('keeps one active slot and lossless state for both physical slots', () => {
    const status: CatalogStatus = {
      state: 'ready',
      activeSlot: 'a',
      rollbackSlot: 'b',
      slotStates: { a: 'active', b: 'verified' },
      catalogVersion: '2026-07-13',
      productCount: 317579,
      persistent: true,
      progress: null,
      diagnostics: null,
      retryAllowedImmediately: true
    };
    expect(status.activeSlot).toBe('a');
    expect(status.slotStates).toEqual({ a: 'active', b: 'verified' });
  });

  it('redacts credentials from messages, technical details and structured values', () => {
    const failure = new CatalogFailure('CATALOG_MANIFEST_INVALID', 'token=visible-in-input', {
      operation: 'manifest',
      activeSlot: 'a',
      attemptedSlot: 'b',
      rollbackSlot: 'a',
      technical: 'Authorization: Bearer abc.def password=hunter2',
      details: {
        password: 'hunter2',
        note: 'api_key=12345',
        status: 401
      }
    });

    expect(failure.message).not.toContain('visible-in-input');
    expect(failure.diagnostics.technical).not.toContain('abc.def');
    expect(failure.diagnostics.technical).not.toContain('hunter2');
    expect(failure.diagnostics.details).not.toHaveProperty('password');
    expect(failure.diagnostics.details.note).toBe('api_key=[redacted]');
    expect(failure.diagnostics.details.status).toBe(401);
    expect(failure.diagnostics.rollbackSlot).toBe('a');
  });

  it('preserves an existing CatalogFailure and wraps unknown failures', () => {
    const existing = new CatalogFailure('CATALOG_OPEN_FAILED', 'Katalog konnte nicht geöffnet werden.', {
      operation: 'open',
      technical: 'sqlite open failed'
    });
    expect(toCatalogFailure(existing, 'CATALOG_UNKNOWN', 'ignored', { operation: 'open' })).toBe(existing);

    const wrapped = toCatalogFailure(new Error('boom'), 'CATALOG_QUERY_FAILED', 'Suche fehlgeschlagen.', {
      operation: 'search'
    });
    expect(catalogDiagnostics(wrapped)?.code).toBe('CATALOG_QUERY_FAILED');
    expect(catalogDiagnostics(new Error('plain'))).toBeNull();
  });
});
