/// <reference lib="webworker" />

import {
  CATALOG_RESCUE_BARCODE_SQL,
  CATALOG_SEARCH_SQL,
  buildCatalogFtsQuery,
  packStandardGtin
} from '../../../Catalog/catalog-runtime.generated';
import type { CatalogProduct, CatalogSearchHit, CatalogStatus } from './catalogDomain';
import { CatalogFailure, isCatalogFailure, toCatalogFailure } from './catalogErrors';
import { type CatalogDatabase, CatalogInstaller, type CatalogPool, type CatalogPools } from './catalogInstaller';
import { type CatalogSqlRow, projectCatalogProductRow, projectCatalogSearchRows } from './catalogProjection';
import type { CatalogWorkerRequest, CatalogWorkerResponse } from './catalogProtocol';

const workerScope: DedicatedWorkerGlobalScope = self as DedicatedWorkerGlobalScope;
const PRODUCT_BY_ID_SQL = `
SELECT p.id,p.g,p.n,d.v AS brand,p.c,p.s,p.q,p.u,p.m,p.r
FROM p LEFT JOIN d ON d.id=p.b
WHERE p.id=? LIMIT 1`;

interface SqliteModule {
  installOpfsSAHPoolVfs(options: {
    name: string;
    directory: string;
    initialCapacity: number;
  }): Promise<CatalogPool & { reserveMinimumCapacity(capacity: number): Promise<void> }>;
}

interface RuntimeConfig {
  readonly sqliteModuleUrl: string;
  readonly manifestUrl: string;
  readonly catalogBaseUrl: string;
}

let sqlite: SqliteModule | null = null;
let pools: CatalogPools | null = null;
let installer: CatalogInstaller | null = null;
let runtimeDatabase: CatalogDatabase | null = null;
let initialization: Promise<CatalogStatus> | null = null;
let lifecycleQueue: Promise<void> = Promise.resolve();
let status: CatalogStatus = {
  state: 'uninitialized',
  activeSlot: null,
  catalogVersion: null,
  productCount: null,
  progress: null,
  diagnostics: null,
  retryAllowedImmediately: true
};

function publishStatus(next: CatalogStatus): void {
  status = next;
  workerScope.postMessage({ id: 0, ok: true, type: 'status-event', result: next } satisfies CatalogWorkerResponse);
}

function rows<T extends Record<string, unknown>>(
  database: CatalogDatabase,
  sql: string,
  bind: readonly unknown[] = []
): T[] {
  const result: T[] = [];
  database.exec({ sql, bind, rowMode: 'object', callback: (row: unknown) => result.push(row as T) });
  return result;
}

async function ensureRuntime(config: RuntimeConfig): Promise<void> {
  if (!sqlite) {
    let imported: { default?: unknown };
    try {
      imported = await import(/* @vite-ignore */ config.sqliteModuleUrl) as { default?: unknown };
    } catch (error) {
      throw new CatalogFailure('CATALOG_UNSUPPORTED', 'Das ausgelieferte SQLite-WASM-Modul konnte nicht geladen werden.', {
        operation: 'initialize', cause: error
      });
    }
    if (typeof imported.default !== 'function') {
      throw new CatalogFailure('CATALOG_UNSUPPORTED', 'Das ausgelieferte SQLite-WASM-Modul ist ungültig.', {
        operation: 'initialize'
      });
    }
    sqlite = await (imported.default as (options: Record<string, unknown>) => Promise<SqliteModule>)({
      locateFile: (filename: string) => new URL(filename, config.sqliteModuleUrl).href,
      print: () => undefined,
      printErr: (...args: unknown[]) => console.warn('[sqlite-wasm]', ...args)
    });
  }
  if (!sqlite.installOpfsSAHPoolVfs) {
    throw new CatalogFailure('CATALOG_UNSUPPORTED', 'Dieser Browser bietet keinen kompatiblen OPFS-SAH-Pool.', {
      operation: 'initialize'
    });
  }
  if (!pools) {
    try {
      const [a, b] = await Promise.all([
        sqlite.installOpfsSAHPoolVfs({
          name: 'kh-checker-catalog-slot-a-v1',
          directory: '.kh-checker-catalog-slot-a-v1',
          initialCapacity: 4
        }),
        sqlite.installOpfsSAHPoolVfs({
          name: 'kh-checker-catalog-slot-b-v1',
          directory: '.kh-checker-catalog-slot-b-v1',
          initialCapacity: 4
        })
      ]);
      await Promise.all([a.reserveMinimumCapacity(4), b.reserveMinimumCapacity(4)]);
      pools = { a, b };
      installer = new CatalogInstaller(pools);
    } catch (error) {
      throw new CatalogFailure('CATALOG_STORAGE_UNAVAILABLE', 'Die beiden persistenten OPFS-Katalogslots konnten nicht eingerichtet werden.', {
        operation: 'initialize', cause: error
      });
    }
  }
}

async function initialize(config: RuntimeConfig, force: boolean): Promise<CatalogStatus> {
  if (!force && status.state === 'ready' && runtimeDatabase) return status;
  if (force) {
    try { runtimeDatabase?.close(); } catch { /* close only */ }
    runtimeDatabase = null;
  }
  await ensureRuntime(config);
  if (!installer) {
    throw new CatalogFailure('CATALOG_STORAGE_UNAVAILABLE', 'Der Kataloginstaller ist nicht verfügbar.', {
      operation: 'initialize'
    });
  }
  const handle = await installer.bootstrap(config.manifestUrl, config.catalogBaseUrl, publishStatus);
  runtimeDatabase = handle.database;
  status = handle.status;
  return status;
}

