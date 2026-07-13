export type CatalogBasis = 'mass' | 'volume';

export type CatalogUnitKind =
  | 'none'
  | 'mass'
  | 'volume'
  | 'portion'
  | 'piece'
  | 'bar'
  | 'slice'
  | 'package';

export type CatalogUnitSource =
  | 'none'
  | 'manufacturerServing'
  | 'explicitServingCount'
  | 'explicitMultipackQuantity';

export type CatalogSlotId = 'a' | 'b';

export type CatalogFailureCode =
  | 'CATALOG_NOT_READY'
  | 'CATALOG_MANIFEST_INVALID'
  | 'CATALOG_MANIFEST_UNAVAILABLE'
  | 'CATALOG_DOWNLOAD_FAILED'
  | 'CATALOG_SIZE_MISMATCH'
  | 'CATALOG_HASH_MISMATCH'
  | 'CATALOG_SCHEMA_MISMATCH'
  | 'CATALOG_INTEGRITY_FAILED'
  | 'CATALOG_PRODUCT_COUNT_MISMATCH'
  | 'CATALOG_SMOKE_TEST_FAILED'
  | 'CATALOG_SLOT_STATE_INVALID'
  | 'CATALOG_SLOT_ACTIVATION_FAILED'
  | 'CATALOG_ROLLBACK_FAILED'
  | 'CATALOG_UNAVAILABLE'
  | 'SQLITE_WASM_INVALID'
  | 'OPFS_UNSUPPORTED'
  | 'CATALOG_WORKER_FAILED'
  | 'CATALOG_ERROR';

export interface CatalogManifest {
  contract: 'kh-checker-offline-catalog-production';
  contractVersion: string;
  catalogVersion: string;
  generatedAtUtc: string;
  filename: string;
  sizeBytes: number;
  sha256: string;
  applicationId: number;
  userVersion: number;
  pageSize: number;
  productCount: number;
  brandCount: number;
  codecFile: string;
  runtimeTypescript: string;
  imageResolution: number;
  imageDictionaryFile: string;
  imageDictionarySha256: string;
  transportCompression: null;
  searchOrdering: string;
  resultLimitDefault: number;
}

export interface CatalogMeasureEvidence {
  value: number;
  basis: CatalogBasis;
}

export interface CatalogProvenUnitEvidence extends CatalogMeasureEvidence {
  kind: Exclude<CatalogUnitKind, 'none'>;
  source: Exclude<CatalogUnitSource, 'none'>;
}

export interface CatalogUnitEvidence {
  manufacturerServing: CatalogMeasureEvidence | null;
  productQuantity: CatalogMeasureEvidence | null;
  provenSmallestUnit: CatalogProvenUnitEvidence | null;
  defaultUnitKind: CatalogUnitKind;
}

/** Lossless worker projection. Domain mapping is owned by the catalog-domain boundary. */
export interface CatalogProductRecord {
  code: string;
  name: string;
  brand: string | null;
  carbohydratesPer100: number;
  carbohydrateBasis: CatalogBasis;
  carbohydrateSourcePrepared: boolean;
  unitEvidence: CatalogUnitEvidence;
  imageUrl: string | null;
  hasQualityErrors: boolean;
  rankOrdinal: number;
}

export interface CatalogSearchHit extends CatalogProductRecord {
  position: number;
}

export interface CatalogDiagnostics {
  operation: 'bootstrap' | 'manifest' | 'install' | 'activate' | 'rollback' | 'query';
  code: CatalogFailureCode | null;
  message: string;
  activeSlot: CatalogSlotId | null;
  attemptedSlot: CatalogSlotId | null;
  rollbackSlot: CatalogSlotId | null;
  catalogVersion: string | null;
  cause: string | null;
}

export interface CatalogRuntimeStatus {
  state: 'idle' | 'checking' | 'installing' | 'ready' | 'failed';
  catalogVersion: string | null;
  productCount: number | null;
  persistent: boolean;
  installedFromNetwork: boolean;
  activeSlot: CatalogSlotId | null;
  rollbackAvailable: boolean;
  diagnostics: CatalogDiagnostics | null;
  message: string | null;
}

export type CatalogWorkerRequest =
  | {
      id: number;
      type: 'init';
      sqliteModuleUrl: string;
      manifestUrl: string;
      catalogBaseUrl: string;
    }
  | {
      id: number;
      type: 'retry';
      sqliteModuleUrl: string;
      manifestUrl: string;
      catalogBaseUrl: string;
    }
  | { id: number; type: 'search'; query: string; limit: number }
  | { id: number; type: 'product'; barcode: string }
  | { id: number; type: 'status' };

export type CatalogWorkerResponse =
  | { id: number; ok: true; result: unknown }
  | {
      id: number;
      ok: false;
      error: {
        name: string;
        message: string;
        code: CatalogFailureCode;
        diagnostics: CatalogDiagnostics | null;
      };
    };
