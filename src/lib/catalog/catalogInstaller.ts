import {
  CATALOG_RESCUE_BARCODE_SQL,
  CATALOG_SEARCH_SQL,
  buildCatalogFtsQuery,
  packStandardGtin
} from '../../../Catalog/catalog-runtime.generated';
import type { CatalogDiagnostics, CatalogSlotId, CatalogStatus } from './catalogDomain';
import { CatalogFailure, isCatalogFailure, toCatalogFailure } from './catalogErrors';
import { fetchCatalogManifest, resolveCatalogArtifactUrl } from './catalogManifest';
import type { CatalogSqlRow } from './catalogProjection';
import type { CatalogManifest } from './catalogProtocol';
import {
  type CatalogSlotMetadata,
  type CatalogSlotState,
  type CatalogSlotStateStore,
  CatalogSlotStore,
  activateCatalogSlot,
  catalogSlotDatabasePath,
  discardCatalogSlot,
  inactiveCatalogSlot,
  recordValidatedCatalogSlot,
  rollbackCatalogSlot,
  slotMetadataFromManifest
} from './catalogSlots';

export interface CatalogDatabase {
  exec(input: string | {
    readonly sql: string;
    readonly bind?: readonly unknown[];
    readonly rowMode?: 'object';
    readonly callback?: (row: Record<string, unknown>) => void;
  }): unknown;
  selectValue(sql: string, bind?: readonly unknown[]): unknown;
  close(): void;
}

export interface CatalogPool {
  readonly OpfsSAHPoolDb: new (filename: string, flags?: string) => CatalogDatabase;
  getFileNames(): string[];
  importDb(filename: string, bytes: Uint8Array): unknown;
  exportFile(filename: string): Uint8Array;
  unlink(filename: string): unknown;
}

export type CatalogPools = Readonly<Record<CatalogSlotId, CatalogPool>>;
export interface CatalogRuntimeHandle { readonly database: CatalogDatabase; readonly status: CatalogStatus }
interface Options { readonly store?: CatalogSlotStateStore; readonly fetcher?: typeof fetch; readonly now?: () => string }
interface Opened { readonly database: CatalogDatabase; readonly metadata: CatalogSlotMetadata }
type Publish = (status: CatalogStatus) => void;

const PRODUCT_COLUMNS = ['id', 'g', 'n', 'b', 'c', 's', 'q', 'u', 'm', 'r'];
const BRAND_COLUMNS = ['id', 'v'];
const SMOKE_QUERY = 'kinder bueno';
const SMOKE_BARCODE = '4008400322728';
const PRODUCT_BY_ID_SQL = `
SELECT p.id,p.g,p.n,d.v AS brand,p.c,p.s,p.q,p.u,p.m,p.r
FROM p LEFT JOIN d ON d.id=p.b
WHERE p.id=? LIMIT 1`;

function queryRows<T extends Record<string, unknown>>(
  database: CatalogDatabase,
  sql: string,
  bind: readonly unknown[] = []
): T[] {
  const result: T[] = [];
  database.exec({ sql, bind, rowMode: 'object', callback: (row) => result.push(row as T) });
  return result;
}

function close(database: CatalogDatabase | null): void {
  try { database?.close(); } catch { /* validation authority already decided */ }
}

function clear(pool: CatalogPool): void {
  for (const file of pool.getFileNames()) {
    try { pool.unlink(file); } catch { /* inactive cleanup is best effort */ }
  }
}

function projectedSlotStates(
  state: CatalogSlotState,
  staging: CatalogSlotId | null = null
): CatalogStatus['slotStates'] {
  const project = (slot: CatalogSlotId): CatalogStatus['slotStates'][CatalogSlotId] => {
    if (state.activeSlot === slot) return 'active';
    if (staging === slot) return 'staging';
    return state.slots[slot] ? 'verified' : 'empty';
  };
  return { a: project('a'), b: project('b') };
}

