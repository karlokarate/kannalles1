export interface CatalogManifest {
  catalogVersion: string;
  artifactKind: 'benchmark' | 'production';
  filename: string;
  sizeBytes: number;
  sha256: string;
  applicationId: number;
  userVersion: number;
  productCount: number;
  schema: {
    productsTable: 'p';
    dictionaryTable: 'd';
    searchTable: 'x';
  };
}

export interface CatalogProductRecord {
  code: string;
  name: string;
  brand: string | null;
  carbohydratesPer100g: number;
  servingQuantityG: number | null;
  productQuantityG: number | null;
  packedMetadata: number;
  rank: number | null;
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
