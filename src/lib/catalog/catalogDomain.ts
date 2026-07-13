/**
 * Catalog-native domain boundary for the offline SQLite runtime.
 *
 * This module intentionally contains no transport, OPFS, SQLite, React, or
 * Open Food Facts API types. Runtime adapters must project into these types.
 */

export type CatalogSlotId = 'a' | 'b';

export type CatalogNutritionBasis = 'mass' | 'volume';

export type CatalogNutritionSource = 'as_sold' | 'prepared';

export type CatalogUnitKind =
  | 'mass'
  | 'volume'
  | 'portion'
  | 'piece'
  | 'bar'
  | 'slice'
  | 'package';

export type CatalogCountability = 'countable' | 'non_countable' | 'unknown';

export type CatalogUnitEvidenceSource =
  | 'manufacturer_serving'
  | 'explicit_serving_count'
  | 'explicit_multipack_quantity';

export interface CatalogMeasure {
  readonly value: number;
  readonly basis: CatalogNutritionBasis;
}

/**
 * A unit weight or volume that was explicitly proven by the production
 * catalog. Absence is represented by `null`; callers must never synthesize a
 * typical piece weight.
 */
export interface CatalogUnitEvidence extends CatalogMeasure {
  readonly kind: CatalogUnitKind;
  readonly source: CatalogUnitEvidenceSource;
  readonly countability: CatalogCountability;
  readonly smallestEdibleUnit: boolean;
  readonly proven: true;
}

export interface CatalogImageReference {
  readonly url: string;
  readonly optionalNetwork: true;
}

/** Lossless product projection from one verified Production-v1 SQLite row. */
export interface CatalogProduct {
  readonly productId: number;
  readonly code: string;
  readonly displayName: string;
  readonly brand: string | null;
  readonly carbohydratesPer100: number;
  readonly nutritionBasis: CatalogNutritionBasis;
  readonly nutritionSource: CatalogNutritionSource;
  readonly manufacturerServing: CatalogMeasure | null;
  readonly productQuantity: CatalogMeasure | null;
  readonly provenUnit: CatalogUnitEvidence | null;
  readonly defaultUnitKind: CatalogUnitKind;
  readonly image: CatalogImageReference | null;
  readonly hasQualityErrors: boolean;
  readonly rankOrdinal: number;
}

/**
 * Search hits retain the exact SQLite order. `resultIndex` is assigned after
 * the query and must not be used to re-rank results in application code.
 */
export interface CatalogSearchHit extends CatalogProduct {
  readonly resultIndex: number;
}

export type CatalogOperation =
  | 'initialize'
  | 'manifest'
  | 'download'
  | 'validate'
  | 'install'
  | 'activate'
  | 'open'
  | 'search'
  | 'product_lookup'
  | 'rollback';

export type CatalogFailureCode =
  | 'CATALOG_NOT_READY'
  | 'CATALOG_MANIFEST_UNAVAILABLE'
  | 'CATALOG_MANIFEST_INVALID'
  | 'CATALOG_DOWNLOAD_FAILED'
  | 'CATALOG_SIZE_MISMATCH'
  | 'CATALOG_HASH_MISMATCH'
  | 'CATALOG_STORAGE_UNAVAILABLE'
  | 'CATALOG_IMPORT_FAILED'
  | 'CATALOG_OPEN_FAILED'
  | 'CATALOG_APPLICATION_ID_MISMATCH'
  | 'CATALOG_USER_VERSION_MISMATCH'
  | 'CATALOG_SCHEMA_MISMATCH'
  | 'CATALOG_INTEGRITY_FAILED'
  | 'CATALOG_PRODUCT_COUNT_MISMATCH'
  | 'CATALOG_QUERY_FAILED'
  | 'CATALOG_UNSUPPORTED'
  | 'CATALOG_CANCELLED'
  | 'CATALOG_UNKNOWN';

export type CatalogDiagnosticValue = string | number | boolean | null;

/** Serializable, redacted diagnostics suitable for an expandable UI panel. */
export interface CatalogDiagnostics {
  readonly code: CatalogFailureCode;
  readonly operation: CatalogOperation;
  readonly message: string;
  readonly technical: string;
  readonly occurredAt: string;
  readonly retryAllowedImmediately: true;
  readonly activeSlot: CatalogSlotId | null;
  readonly attemptedSlot: CatalogSlotId | null;
  readonly catalogVersion: string | null;
  readonly details: Readonly<Record<string, CatalogDiagnosticValue>>;
}

export type CatalogStatusState =
  | 'uninitialized'
  | 'checking'
  | 'downloading'
  | 'installing'
  | 'ready'
  | 'unavailable';

/**
 * Single catalog authority status. A failed update may leave a previously
 * verified active slot ready; it must never create a second read authority.
 */
export interface CatalogStatus {
  readonly state: CatalogStatusState;
  readonly activeSlot: CatalogSlotId | null;
  readonly catalogVersion: string | null;
  readonly productCount: number | null;
  readonly progress: number | null;
  readonly diagnostics: CatalogDiagnostics | null;
  readonly retryAllowedImmediately: true;
}
