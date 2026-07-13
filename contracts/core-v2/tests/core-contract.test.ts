import { describe, expect, it } from 'vitest';
import { catalogDiagnostics, CatalogFailure, toCatalogFailure } from '../../../src/lib/catalog/catalogErrors';
import type {
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

  it('redacts complete authorization and cookie header values without credential suffixes', () => {
    const technical = [
      'Authorization: Basic dXNlcjpwYXNz',
      'Authorization: ApiKey abc123',
      'Proxy-Authorization: Basic abc123',
      'Cookie: session=secret; theme=dark',
      'Set-Cookie: session=secret; Path=/; HttpOnly'
    ].join('\n');

    const failure = new CatalogFailure('CATALOG_MANIFEST_INVALID', 'token=visible-in-input', {
      operation: 'manifest',
      activeSlot: 'a',
      attemptedSlot: 'b',
      rollbackSlot: 'a',
      technical,
      details: {
        password: 'hunter2',
        note: 'api_key=12345',
        status: 401
      }
    });

    expect(failure.message).not.toContain('visible-in-input');
    expect(failure.diagnostics.technical).toBe([
      'Authorization: [redacted]',
      'Authorization: [redacted]',
      'Proxy-Authorization: [redacted]',
      'Cookie: [redacted]',
      'Set-Cookie: [redacted]'
    ].join('\n'));
    expect(failure.diagnostics.technical).not.toContain('dXNlcjpwYXNz');
    expect(failure.diagnostics.technical).not.toContain('abc123');
    expect(failure.diagnostics.technical).not.toContain('session=secret');
    expect(failure.diagnostics.details).not.toHaveProperty('password');
    expect(failure.diagnostics.details.note).toBe('api_key=[redacted]');
    expect(failure.diagnostics.details.status).toBe(401);
    expect(failure.diagnostics.rollbackSlot).toBe('a');
  });

  it('does not retain a raw cause on CatalogFailure or any serializable public property', () => {
    const secret = 'dXNlcjpwYXNz';
    const rawCause = Object.assign(new Error(`Authorization: Basic ${secret}`), {
      headers: { authorization: `Basic ${secret}` },
      sqliteInternal: { filename: '/private/catalog.sqlite' }
    });

    const wrapped = toCatalogFailure(
      rawCause,
      'CATALOG_WORKER_FAILED',
      'Katalog-Worker fehlgeschlagen.',
      { operation: 'initialize' }
    );

    expect('cause' in wrapped).toBe(false);
    expect((wrapped as Error & { cause?: unknown }).cause).toBeUndefined();
    expect(wrapped.diagnostics.technical).toBe('Error: Authorization: [redacted]');

    const publicSnapshot = Object.fromEntries(
      Object.getOwnPropertyNames(wrapped).map((key) => [key, (wrapped as unknown as Record<string, unknown>)[key]])
    );
    const serialized = JSON.stringify(publicSnapshot);
    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain('/private/catalog.sqlite');
    expect(serialized).not.toContain('headers');
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