function ready(
  metadata: CatalogSlotMetadata,
  state: CatalogSlotState,
  diagnostics: CatalogDiagnostics | null = null
): CatalogStatus {
  return {
    state: 'ready', activeSlot: metadata.slot, rollbackSlot: state.rollbackSlot,
    slotStates: projectedSlotStates(state), catalogVersion: metadata.catalogVersion,
    productCount: metadata.productCount, persistent: true, progress: 1, diagnostics,
    retryAllowedImmediately: true
  };
}

function transient(
  state: 'checking' | 'downloading' | 'installing',
  slotState: CatalogSlotState,
  metadata: CatalogSlotMetadata | null,
  progress: number | null,
  staging: CatalogSlotId | null = null
): CatalogStatus {
  return {
    state, activeSlot: metadata?.slot ?? null, rollbackSlot: slotState.rollbackSlot,
    slotStates: projectedSlotStates(slotState, staging), catalogVersion: metadata?.catalogVersion ?? null,
    productCount: metadata?.productCount ?? null, persistent: metadata !== null, progress,
    diagnostics: null, retryAllowedImmediately: true
  };
}

async function hash(bytes: Uint8Array): Promise<string> {
  const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
}

function exactColumns(database: CatalogDatabase, table: string, expected: readonly string[]): boolean {
  const actual = queryRows(database, `PRAGMA table_info(${table})`).map((row) => String(row.name ?? ''));
  return actual.length === expected.length && actual.every((name, index) => name === expected[index]);
}

