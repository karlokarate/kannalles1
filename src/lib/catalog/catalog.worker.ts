/// <reference lib="webworker" />

import type {
  CatalogManifest,
  CatalogProductRecord,
  CatalogRuntimeStatus,
  CatalogWorkerRequest,
  CatalogWorkerResponse
} from './catalogProtocol';

declare const self: DedicatedWorkerGlobalScope;

const DATABASE_NAME = '/kh-checker-dach.sqlite';
const META_DATABASE = 'kh-checker-catalog-meta-v1';
const META_STORE = 'state';
const META_HASH_KEY = 'installed-sha256';
const VFS_NAME = 'kh-checker-catalog-v1';
const VFS_DIRECTORY = '.kh-checker-catalog-v1';

let sqlite3: any = null;
let pool: any = null;
let db: any = null;
let initializePromise: Promise<CatalogRuntimeStatus> | null = null;
let status: CatalogRuntimeStatus = {
  state: 'idle',
  catalogVersion: null,
  productCount: null,
  persistent: false,
  installedFromNetwork: false,
  message: null
};

class CatalogError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = 'CatalogError';
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function responseError(id: number, error: unknown): CatalogWorkerResponse {
  return {
    id,
    ok: false,
    error: {
      name: error instanceof Error ? error.name : 'CatalogError',
      message: errorMessage(error),
      code: typeof error === 'object' && error !== null && 'code' in error
        ? String((error as { code?: unknown }).code ?? 'CATALOG_ERROR')
        : 'CATALOG_ERROR'
    }
  };
}

function openMetaDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(META_DATABASE, 1);
    request.onerror = () => reject(request.error ?? new Error('Katalog-Metadaten konnten nicht geöffnet werden.'));
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(META_STORE)) {
        request.result.createObjectStore(META_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
  });
}

async function readMeta(key: string): Promise<string | null> {
  const meta = await openMetaDatabase();
  try {
    return await new Promise<string | null>((resolve, reject) => {
      const transaction = meta.transaction(META_STORE, 'readonly');
      const request = transaction.objectStore(META_STORE).get(key);
      request.onerror = () => reject(request.error ?? new Error('Katalog-Metadaten konnten nicht gelesen werden.'));
      request.onsuccess = () => resolve(typeof request.result === 'string' ? request.result : null);
    });
  } finally {
    meta.close();
  }
}

async function writeMeta(key: string, value: string): Promise<void> {
  const meta = await openMetaDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = meta.transaction(META_STORE, 'readwrite');
      transaction.onerror = () => reject(transaction.error ?? new Error('Katalog-Metadaten konnten nicht gespeichert werden.'));
      transaction.oncomplete = () => resolve();
      transaction.objectStore(META_STORE).put(value, key);
    });
  } finally {
    meta.close();
  }
}

function rows<T extends Record<string, unknown>>(sql: string, bind: unknown[] = []): T[] {
  if (!db) throw new CatalogError('Die lokale Produktdatenbank ist noch nicht geöffnet.', 'CATALOG_NOT_READY');
  const result: T[] = [];
  db.exec({
    sql,
    bind,
    rowMode: 'object',
    callback: (row: T) => result.push(row)
  });
  return result;
}

function scalar(sql: string, bind: unknown[] = []): unknown {
  if (!db) throw new CatalogError('Die lokale Produktdatenbank ist noch nicht geöffnet.', 'CATALOG_NOT_READY');
  return db.selectValue(sql, bind);
}

function normalizeManifest(value: unknown): CatalogManifest {
  if (!value || typeof value !== 'object') {
    throw new CatalogError('Das Katalogmanifest ist kein gültiges Objekt.', 'CATALOG_MANIFEST_INVALID');
  }
  const manifest = value as Partial<CatalogManifest>;
  if (
    typeof manifest.catalogVersion !== 'string'
    || !['benchmark', 'production'].includes(String(manifest.artifactKind))
    || manifest.filename !== 'kh-checker-dach.sqlite'
    || typeof manifest.sizeBytes !== 'number'
    || !Number.isInteger(manifest.sizeBytes)
    || manifest.sizeBytes <= 0
    || typeof manifest.sha256 !== 'string'
    || !/^[a-f0-9]{64}$/i.test(manifest.sha256)
    || typeof manifest.applicationId !== 'number'
    || typeof manifest.userVersion !== 'number'
    || typeof manifest.productCount !== 'number'
  ) {
    throw new CatalogError('Das Katalogmanifest enthält ungültige Pflichtfelder.', 'CATALOG_MANIFEST_INVALID');
  }
  return manifest as CatalogManifest;
}

