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

/** Normalized browser-facing form of catalog-manifest.v1.json. */
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
  imageDictionaryFile: string;
  imageDictionarySha256: string;
}

/** Fully decoded domain projection returned by the SQLite worker. */
export interface CatalogProductRecord {
  code: string;
  name: string;
  brand: string | null;
  carbohydratesPer100: number;
  carbohydrateBasis: CatalogBasis;
  carbohydrateSourcePrepared: boolean;
  servingValue: number | null;
  servingBasis: CatalogBasis | null;
  productQuantityValue: number | null;
  productQuantityBasis: CatalogBasis | null;
  provenUnitValue: number | null;
  provenUnitKind: CatalogUnitKind;
  provenUnitSource: CatalogUnitSource;
  provenUnitBasis: CatalogBasis | null;
  defaultUnitKind: CatalogUnitKind;
  imageUrl: string | null;
  hasQualityErrors: boolean;
  rankOrdinal: number;
}

export interface CatalogRuntimeStatus {
  state: 'idle' | 'installing' | 'ready' | 'failed';
  catalogVersion: string | null;
  productCount: number | null;
  persistent: boolean;
  installedFromNetwork: boolean;
  message: string | null;
}

export type CatalogWorkerRequest =
  | {
      id: number;
      type: 'init';
      sqliteModuleUrl: string;
      manifestUrl: string;
      catalogUrl: string;
    }
  | { id: number; type: 'search'; query: string; limit: number }
  | { id: number; type: 'product'; barcode: string }
  | { id: number; type: 'status' };

export type CatalogWorkerResponse =
  | { id: number; ok: true; result: unknown }
  | {
      id: number;
      ok: false;
      error: { name: string; message: string; code: string };
    };
