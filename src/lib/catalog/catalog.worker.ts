/// <reference lib="webworker" />

import {
  CATALOG_RESCUE_BARCODE_SQL,
  CATALOG_SEARCH_SQL,
  buildCatalogFtsQuery,
  packStandardGtin
} from '../../../Catalog/catalog-runtime.generated';
import type { CatalogProduct, CatalogSearchHit, CatalogStatus } from './catalogDomain';
import { CatalogFailure, isCatalogFailure, toCatalogFailure } from './catalogErrors';
import {
  type CatalogDatabase,
  CatalogInstaller,
  type CatalogOpenResult,
  type CatalogSlotStorage
} from './catalogInstaller';
import { type CatalogSqlRow, projectCatalogProductRow, projectCatalogSearchRows } from './catalogProjection';
import type {
  CatalogRuntimeFacts,
  CatalogStatusEnvelope,
  CatalogWorkerFailure,
  CatalogWorkerRequest,
  CatalogWorkerResponse
} from './catalogProtocol';
import {
  CATALOG_SLOT_FILES,
  type CatalogActivationStore,
  IndexedDbCatalogActivationStore
} from './catalogSlots';
import type { CatalogSlotId } from './catalogDomain';

const PRODUCT_BY_ID_SQL = `
SELECT p.id,p.g,p.n,d.v AS brand,p.c,p.s,p.q,p.u,p.m,p.r
FROM p LEFT JOIN d ON d.id=p.b
WHERE p.id=? LIMIT 1`;

interface OpfsSahPool {
  readonly OpfsSAHPoolDb: new (filename: string, flags?: string) => CatalogDatabase;
  getFileNames(): string[];
  importDb(filename: string, bytes: Uint8Array): Promise<number> | number;
  exportFile(filename: string): Promise<Uint8Array> | Uint8Array;
  unlink(filename: string): boolean;
  reserveMinimumCapacity(capacity: number): Promise<void>;
}

interface SqliteRuntime {
  installOpfsSAHPoolVfs(options: {
    readonly name: string;
    readonly directory: string;
    readonly initialCapacity: number;
  }): Promise<OpfsSahPool>;
}

interface WorkerPort {
  postMessage(message: CatalogWorkerResponse): void;
}

interface RuntimeUrls {
  readonly sqliteModuleUrl: string;
  readonly manifestUrl: string;
  readonly catalogBaseUrl: string;
}

interface CatalogWorkerDependencies {
  readonly port: WorkerPort;
  readonly loadSqlite?: (moduleUrl: string) => Promise<SqliteRuntime>;
  readonly activationStore?: CatalogActivationStore;
  readonly fetch?: typeof fetch;
  readonly urls?: RuntimeUrls;
}

const EMPTY_RUNTIME_FACTS: CatalogRuntimeFacts = {
  persistent: false,
  installedFromNetwork: false,
  rollbackAvailable: false,
  activeSlotFile: null
};

const INITIAL_STATUS: CatalogStatus = {
  state: 'uninitialized',
  activeSlot: null,
  catalogVersion: null,
  productCount: null,
  progress: null,
  diagnostics: null,
  retryAllowedImmediately: true
};

function deriveRuntimeUrls(workerUrl: string): RuntimeUrls {
  const location = new URL(workerUrl);
  const assetsMarker = '/assets/';
  const markerIndex = location.pathname.lastIndexOf(assetsMarker);
  const base = markerIndex >= 0
    ? new URL(location.pathname.slice(0, markerIndex + 1), location.origin)
    : new URL('./', location);
  return {
    sqliteModuleUrl: new URL('vendor/sqlite/index.mjs', base).href,
    manifestUrl: new URL('catalog/manifest.json', base).href,
    catalogBaseUrl: new URL('catalog/', base).href
  };
}

async function defaultLoadSqlite(moduleUrl: string): Promise<SqliteRuntime> {
  let imported: { default?: unknown };
  try {
    imported = await import(/* @vite-ignore */ moduleUrl) as { default?: unknown };
  } catch (cause) {
    throw new CatalogFailure('CATALOG_UNSUPPORTED', 'Das SQLite-WASM-Modul konnte nicht geladen werden.', {
      operation: 'initialize',
      cause
    });
  }
  if (typeof imported.default !== 'function') {
    throw new CatalogFailure('CATALOG_UNSUPPORTED', 'Das SQLite-WASM-Modul besitzt keinen gültigen Initialisierer.', {
      operation: 'initialize'
    });
  }
  const sqlite = await (imported.default as (options: Record<string, unknown>) => Promise<SqliteRuntime>)({
    locateFile: (filename: string) => new URL(filename, moduleUrl).href,
    print: () => undefined,
    printErr: (...args: unknown[]) => console.warn('[sqlite-wasm]', ...args)
  });
  if (typeof sqlite.installOpfsSAHPoolVfs !== 'function') {
    throw new CatalogFailure('CATALOG_UNSUPPORTED', 'Dieser Browser bietet keinen kompatiblen OPFS-SAH-Pool.', {
      operation: 'initialize'
    });
  }
  return sqlite;
}