function scheduleInitialization(config: RuntimeConfig, force: boolean): Promise<CatalogStatus> {
  if (!force && initialization) return initialization;
  const task = lifecycleQueue.then(
    () => initialize(config, force),
    () => initialize(config, force)
  );
  lifecycleQueue = task.then(() => undefined, () => undefined);
  initialization = task;
  void task.catch(() => {
    if (initialization === task) initialization = null;
  });
  return task;
}

function requireDatabase(operation: 'search' | 'product_lookup'): CatalogDatabase {
  if (!runtimeDatabase || status.state !== 'ready') {
    throw new CatalogFailure('CATALOG_NOT_READY', 'Der lokale Produktkatalog ist noch nicht einsatzbereit.', {
      operation,
      activeSlot: status.activeSlot,
      catalogVersion: status.catalogVersion
    });
  }
  return runtimeDatabase;
}

function searchCatalog(query: string, requestedLimit: number): readonly CatalogSearchHit[] {
  const database = requireDatabase('search');
  const canonical = query.normalize('NFKC').trim();
  const ftsQuery = buildCatalogFtsQuery(canonical);
  if (!ftsQuery) return [];
  const limit = Math.max(1, Math.min(20, Math.trunc(requestedLimit) || 20));
  try {
    const resultRows = rows<CatalogSqlRow>(
      database,
      CATALOG_SEARCH_SQL,
      [ftsQuery, canonical, canonical, canonical, limit]
    );
    return projectCatalogSearchRows(resultRows);
  } catch (error) {
    throw toCatalogFailure(error, 'CATALOG_QUERY_FAILED', 'Die lokale Produktsuche ist fehlgeschlagen.', {
      operation: 'search', activeSlot: status.activeSlot, catalogVersion: status.catalogVersion,
      details: { resultLimit: limit }
    });
  }
}

function findProduct(barcode: string): CatalogProduct | null {
  const database = requireDatabase('product_lookup');
  const normalized = barcode.replace(/\D/g, '');
  if (!normalized || normalized.length > 14) return null;
  try {
    const packed = packStandardGtin(normalized);
    const resultRows = packed === null
      ? rows<CatalogSqlRow>(database, CATALOG_RESCUE_BARCODE_SQL, [normalized])
      : rows<CatalogSqlRow>(database, PRODUCT_BY_ID_SQL, [packed]);
    return resultRows.length ? projectCatalogProductRow(resultRows[0]) : null;
  } catch (error) {
    throw toCatalogFailure(error, 'CATALOG_QUERY_FAILED', 'Die lokale Barcode-Suche ist fehlgeschlagen.', {
      operation: 'product_lookup', activeSlot: status.activeSlot, catalogVersion: status.catalogVersion
    });
  }
}

function failureResponse(id: number, error: unknown): CatalogWorkerResponse {
  const failure = isCatalogFailure(error)
    ? error
    : new CatalogFailure('CATALOG_UNKNOWN', 'Der Katalogworker ist unerwartet fehlgeschlagen.', {
        operation: 'initialize', activeSlot: status.activeSlot, catalogVersion: status.catalogVersion, cause: error
      });
  return {
    id,
    ok: false,
    error: {
      name: 'CatalogFailure',
      message: failure.message,
      code: failure.code,
      diagnostics: failure.diagnostics
    }
  };
}

workerScope.addEventListener('message', (event: MessageEvent<CatalogWorkerRequest>) => {
  const request = event.data;
  void (async () => {
    try {
      let response: CatalogWorkerResponse;
      if (request.type === 'initialize' || request.type === 'retry') {
        const config: RuntimeConfig = {
          sqliteModuleUrl: request.sqliteModuleUrl,
          manifestUrl: request.manifestUrl,
          catalogBaseUrl: request.catalogBaseUrl
        };
        const task = scheduleInitialization(config, request.type === 'retry').catch((error) => {
          if (isCatalogFailure(error)) publishStatus({
            state: 'unavailable',
            activeSlot: error.diagnostics.activeSlot,
            catalogVersion: error.diagnostics.catalogVersion,
            productCount: null,
            progress: null,
            diagnostics: error.diagnostics,
            retryAllowedImmediately: true
          });
          throw error;
        });
        response = { id: request.id, ok: true, type: 'status', result: await task };
      } else if (request.type === 'status') {
        response = { id: request.id, ok: true, type: 'status', result: status };
      } else if (request.type === 'search') {
        response = { id: request.id, ok: true, type: 'search', result: searchCatalog(request.query, request.limit) };
      } else if (request.type === 'product') {
        response = { id: request.id, ok: true, type: 'product', result: findProduct(request.barcode) };
      } else {
        throw new CatalogFailure('CATALOG_UNKNOWN', 'Unbekannter Katalogworker-Auftrag.', { operation: 'initialize' });
      }
      workerScope.postMessage(response);
    } catch (error) {
      workerScope.postMessage(failureResponse(request.id, error));
    }
  })();
});