async function fetchManifest(url: string): Promise<CatalogManifest> {
  const response = await fetch(url, { cache: 'no-store', credentials: 'same-origin' });
  if (!response.ok) {
    throw new CatalogError(`Katalogmanifest nicht erreichbar (HTTP ${response.status}).`, 'CATALOG_MANIFEST_UNAVAILABLE');
  }
  return normalizeManifest(await response.json());
}

async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('');
}

async function downloadCatalog(url: string, manifest: CatalogManifest): Promise<Uint8Array> {
  const response = await fetch(url, { cache: 'no-store', credentials: 'same-origin' });
  if (!response.ok) {
    throw new CatalogError(`SQLite-Katalog nicht erreichbar (HTTP ${response.status}).`, 'CATALOG_DOWNLOAD_FAILED');
  }
  const buffer = await response.arrayBuffer();
  if (buffer.byteLength !== manifest.sizeBytes) {
    throw new CatalogError(
      `SQLite-Katalog hat ${buffer.byteLength} statt ${manifest.sizeBytes} Bytes.`,
      'CATALOG_SIZE_MISMATCH'
    );
  }
  const actualHash = await sha256Hex(buffer);
  if (actualHash.toLowerCase() !== manifest.sha256.toLowerCase()) {
    throw new CatalogError('Die SHA-256-Prüfung des SQLite-Katalogs ist fehlgeschlagen.', 'CATALOG_HASH_MISMATCH');
  }
  return new Uint8Array(buffer);
}

function validateOpenDatabase(manifest?: CatalogManifest): { productCount: number; applicationId: number; userVersion: number } {
  const applicationId = Number(scalar('PRAGMA application_id'));
  const userVersion = Number(scalar('PRAGMA user_version'));
  const quickCheck = String(scalar('PRAGMA quick_check(1)'));
  const requiredTables = Number(scalar(
    "SELECT count(*) FROM sqlite_schema WHERE type IN ('table','view') AND name IN ('p','d','x')"
  ));
  const productCount = Number(scalar('SELECT count(*) FROM p'));

  if (quickCheck !== 'ok') {
    throw new CatalogError(`SQLite quick_check meldet: ${quickCheck}`, 'CATALOG_INTEGRITY_FAILED');
  }
  if (requiredTables !== 3) {
    throw new CatalogError('Die erwarteten Tabellen p, d und x fehlen.', 'CATALOG_SCHEMA_MISMATCH');
  }
  if (!Number.isInteger(productCount) || productCount <= 0) {
    throw new CatalogError('Die Produkttabelle ist leer oder unlesbar.', 'CATALOG_SCHEMA_MISMATCH');
  }
  if (manifest) {
    if (applicationId !== manifest.applicationId || userVersion !== manifest.userVersion) {
      throw new CatalogError('application_id oder user_version passen nicht zum Manifest.', 'CATALOG_SCHEMA_MISMATCH');
    }
    if (productCount !== manifest.productCount) {
      throw new CatalogError('Die Produktanzahl passt nicht zum Manifest.', 'CATALOG_PRODUCT_COUNT_MISMATCH');
    }
  }
  return { productCount, applicationId, userVersion };
}

function openCatalog(manifest?: CatalogManifest): { productCount: number; applicationId: number; userVersion: number } {
  db?.close();
  db = new pool.OpfsSAHPoolDb(DATABASE_NAME, 'r');
  db.exec('PRAGMA query_only=ON; PRAGMA temp_store=MEMORY;');
  return validateOpenDatabase(manifest);
}