class OpfsCatalogSlotStorage implements CatalogSlotStorage {
  constructor(private readonly pool: OpfsSahPool) {}

  hasSlot(slot: CatalogSlotId): boolean {
    return this.pool.getFileNames().includes(CATALOG_SLOT_FILES[slot]);
  }

  async importSlot(slot: CatalogSlotId, bytes: Uint8Array): Promise<void> {
    await this.pool.importDb(CATALOG_SLOT_FILES[slot], bytes);
  }

  removeSlot(slot: CatalogSlotId): void {
    const filename = CATALOG_SLOT_FILES[slot];
    if (this.pool.getFileNames().includes(filename)) this.pool.unlink(filename);
  }

  async readSlot(slot: CatalogSlotId): Promise<Uint8Array> {
    return this.pool.exportFile(CATALOG_SLOT_FILES[slot]);
  }

  openSlot(slot: CatalogSlotId): CatalogDatabase {
    const database = new this.pool.OpfsSAHPoolDb(CATALOG_SLOT_FILES[slot], 'r');
    database.exec('PRAGMA query_only=ON; PRAGMA temp_store=MEMORY;');
    return database;
  }
}

function rows<T extends Record<string, unknown>>(
  database: CatalogDatabase,
  sql: string,
  bind: readonly unknown[] = []
): T[] {
  const result: T[] = [];
  database.exec({
    sql,
    bind,
    rowMode: 'object',
    callback: (row) => result.push(row as T)
  });
  return result;
}

export function queryCatalogSearch(
  database: CatalogDatabase,
  query: string,
  requestedLimit: number
): readonly CatalogSearchHit[] {
  const canonical = query.normalize('NFKC').trim();
  const ftsQuery = buildCatalogFtsQuery(canonical);
  if (!ftsQuery) return [];
  const limit = Math.max(1, Math.min(20, Math.trunc(requestedLimit) || 20));
  const sqlRows = rows<CatalogSqlRow>(database, CATALOG_SEARCH_SQL, [
    ftsQuery,
    canonical,
    canonical,
    canonical,
    limit
  ]);
  return projectCatalogSearchRows(sqlRows);
}

export function queryCatalogProduct(database: CatalogDatabase, inputCode: string): CatalogProduct | null {
  const code = inputCode.replace(/\D/g, '');
  if (!code || code.length > 14) return null;
  const packed = packStandardGtin(code);
  const sqlRows = packed === null
    ? rows<CatalogSqlRow>(database, CATALOG_RESCUE_BARCODE_SQL, [code])
    : rows<CatalogSqlRow>(database, PRODUCT_BY_ID_SQL, [packed]);
  return sqlRows.length ? projectCatalogProductRow(sqlRows[0]) : null;
}

function runtimeFacts(result: CatalogOpenResult): CatalogRuntimeFacts {
  return {
    persistent: true,
    installedFromNetwork: result.installedFromNetwork,
    rollbackAvailable: result.activation.previousSlot !== null,
    activeSlotFile: CATALOG_SLOT_FILES[result.activation.activeSlot]
  };
}

export class CatalogWorkerRuntime {
  private readonly loadSqlite: (moduleUrl: string) => Promise<SqliteRuntime>;
  private readonly activationStore: CatalogActivationStore;
  private readonly fetcher: typeof fetch;
  private readonly urls: RuntimeUrls;
  private sqlite: SqliteRuntime | null = null;
  private installer: CatalogInstaller | null = null;
  private database: CatalogDatabase | null = null;
  private status: CatalogStatus = INITIAL_STATUS;
  private facts: CatalogRuntimeFacts = EMPTY_RUNTIME_FACTS;
  private initialization: Promise<CatalogStatusEnvelope> | null = null;
  private lifecycleQueue: Promise<void> = Promise.resolve();

