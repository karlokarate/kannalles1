import type {
  CatalogDiagnostics,
  CatalogFailureCode,
  CatalogProduct,
  CatalogSearchHit,
  CatalogStatus
} from './catalogDomain';

/** Transport-normalized form of Catalog/catalog-manifest.v1.json. */
export interface CatalogManifest {
  readonly contract: 'kh-checker-offline-catalog-production';
  readonly contractVersion: string;
  readonly catalogVersion: string;
  readonly generatedAtUtc: string;
  readonly filename: string;
  readonly sizeBytes: number;
  readonly sha256: string;
  readonly applicationId: number;
  readonly userVersion: number;
  readonly pageSize: number;
  readonly productCount: number;
  readonly brandCount: number;
  readonly codecFile: string;
  readonly runtimeTypescript: string;
  readonly imageResolution: number;
  readonly imageDictionaryFile: string;
  readonly imageDictionarySha256: string;
  readonly transportCompression: null;
  readonly searchOrdering: string;
  readonly resultLimitDefault: number;
}

export type CatalogWorkerRequest =
  | { readonly type: 'initialize'; readonly requestId: string }
  | { readonly type: 'status'; readonly requestId: string }
  | { readonly type: 'search'; readonly requestId: string; readonly query: string; readonly limit: number }
  | { readonly type: 'product'; readonly requestId: string; readonly code: string }
  | { readonly type: 'retry-update'; readonly requestId: string };

/** Runtime-only facts supplement Atlas CatalogStatus without redefining it. */
export interface CatalogRuntimeFacts {
  readonly persistent: boolean;
  readonly installedFromNetwork: boolean;
  readonly rollbackAvailable: boolean;
  readonly activeSlotFile: string | null;
}

export interface CatalogStatusEnvelope {
  readonly status: CatalogStatus;
  readonly runtime: CatalogRuntimeFacts;
}

export type CatalogWorkerSuccess =
  | { readonly requestId: string; readonly ok: true; readonly type: 'status'; readonly result: CatalogStatusEnvelope }
  | { readonly requestId: string; readonly ok: true; readonly type: 'search'; readonly result: readonly CatalogSearchHit[] }
  | { readonly requestId: string; readonly ok: true; readonly type: 'product'; readonly result: CatalogProduct | null };

export interface CatalogWorkerFailure {
  readonly requestId: string;
  readonly ok: false;
  readonly error: {
    readonly name: 'CatalogFailure';
    readonly message: string;
    readonly code: CatalogFailureCode;
    readonly diagnostics: CatalogDiagnostics;
  };
}

export interface CatalogWorkerStatusEvent {
  readonly requestId: 'status-event';
  readonly ok: true;
  readonly type: 'status-event';
  readonly result: CatalogStatusEnvelope;
}

export type CatalogWorkerResponse = CatalogWorkerSuccess | CatalogWorkerFailure | CatalogWorkerStatusEvent;