async function initialize(request: Extract<CatalogWorkerRequest, { type: 'init' }>): Promise<CatalogRuntimeStatus> {
  if (status.state === 'ready') return status;
  status = { ...status, state: 'installing', message: 'Lokale Produktdatenbank wird vorbereitet.' };

  const importedModule = await import(/* @vite-ignore */ request.sqliteModuleUrl);
  const sqlite3InitModule = importedModule.default;
  if (typeof sqlite3InitModule !== 'function') {
    throw new CatalogError('Das ausgelieferte SQLite-WASM-Modul ist ungültig.', 'SQLITE_WASM_INVALID');
  }
  sqlite3 = await sqlite3InitModule({
    locateFile: (filename: string) => new URL(filename, request.sqliteModuleUrl).href,
    print: () => undefined,
    printErr: (...args: unknown[]) => console.warn('[sqlite-wasm]', ...args)
  });
  if (typeof sqlite3.installOpfsSAHPoolVfs !== 'function') {
    throw new CatalogError('Dieser Browser bietet keinen kompatiblen OPFS-SAH-Pool.', 'OPFS_UNSUPPORTED');
  }
  pool = await sqlite3.installOpfsSAHPoolVfs({
    name: VFS_NAME,
    directory: VFS_DIRECTORY,
    initialCapacity: 4
  });
  await pool.reserveMinimumCapacity(4);

  let existingValid = false;
  if (pool.getFileNames().includes(DATABASE_NAME)) {
    try {
      openCatalog();
      existingValid = true;
    } catch (error) {
      console.warn('Vorhandener Offline-Katalog ist ungültig und wird ersetzt.', error);
      db?.close();
      db = null;
      pool.unlink(DATABASE_NAME);
    }
  }

  let manifest: CatalogManifest | null = null;
  try {
    manifest = await fetchManifest(request.manifestUrl);
  } catch (error) {
    if (!existingValid) throw error;
    console.warn('Manifest konnte offline nicht aktualisiert werden; vorhandener Katalog bleibt aktiv.', error);
  }

  const installedHash = await readMeta(META_HASH_KEY).catch(() => null);
  const needsInstall = !existingValid || Boolean(manifest && installedHash !== manifest.sha256.toLowerCase());
  let installedFromNetwork = false;

  if (needsInstall) {
    if (!manifest) {
      throw new CatalogError('Es ist weder ein gültiger lokaler Katalog noch ein Manifest verfügbar.', 'CATALOG_UNAVAILABLE');
    }
    db?.close();
    db = null;
    const bytes = await downloadCatalog(request.catalogUrl, manifest);
    pool.importDb(DATABASE_NAME, bytes);
    installedFromNetwork = true;
    await writeMeta(META_HASH_KEY, manifest.sha256.toLowerCase());
  }

  const validated = openCatalog(manifest ?? undefined);
  status = {
    state: 'ready',
    catalogVersion: manifest?.catalogVersion ?? `schema-${validated.applicationId}-${validated.userVersion}`,
    productCount: validated.productCount,
    persistent: true,
    installedFromNetwork,
    message: manifest?.artifactKind === 'benchmark'
      ? 'Benchmark-Katalog ist lokal aktiv.'
      : 'Produktkatalog ist lokal aktiv.'
  };
  return status;
}

function canonicalTokens(query: string): string[] {
  return (query.normalize('NFKC').toLocaleLowerCase('de-DE').match(/[\p{L}\p{N}]+/gu) ?? [])
    .filter((token) => token.length > 0)
    .slice(0, 12);
}

function ftsExpression(query: string): string {
  const tokens = canonicalTokens(query);
  if (!tokens.length) return '';
  return tokens.map((token) => `"${token.replaceAll('"', '""')}"*`).join(' AND ');
}

function decodeBarcode(id: number, overflowBarcode: string | null): string {
  if (overflowBarcode) return overflowBarcode;
  const tag = Math.abs(id % 4);
  const raw = String(Math.floor(id / 4));
  if (tag === 1) return raw.padStart(8, '0');
  if (tag === 2) return raw.padStart(13, '0');
  if (tag === 3) return raw.padStart(14, '0');
  return raw;
}

