import type {
  CatalogDiagnostics,
  CatalogFailureCode,
  CatalogProduct,
  CatalogSearchHit,
  CatalogStatus
} from './catalogDomain';

/** Transport-only projection of the immutable production manifest. */
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
  | {
      readonly id: number;
      readonly type: 'initialize' | 'retry';
      readonly sqliteModuleUrl: string;
      readonly manifestUrl: string;
      readonly catalogBaseUrl: string;
    }
  | {
      readonly id: number;
      readonly type: 'search';
      readonly query: string;
      readonly limit: number;
    }
  | {
      readonly id: number;
      readonly type: 'product';
      readonly barcode: string;
    }
  | {
      readonly id: number;
      readonly type: 'status';
    };

export type CatalogWorkerSuccess =
  | { readonly id: number; readonly ok: true; readonly type: 'status'; readonly result: CatalogStatus }
  | { readonly id: number; readonly ok: true; readonly type: 'search'; readonly result: readonly CatalogSearchHit[] }
  | { readonly id: number; readonly ok: true; readonly type: 'product'; readonly result: CatalogProduct | null };

export interface CatalogWorkerFailure {
  readonly id: number;
  readonly ok: false;
  readonly error: {
    readonly name: 'CatalogFailure';
    readonly message: string;
    readonly code: CatalogFailureCode;
    readonly diagnostics: CatalogDiagnostics;
  };
}

export interface CatalogWorkerStatusEvent {
  readonly id: 0;
  readonly ok: true;
  readonly type: 'status-event';
  readonly result: CatalogStatus;
}

export type CatalogWorkerResponse = CatalogWorkerSuccess | CatalogWorkerFailure | CatalogWorkerStatusEvent;