function validate(database: CatalogDatabase, expected: CatalogManifest | CatalogSlotMetadata): void {
  const slot = 'slot' in expected ? expected.slot : null;
  const common = { operation: 'validate' as const, activeSlot: slot, catalogVersion: expected.catalogVersion };
  const applicationId = Number(database.selectValue('PRAGMA application_id'));
  if (applicationId !== expected.applicationId) {
    throw new CatalogFailure('CATALOG_APPLICATION_ID_MISMATCH', 'SQLite application_id passt nicht zum Manifest.', {
      ...common, details: { expectedApplicationId: expected.applicationId, applicationId }
    });
  }
  const userVersion = Number(database.selectValue('PRAGMA user_version'));
  if (userVersion !== expected.userVersion) {
    throw new CatalogFailure('CATALOG_USER_VERSION_MISMATCH', 'SQLite user_version passt nicht zum Manifest.', {
      ...common, details: { expectedUserVersion: expected.userVersion, userVersion }
    });
  }
  const pageSize = Number(database.selectValue('PRAGMA page_size'));
  if (pageSize !== expected.pageSize) {
    throw new CatalogFailure('CATALOG_SCHEMA_MISMATCH', 'SQLite page_size passt nicht zum Manifest.', {
      ...common, details: { expectedPageSize: expected.pageSize, pageSize }
    });
  }
  if (!exactColumns(database, 'p', PRODUCT_COLUMNS) || !exactColumns(database, 'd', BRAND_COLUMNS)) {
    throw new CatalogFailure('CATALOG_SCHEMA_MISMATCH', 'Die Production-v1-Tabellenspalten stimmen nicht exakt.', common);
  }
  const fts = String(database.selectValue("SELECT sql FROM sqlite_schema WHERE type='table' AND name='x'") ?? '');
  if (!/\bfts5\s*\(/i.test(fts) || !/content\s*=\s*''/i.test(fts)) {
    throw new CatalogFailure('CATALOG_SCHEMA_MISMATCH', 'Der contentless FTS5-Suchindex x fehlt.', common);
  }
  const integrity = queryRows(database, 'PRAGMA integrity_check').map((row) => String(Object.values(row)[0] ?? ''));
  if (integrity.length !== 1 || integrity[0] !== 'ok') {
    throw new CatalogFailure('CATALOG_INTEGRITY_FAILED', 'SQLite integrity_check ist fehlgeschlagen.', {
      ...common, details: { integrity: integrity.join('; ') || 'empty' }
    });
  }
  const productCount = Number(database.selectValue('SELECT count(*) FROM p'));
  if (productCount !== expected.productCount) {
    throw new CatalogFailure('CATALOG_PRODUCT_COUNT_MISMATCH', 'Die Produktanzahl passt nicht zum Manifest.', {
      ...common, details: { expectedProductCount: expected.productCount, productCount }
    });
  }
  const brandCount = Number(database.selectValue('SELECT count(*) FROM d'));
  if (brandCount !== expected.brandCount) {
    throw new CatalogFailure('CATALOG_SCHEMA_MISMATCH', 'Die Markenanzahl passt nicht zum Manifest.', {
      ...common, details: { expectedBrandCount: expected.brandCount, brandCount }
    });
  }
  const ftsQuery = buildCatalogFtsQuery(SMOKE_QUERY);
  const textHits = ftsQuery
    ? queryRows<CatalogSqlRow>(database, CATALOG_SEARCH_SQL, [ftsQuery, SMOKE_QUERY, SMOKE_QUERY, SMOKE_QUERY, 1])
    : [];
  if (textHits.length !== 1) {
    throw new CatalogFailure('CATALOG_QUERY_FAILED', 'Die reale Text-Smoke-Query lieferte kein Ergebnis.', common);
  }
  const packed = packStandardGtin(SMOKE_BARCODE);
  const barcodeHits = packed === null ? [] : queryRows(database, PRODUCT_BY_ID_SQL, [packed]);
  const rescueHits = barcodeHits.length ? [] : queryRows(database, CATALOG_RESCUE_BARCODE_SQL, [SMOKE_BARCODE]);
  if (barcodeHits.length !== 1 && rescueHits.length !== 1) {
    throw new CatalogFailure('CATALOG_QUERY_FAILED', 'Die reale Barcode-Smoke-Query lieferte kein Ergebnis.', common);
  }
}

async function download(
  fetcher: typeof fetch,
  manifest: CatalogManifest,
  baseUrl: string,
  activeSlot: CatalogSlotId | null
): Promise<Uint8Array> {
  let response: Response;
  try {
    response = await fetcher(resolveCatalogArtifactUrl(manifest, baseUrl), {
      cache: 'no-store', credentials: 'same-origin'
    });
  } catch (cause) {
    throw new CatalogFailure('CATALOG_DOWNLOAD_FAILED', 'Der SQLite-Katalog konnte nicht geladen werden.', {
      operation: 'download', activeSlot, catalogVersion: manifest.catalogVersion, cause
    });
  }
  if (!response.ok) {
    throw new CatalogFailure('CATALOG_DOWNLOAD_FAILED', `SQLite-Katalog nicht erreichbar (HTTP ${response.status}).`, {
      operation: 'download', activeSlot, catalogVersion: manifest.catalogVersion, details: { status: response.status }
    });
  }
  const declared = response.headers.get('content-length');
  const bytes = new Uint8Array(await response.arrayBuffer());
  if ((declared !== null && Number(declared) !== manifest.sizeBytes) || bytes.byteLength !== manifest.sizeBytes) {
    throw new CatalogFailure('CATALOG_SIZE_MISMATCH', 'Die Byte-Länge des SQLite-Katalogs passt nicht zum Manifest.', {
      operation: 'download', activeSlot, catalogVersion: manifest.catalogVersion,
      details: { expectedBytes: manifest.sizeBytes, actualBytes: bytes.byteLength }
    });
  }
  const actual = await hash(bytes);
  if (actual !== manifest.sha256) {
    throw new CatalogFailure('CATALOG_HASH_MISMATCH', 'Die SHA-256-Prüfung des SQLite-Katalogs ist fehlgeschlagen.', {
      operation: 'download', activeSlot, catalogVersion: manifest.catalogVersion,
      details: { expectedSha256: manifest.sha256, actualSha256: actual }
    });
  }
  return bytes;
}

export class CatalogInstaller {
  private readonly store: CatalogSlotStateStore;
  private readonly fetcher: typeof fetch;
  private readonly now: () => string;

  constructor(private readonly pools: CatalogPools, options: Options = {}) {
    this.store = options.store ?? new CatalogSlotStore();
    this.fetcher = options.fetcher ?? fetch;
    this.now = options.now ?? (() => new Date().toISOString());
  }

  async bootstrap(manifestUrl: string, catalogBaseUrl: string, publish: Publish = () => undefined): Promise<CatalogRuntimeHandle> {
    let state = await this.store.read();
    publish(transient('checking', state, null, null));
    const recovered = await this.recover(state);
    state = recovered.state;
    let activeDatabase = recovered.opened?.database ?? null;
    const activeMetadata = recovered.opened?.metadata ?? null;
    if (activeMetadata) publish(ready(activeMetadata, state, recovered.diagnostics));

    let manifest: CatalogManifest;
    try {
      manifest = await fetchCatalogManifest(manifestUrl, undefined, this.fetcher);
    } catch (error) {
      if (activeDatabase && activeMetadata) {
        const failure = toCatalogFailure(error, 'CATALOG_MANIFEST_UNAVAILABLE', 'Das Katalogmanifest ist nicht verfügbar; der validierte Slot bleibt aktiv.', {
          operation: 'manifest', activeSlot: activeMetadata.slot, catalogVersion: activeMetadata.catalogVersion
        });
        const status = ready(activeMetadata, state, failure.diagnostics);
        publish(status);
        return { database: activeDatabase, status };
      }
      throw error;
    }

    if (activeDatabase && activeMetadata
      && activeMetadata.sha256 === manifest.sha256
      && activeMetadata.catalogVersion === manifest.catalogVersion
      && activeMetadata.filename === manifest.filename) {
      const status = ready(activeMetadata, state, recovered.diagnostics);
      publish(status);
      return { database: activeDatabase, status };
    }

    publish(transient('downloading', state, activeMetadata, 0));
    let bytes: Uint8Array;
    try {
      bytes = await download(this.fetcher, manifest, catalogBaseUrl, state.activeSlot);
    } catch (error) {
      return this.fallback(error, activeDatabase, activeMetadata, state, publish);
    }

    const target = inactiveCatalogSlot(state.activeSlot);
    publish(transient('installing', state, activeMetadata, 0.5, target));
    const pool = this.pools[target];
    const path = catalogSlotDatabasePath(manifest.filename);
    let checking: CatalogDatabase | null = null;
    try {
      clear(pool);
      pool.importDb(path, bytes);
      const persisted = pool.exportFile(path);
      if (persisted.byteLength !== manifest.sizeBytes || await hash(persisted) !== manifest.sha256) {
        throw new CatalogFailure('CATALOG_HASH_MISMATCH', 'Der persistierte inaktive Slot stimmt nicht mit dem Manifest überein.', {
          operation: 'validate', activeSlot: state.activeSlot, attemptedSlot: target,
          catalogVersion: manifest.catalogVersion
        });
      }
      checking = new pool.OpfsSAHPoolDb(path, 'r');
      checking.exec('PRAGMA query_only=ON; PRAGMA temp_store=MEMORY;');
      validate(checking, manifest);
      close(checking);
      checking = null;

      const metadata = slotMetadataFromManifest(target, manifest, this.now());
      const activated = activateCatalogSlot(
        recordValidatedCatalogSlot(discardCatalogSlot(state, target), metadata),
        target
      );
      await this.store.write(activated);

      let opened: CatalogDatabase | null = null;
      try {
        opened = new pool.OpfsSAHPoolDb(path, 'r');
        opened.exec('PRAGMA query_only=ON; PRAGMA temp_store=MEMORY;');
        validate(opened, metadata);
      } catch (error) {
        close(opened);
        await this.store.write(state);
        clear(pool);
        return this.fallback(
          toCatalogFailure(error, 'CATALOG_OPEN_FAILED', 'Der aktivierte Slot konnte nicht geöffnet werden; der vorherige Slot bleibt aktiv.', {
            operation: 'rollback', activeSlot: state.activeSlot, attemptedSlot: target,
            catalogVersion: activeMetadata?.catalogVersion ?? null
          }),
          activeDatabase,
          activeMetadata,
          state,
          publish
        );
      }
      close(activeDatabase);
      activeDatabase = null;
      const status = ready(metadata, activated);
      publish(status);
      return { database: opened as CatalogDatabase, status };
    } catch (error) {
      close(checking);
      clear(pool);
      return this.fallback(error, activeDatabase, activeMetadata, state, publish);
    }
  }

  private async recover(state: CatalogSlotState): Promise<{
    readonly state: CatalogSlotState;
    readonly opened: Opened | null;
    readonly diagnostics: CatalogDiagnostics | null;
  }> {
    if (!state.activeSlot) return { state, opened: null, diagnostics: null };
    const failed = state.activeSlot;
    try {
      return { state, opened: await this.open(failed, state.slots[failed] as CatalogSlotMetadata), diagnostics: null };
    } catch (cause) {
      if (state.rollbackSlot && state.slots[state.rollbackSlot]) {
        const rollback = state.rollbackSlot;
        try {
          const opened = await this.open(rollback, state.slots[rollback] as CatalogSlotMetadata);
          const next = rollbackCatalogSlot(state);
          await this.store.write(next);
          clear(this.pools[failed]);
          const failure = new CatalogFailure('CATALOG_OPEN_FAILED', 'Der aktive Slot war ungültig; der vorherige validierte Slot wurde wiederhergestellt.', {
            operation: 'rollback', activeSlot: rollback, attemptedSlot: failed,
            catalogVersion: opened.metadata.catalogVersion, cause
          });
          return { state: next, opened, diagnostics: failure.diagnostics };
        } catch (rollbackError) {
          clear(this.pools[failed]);
          clear(this.pools[rollback]);
          const empty = discardCatalogSlot(discardCatalogSlot(state, failed), rollback);
          await this.store.write(empty);
          throw toCatalogFailure(rollbackError, 'CATALOG_OPEN_FAILED', 'Aktiver Katalog und Rollback-Slot sind ungültig.', {
            operation: 'rollback', activeSlot: failed, attemptedSlot: rollback
          });
        }
      }
      clear(this.pools[failed]);
      const empty = discardCatalogSlot(state, failed);
      await this.store.write(empty);
      return { state: empty, opened: null, diagnostics: null };
    }
  }

  private async open(slot: CatalogSlotId, metadata: CatalogSlotMetadata): Promise<Opened> {
    const pool = this.pools[slot];
    const path = catalogSlotDatabasePath(metadata.filename);
    if (!pool.getFileNames().includes(path)) {
      throw new CatalogFailure('CATALOG_OPEN_FAILED', 'Der persistierte Katalogslot fehlt im OPFS.', {
        operation: 'open', activeSlot: slot, catalogVersion: metadata.catalogVersion
      });
    }
    const bytes = pool.exportFile(path);
    if (bytes.byteLength !== metadata.sizeBytes || await hash(bytes) !== metadata.sha256) {
      throw new CatalogFailure('CATALOG_HASH_MISMATCH', 'Der persistierte Katalogslot stimmt nicht mit seinen validierten Metadaten überein.', {
        operation: 'open', activeSlot: slot, catalogVersion: metadata.catalogVersion
      });
    }
    let database: CatalogDatabase | null = null;
    try {
      database = new pool.OpfsSAHPoolDb(path, 'r');
      database.exec('PRAGMA query_only=ON; PRAGMA temp_store=MEMORY;');
      validate(database, metadata);
      return { database, metadata };
    } catch (error) {
      close(database);
      throw error;
    }
  }

  private fallback(
    error: unknown,
    database: CatalogDatabase | null,
    metadata: CatalogSlotMetadata | null,
    state: CatalogSlotState,
    publish: Publish
  ): CatalogRuntimeHandle {
    if (database && metadata) {
      const failure = isCatalogFailure(error)
        ? error
        : new CatalogFailure('CATALOG_UNKNOWN', 'Das Katalogupdate ist fehlgeschlagen; der vorherige Slot bleibt aktiv.', {
            operation: 'install', activeSlot: metadata.slot, catalogVersion: metadata.catalogVersion, cause: error
          });
      const status = ready(metadata, state, failure.diagnostics);
      publish(status);
      return { database, status };
    }
    if (isCatalogFailure(error)) throw error;
    throw new CatalogFailure('CATALOG_UNKNOWN', 'Kein validierter Produktkatalog ist verfügbar.', {
      operation: 'initialize', cause: error
    });
  }
}
