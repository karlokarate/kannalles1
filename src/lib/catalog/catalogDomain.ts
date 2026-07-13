/**
 * Frozen catalog-native domain boundary for the offline SQLite runtime.
 *
 * This module contains no worker protocol, OPFS, SQLite-WASM, React, URL
 * composition, Open Food Facts API, cache, credential, or compatibility types.
 * Runtime and UI layers project to and consume this exact export surface.
 */

export type CatalogSlotId = 'a' | 'b';

/** Lifecycle state of one physical A/B catalog slot. */
export type CatalogSlotState =
  | 'empty'
  | 'staging'
  | 'verified'
  | 'active'
  | 'invalid';

/** Base unit used by nutrition and quantity values. */
export type CatalogNutritionBasis = 'mass' | 'volume';

/** Whether the selected carbohydrate value describes the sold or prepared food. */
export type CatalogNutritionSource = 'as_sold' | 'prepared';

/** Exact unit-kind vocabulary decoded from the Production-v1 metadata bits. */
export type CatalogUnitKind =
  | 'none'
  | 'mass'
  | 'volume'
  | 'portion'
  | 'piece'
  | 'bar'
  | 'slice'
  | 'package';

export type CatalogCountability = 'countable' | 'non_countable' | 'unknown';

/** Exact evidence-source vocabulary decoded from the Production-v1 metadata bits. */
export type CatalogUnitEvidenceSource =
  | 'none'
  | 'manufacturer_serving'
  | 'explicit_serving_count'
  | 'explicit_multipack_quantity';

/** Grams when basis is mass; millilitres when basis is volume. */
export interface CatalogMeasure {
  readonly baseValue: number;
  readonly basis: CatalogNutritionBasis;
}

export interface CatalogNutrition {
  readonly carbohydratesPer100: number;
  readonly basis: CatalogNutritionBasis;
  readonly source: CatalogNutritionSource;
}

/** A proven smallest-unit value decoded from structured catalog metadata. */
export interface CatalogProvenUnitEvidence extends CatalogMeasure {
  readonly unitKind: Exclude<CatalogUnitKind, 'none'>;
  readonly source: Exclude<CatalogUnitEvidenceSource, 'none'>;
  readonly smallestEdibleUnit: true;
}

/** All structured quantity evidence projected losslessly from one catalog row. */
export interface CatalogUnitEvidence {
  readonly manufacturerServing: CatalogMeasure | null;
  readonly productQuantity: CatalogMeasure | null;
  readonly provenSmallestUnit: CatalogProvenUnitEvidence | null;
  readonly defaultUnitKind: CatalogUnitKind;
}

/**
 * Catalog-native image identity. URL/path composition belongs outside the
 * SQLite projection and must combine this reference with CatalogProduct.code.
 */
export interface CatalogImageReference {
  readonly keyId: number;
  readonly key: string;
  readonly revision: number;
  readonly resolution: number;
}

/** Lossless domain projection from one verified Production-v1 SQLite row. */
export interface CatalogProduct {
  readonly productId: number;
  readonly code: string;
  readonly displayName: string;
  readonly brand: string | null;
  readonly nutrition: CatalogNutrition;
  readonly unitEvidence: CatalogUnitEvidence;
  readonly imageReference: CatalogImageReference | null;
  readonly hasQualityErrors: boolean;
  readonly rankOrdinal: number;
}

/**
 * Search hits retain the exact SQLite order. resultIndex is zero-based and must
 * never be used as an input to application-side re-ranking.
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

/** Stable, exhaustive failure vocabulary shared by runtime, UI and tests. */
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
  | 'CATALOG_FTS_INTEGRITY_FAILED'
  | 'CATALOG_PRODUCT_COUNT_MISMATCH'
  | 'CATALOG_SMOKE_TEST_FAILED'
  | 'CATALOG_SLOT_STATE_INVALID'
  | 'CATALOG_SLOT_ACTIVATION_FAILED'
  | 'CATALOG_ROLLBACK_FAILED'
  | 'CATALOG_QUERY_FAILED'
  | 'CATALOG_SQLITE_RUNTIME_INVALID'
  | 'CATALOG_OPFS_UNSUPPORTED'
  | 'CATALOG_WORKER_FAILED'
  | 'CATALOG_UNSUPPORTED'
  | 'CATALOG_CANCELLED'
  | 'CATALOG_UNKNOWN';

export type CatalogDiagnosticValue = string | number | boolean | null;

/** Serializable, credential-redacted diagnostics suitable for the UI. */
export interface CatalogDiagnostics {
  readonly code: CatalogFailureCode;
  readonly operation: CatalogOperation;
  readonly message: string;
  readonly technical: string;
  readonly occurredAt: string;
  readonly retryAllowedImmediately: true;
  readonly activeSlot: CatalogSlotId | null;
  readonly attemptedSlot: CatalogSlotId | null;
  readonly rollbackSlot: CatalogSlotId | null;
  readonly catalogVersion: string | null;
  readonly details: Readonly<Record<string, CatalogDiagnosticValue>>;
}

export type CatalogStatusState =
  | 'idle'
  | 'checking'
  | 'downloading'
  | 'installing'
  | 'ready'
  | 'unavailable';

/** Single-authority status for the catalog runtime and both physical slots. */
export interface CatalogStatus {
  readonly state: CatalogStatusState;
  readonly activeSlot: CatalogSlotId | null;
  readonly rollbackSlot: CatalogSlotId | null;
  readonly slotStates: Readonly<Record<CatalogSlotId, CatalogSlotState>>;
  readonly catalogVersion: string | null;
  readonly productCount: number | null;
  readonly persistent: boolean;
  readonly progress: number | null;
  readonly diagnostics: CatalogDiagnostics | null;
  readonly retryAllowedImmediately: true;
}