function encodedBarcode(barcode: string): number {
  const tag = barcode.length <= 8 ? 1n : barcode.length <= 13 ? 2n : 3n;
  return Number(BigInt(barcode) * 4n + tag);
}

function asNullableNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function mapRow(row: Record<string, unknown>): CatalogProductRecord {
  const id = Number(row.id);
  return {
    code: decodeBarcode(id, typeof row.overflowBarcode === 'string' ? row.overflowBarcode : null),
    name: String(row.name ?? '').trim(),
    brand: typeof row.brand === 'string' && row.brand.trim() ? row.brand.trim() : null,
    carbohydratesPer100g: Number(row.carbohydratesPer100g),
    servingQuantityG: asNullableNumber(row.servingQuantityG),
    productQuantityG: asNullableNumber(row.productQuantityG),
    packedMetadata: Number(row.packedMetadata ?? 0),
    rank: asNullableNumber(row.rank)
  };
}

function search(query: string, requestedLimit: number): CatalogProductRecord[] {
  const expression = ftsExpression(query);
  if (!expression) return [];
  const limit = Math.max(1, Math.min(20, Math.round(requestedLimit) || 10));
  const canonical = query.normalize('NFKC').trim();
  return rows<Record<string, unknown>>(
    `SELECT
       p.id AS id,
       p.g AS overflowBarcode,
       p.n AS name,
       d.v AS brand,
       p.c AS carbohydratesPer100g,
       p.s AS servingQuantityG,
       p.q AS productQuantityG,
       p.z AS packedMetadata,
       bm25(x) AS rank
     FROM x
     JOIN p ON p.id = x.rowid
     LEFT JOIN d ON d.id = p.b
     WHERE x MATCH ?1
     ORDER BY
       CASE
         WHEN lower(p.n) = lower(?2) THEN 0
         WHEN lower(p.n) LIKE lower(?3) THEN 1
         ELSE 2
       END ASC,
       rank ASC,
       p.n COLLATE NOCASE ASC,
       coalesce(d.v, '') COLLATE NOCASE ASC,
       p.id ASC
     LIMIT ?4`,
    [expression, canonical, `${canonical}%`, limit]
  ).map(mapRow);
}

function product(barcode: string): CatalogProductRecord | null {
  const clean = barcode.replace(/\D/g, '');
  if (!clean || clean.length > 14) return null;
  const result = rows<Record<string, unknown>>(
    `SELECT
       p.id AS id,
       p.g AS overflowBarcode,
       p.n AS name,
       d.v AS brand,
       p.c AS carbohydratesPer100g,
       p.s AS servingQuantityG,
       p.q AS productQuantityG,
       p.z AS packedMetadata,
       NULL AS rank
     FROM p
     LEFT JOIN d ON d.id = p.b
     WHERE p.id = ?1 OR p.g = ?2
     ORDER BY p.id ASC
     LIMIT 1`,
    [encodedBarcode(clean), clean]
  );
  return result.length ? mapRow(result[0]) : null;
}

self.addEventListener('message', (event: MessageEvent<CatalogWorkerRequest>) => {
  const request = event.data;
  void (async () => {
    try {
      let result: unknown;
      if (request.type === 'init') {
        initializePromise ??= initialize(request).catch((error) => {
          status = {
            ...status,
            state: 'failed',
            message: errorMessage(error)
          };
          initializePromise = null;
          throw error;
        });
        result = await initializePromise;
      } else {
        if (status.state !== 'ready' || !db) {
          throw new CatalogError('Die lokale Produktdatenbank ist noch nicht einsatzbereit.', 'CATALOG_NOT_READY');
        }
        if (request.type === 'search') result = search(request.query, request.limit);
        else if (request.type === 'product') result = product(request.barcode);
        else result = status;
      }
      self.postMessage({ id: request.id, ok: true, result } satisfies CatalogWorkerResponse);
    } catch (error) {
      self.postMessage(responseError(request.id, error));
    }
  })();
});