  constructor(private readonly dependencies: CatalogWorkerDependencies) {
    this.loadSqlite = dependencies.loadSqlite ?? defaultLoadSqlite;
    this.activationStore = dependencies.activationStore ?? new IndexedDbCatalogActivationStore();
    this.fetcher = dependencies.fetch ?? fetch;
    const workerHref = typeof self !== 'undefined' && self.location ? self.location.href : import.meta.url;
    this.urls = dependencies.urls ?? deriveRuntimeUrls(workerHref);
  }

  currentStatus(): CatalogStatusEnvelope {
    return { status: this.status, runtime: this.facts };
  }

  private publish(status: CatalogStatus, facts = this.facts): CatalogStatusEnvelope {
    this.status = status;
    this.facts = facts;
    const envelope = this.currentStatus();
    this.dependencies.port.postMessage({
      requestId: 'status-event',
      ok: true,
      type: 'status-event',
      result: envelope
    });
    return envelope;
  }

  private async ensureInstaller(): Promise<CatalogInstaller> {
    if (this.installer) return this.installer;
    try {
      this.sqlite ??= await this.loadSqlite(this.urls.sqliteModuleUrl);
      const pool = await this.sqlite.installOpfsSAHPoolVfs({
        name: 'kh-checker-catalog-ab-v1',
        directory: '.kh-checker-catalog-ab-v1',
        initialCapacity: 8
      });
      await pool.reserveMinimumCapacity(8);
      this.installer = new CatalogInstaller({
        storage: new OpfsCatalogSlotStorage(pool),
        activations: this.activationStore,
        fetch: this.fetcher
      });
      return this.installer;
    } catch (error) {
      throw toCatalogFailure(error, 'CATALOG_STORAGE_UNAVAILABLE', 'Der persistente A/B-Katalogspeicher konnte nicht initialisiert werden.', {
        operation: 'initialize',
        activeSlot: this.status.activeSlot,
        catalogVersion: this.status.catalogVersion
      });
    }
  }

  private adopt(result: CatalogOpenResult): CatalogStatusEnvelope {
    const previous = this.database;
    this.database = result.database;
    if (previous && previous !== result.database) {
      try { previous.close(); } catch { /* replacement is already active */ }
    }
    return this.publish({
      state: 'ready',
      activeSlot: result.activation.activeSlot,
      catalogVersion: result.activation.catalogVersion,
      productCount: result.productCount,
      progress: null,
      diagnostics: result.diagnostics,
      retryAllowedImmediately: true
    }, runtimeFacts(result));
  }

  private unavailable(error: CatalogFailure): void {
    this.publish({
      state: 'unavailable',
      activeSlot: error.diagnostics.activeSlot,
      catalogVersion: error.diagnostics.catalogVersion,
      productCount: null,
      progress: null,
      diagnostics: error.diagnostics,
      retryAllowedImmediately: true
    }, EMPTY_RUNTIME_FACTS);
  }

  private schedule<T>(work: () => Promise<T>): Promise<T> {
    const task = this.lifecycleQueue.then(work, work);
    this.lifecycleQueue = task.then(() => undefined, () => undefined);
    return task;
  }

  initialize(): Promise<CatalogStatusEnvelope> {
    if (this.status.state === 'ready' && this.database) return Promise.resolve(this.currentStatus());
    if (this.initialization) return this.initialization;
    const task = this.schedule(async () => {
      this.publish({ ...this.status, state: 'checking', progress: null, diagnostics: null });
      try {
        const installer = await this.ensureInstaller();
        this.publish({ ...this.status, state: 'installing', progress: null, diagnostics: null });
        return this.adopt(await installer.initialize(this.urls.manifestUrl, this.urls.catalogBaseUrl));
      } catch (error) {
        const catalogFailure = isCatalogFailure(error)
          ? error
          : toCatalogFailure(error, 'CATALOG_UNKNOWN', 'Der lokale Produktkatalog konnte nicht initialisiert werden.', {
              operation: 'initialize'
            });
        this.unavailable(catalogFailure);
        throw catalogFailure;
      }
    });
    this.initialization = task;
    void task.finally(() => {
      if (this.initialization === task) this.initialization = null;
    }).catch(() => undefined);
    return task;
  }

  retryUpdate(): Promise<CatalogStatusEnvelope> {
    if (!this.database) return this.initialize();
    return this.schedule(async () => {
      const previousStatus = this.status;
      const previousFacts = this.facts;
      this.publish({ ...previousStatus, state: 'checking', progress: null, diagnostics: null }, previousFacts);
      try {
        const installer = await this.ensureInstaller();
        return this.adopt(await installer.installUpdate(this.urls.manifestUrl, this.urls.catalogBaseUrl));
      } catch (error) {
        const catalogFailure = isCatalogFailure(error)
          ? error
          : toCatalogFailure(error, 'CATALOG_UNKNOWN', 'Die Katalogaktualisierung ist fehlgeschlagen.', {
              operation: 'install',
              activeSlot: previousStatus.activeSlot,
              catalogVersion: previousStatus.catalogVersion
            });
        if (this.database && previousStatus.activeSlot) {
          return this.publish({
            ...previousStatus,
            state: 'ready',
            progress: null,
            diagnostics: catalogFailure.diagnostics
          }, previousFacts);
        }
        this.unavailable(catalogFailure);
        throw catalogFailure;
      }
    });
  }

  search(query: string, limit: number): readonly CatalogSearchHit[] {
    if (!this.database) {
      throw new CatalogFailure('CATALOG_NOT_READY', 'Der lokale Produktkatalog ist noch nicht einsatzbereit.', {
        operation: 'search',
        activeSlot: this.status.activeSlot,
        catalogVersion: this.status.catalogVersion
      });
    }
    try {
      return queryCatalogSearch(this.database, query, limit);
    } catch (error) {
      throw toCatalogFailure(error, 'CATALOG_QUERY_FAILED', 'Die lokale Produktsuche ist fehlgeschlagen.', {
        operation: 'search',
        activeSlot: this.status.activeSlot,
        catalogVersion: this.status.catalogVersion,
        details: { resultLimit: Math.max(1, Math.min(20, Math.trunc(limit) || 20)) }
      });
    }
  }

  product(code: string): CatalogProduct | null {
    if (!this.database) {
      throw new CatalogFailure('CATALOG_NOT_READY', 'Der lokale Produktkatalog ist noch nicht einsatzbereit.', {
        operation: 'product_lookup',
        activeSlot: this.status.activeSlot,
        catalogVersion: this.status.catalogVersion
      });
    }
    try {
      return queryCatalogProduct(this.database, code);
    } catch (error) {
      throw toCatalogFailure(error, 'CATALOG_QUERY_FAILED', 'Die lokale Barcode-Suche ist fehlgeschlagen.', {
        operation: 'product_lookup',
        activeSlot: this.status.activeSlot,
        catalogVersion: this.status.catalogVersion
      });
    }
  }

  async handle(request: CatalogWorkerRequest): Promise<CatalogWorkerResponse> {
    try {
      if (request.type === 'initialize') {
        return { requestId: request.requestId, ok: true, type: 'status', result: await this.initialize() };
      }
      if (request.type === 'retry-update') {
        return { requestId: request.requestId, ok: true, type: 'status', result: await this.retryUpdate() };
      }
      if (request.type === 'status') {
        return { requestId: request.requestId, ok: true, type: 'status', result: this.currentStatus() };
      }
      if (request.type === 'search') {
        return { requestId: request.requestId, ok: true, type: 'search', result: this.search(request.query, request.limit) };
      }
      return { requestId: request.requestId, ok: true, type: 'product', result: this.product(request.code) };
    } catch (error) {
      return this.failureResponse(request.requestId, error, request.type);
    }
  }

  terminate(): void {
    try { this.database?.close(); } catch { /* worker shutdown */ }
    this.database = null;
  }

  private failureResponse(
    requestId: string,
    error: unknown,
    requestType: CatalogWorkerRequest['type']
  ): CatalogWorkerFailure {
    const operation = requestType === 'search'
      ? 'search'
      : requestType === 'product'
        ? 'product_lookup'
        : requestType === 'retry-update'
          ? 'install'
          : 'initialize';
    const catalogFailure = isCatalogFailure(error)
      ? error
      : toCatalogFailure(error, 'CATALOG_UNKNOWN', 'Der Katalogworker ist unerwartet fehlgeschlagen.', {
          operation,
          activeSlot: this.status.activeSlot,
          catalogVersion: this.status.catalogVersion
        });
    return {
      requestId,
      ok: false,
      error: {
        name: 'CatalogFailure',
        message: catalogFailure.message,
        code: catalogFailure.code,
        diagnostics: catalogFailure.diagnostics
      }
    };
  }
}

const workerScope = typeof self !== 'undefined' ? self as DedicatedWorkerGlobalScope : null;
if (workerScope) {
  const runtime = new CatalogWorkerRuntime({ port: workerScope });
  workerScope.addEventListener('message', (event: MessageEvent<CatalogWorkerRequest>) => {
    void runtime.handle(event.data).then((response) => workerScope.postMessage(response));
  });
  workerScope.addEventListener('close', () => runtime.terminate());
}
