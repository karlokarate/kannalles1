/// <reference lib="webworker" />

import {
  CATALOG_APPLICATION_ID,
  CATALOG_RESCUE_BARCODE_SQL,
  CATALOG_SEARCH_SQL,
  CATALOG_UNIT_KINDS,
  CATALOG_USER_VERSION,
  buildCatalogFtsQuery,
  buildCatalogImageUrl,
  decodeCatalogCode,
  decodeCatalogMetadata,
  packStandardGtin
} from '../../../Catalog/catalog-runtime.generated';
import type {
  CatalogBasis,
  CatalogManifest,
  CatalogProductRecord,
  CatalogRuntimeStatus,
  CatalogUnitKind,
  CatalogUnitSource,
  CatalogWorkerRequest,
  CatalogWorkerResponse
} from './catalogProtocol';

declare const self: DedicatedWorkerGlobalScope;

const DATABASE_NAME = '/kh-checker-dach-v1.sqlite';
const META_DATABASE = 'kh-checker-catalog-meta-v1';
const META_STORE = 'state';
const META_HASH_KEY = 'installed-sha256';
const META_VERSION_KEY = 'installed-catalog-version';
const VFS_NAME = 'kh-checker-catalog-v1';
const VFS_DIRECTORY = '.kh-checker-catalog-v1';
const PRODUCT_BY_ID_SQL = `
SELECT p.id,p.g,p.n,d.v AS brand,p.c,p.s,p.q,p.u,p.m,p.r
FROM p LEFT JOIN d ON d.id=p.b
WHERE p.id=? LIMIT 1`;

const UNIT_KIND_BY_CODE = new Map<number, CatalogUnitKind>(
  Object.entries(CATALOG_UNIT_KINDS).map(([name, code]) => [Number(code), name as CatalogUnitKind])
);
const UNIT_SOURCE_BY_CODE = new Map<number, CatalogUnitSource>([
  [0, 'none'],
  [1, 'manufacturerServing'],
  [2, 'explicitServingCount'],
  [3, 'explicitMultipackQuantity']
]);

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
      if (!request.result.objectStoreNames.contains(META_STORE)) request.result.createObjectStore(META_STORE);
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

async function writeMeta(entries: ReadonlyArray<readonly [string, string]>): Promise<void> {
  const meta = await openMetaDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = meta.transaction(META_STORE, 'readwrite');
      transaction.onerror = () => reject(transaction.error ?? new Error('Katalog-Metadaten konnten nicht gespeichert werden.'));
      transaction.oncomplete = () => resolve();
      const store = transaction.objectStore(META_STORE);
      for (const [key, value] of entries) store.put(value, key);
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeManifest(value: unknown): CatalogManifest {
  if (!isRecord(value) || !isRecord(value.database) || !isRecord(value.image)) {
    throw new CatalogError('Das Produktions-Katalogmanifest ist kein gültiges Objekt.', 'CATALOG_MANIFEST_INVALID');
  }
  const database = value.database;
  const image = value.image;
  const manifest: CatalogManifest = {
    contract: value.contract as CatalogManifest['contract'],
    contractVersion: String(value.contractVersion ?? ''),
    catalogVersion: String(value.catalogVersion ?? ''),
    generatedAtUtc: String(value.generatedAtUtc ?? ''),
    filename: String(database.file ?? ''),
    sizeBytes: Number(database.bytes),
    sha256: String(database.sha256 ?? ''),
    applicationId: Number(database.applicationId),
    userVersion: Number(database.userVersion),
    pageSize: Number(database.pageSize),
    productCount: Number(database.products),
    brandCount: Number(database.brands),
    codecFile: String(value.codecFile ?? ''),
    imageDictionaryFile: String(image.dictionaryFile ?? ''),
    imageDictionarySha256: String(image.dictionarySha256 ?? '')
  };
  if (
    manifest.contract !== 'kh-checker-offline-catalog-production'
    || manifest.contractVersion !== '1.0.0'
    || !manifest.catalogVersion
    || Number.isNaN(Date.parse(manifest.generatedAtUtc))
    || manifest.filename !== 'kh-checker-dach-v1.sqlite'
    || !Number.isSafeInteger(manifest.sizeBytes)
    || manifest.sizeBytes <= 0
    || !/^[a-f0-9]{64}$/i.test(manifest.sha256)
    || manifest.applicationId !== CATALOG_APPLICATION_ID
    || manifest.userVersion !== CATALOG_USER_VERSION
    || manifest.pageSize !== 4096
    || !Number.isSafeInteger(manifest.productCount)
    || manifest.productCount <= 0
    || !Number.isSafeInteger(manifest.brandCount)
    || manifest.brandCount <= 0
    || manifest.codecFile !== 'catalog-codecs.v1.json'
    || manifest.imageDictionaryFile !== 'catalog-image-keys.v2.json'
    || !/^[a-f0-9]{64}$/i.test(manifest.imageDictionarySha256)
  ) {
    throw new CatalogError('Das Produktions-Katalogmanifest enthält ungültige Pflichtfelder.', 'CATALOG_MANIFEST_INVALID');
  }
  return manifest;
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

function validateOpenDatabase(manifest?: CatalogManifest): {
  productCount: number;
  applicationId: number;
  userVersion: number;
} {
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
  if (applicationId !== CATALOG_APPLICATION_ID || userVersion !== CATALOG_USER_VERSION) {
    throw new CatalogError('application_id oder user_version passen nicht zur Runtime-SSOT.', 'CATALOG_SCHEMA_MISMATCH');
  }
  if (!Number.isInteger(productCount) || productCount <= 0) {
    throw new CatalogError('Die Produkttabelle ist leer oder unlesbar.', 'CATALOG_SCHEMA_MISMATCH');
  }
  if (manifest && productCount !== manifest.productCount) {
    throw new CatalogError('Die Produktanzahl passt nicht zum Manifest.', 'CATALOG_PRODUCT_COUNT_MISMATCH');
  }
  return { productCount, applicationId, userVersion };
}

function openCatalog(manifest?: CatalogManifest): {
  productCount: number;
  applicationId: number;
  userVersion: number;
} {
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
    await writeMeta([
      [META_HASH_KEY, manifest.sha256.toLowerCase()],
      [META_VERSION_KEY, manifest.catalogVersion]
    ]);
  }

  const validated = openCatalog(manifest ?? undefined);
  const storedVersion = manifest?.catalogVersion ?? await readMeta(META_VERSION_KEY).catch(() => null);
  status = {
    state: 'ready',
    catalogVersion: storedVersion ?? `schema-${validated.applicationId}-${validated.userVersion}`,
    productCount: validated.productCount,
    persistent: true,
    installedFromNetwork,
    message: 'Produktkatalog ist lokal aktiv.'
  };
  return status;
}

function asNullableNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function basis(volume: boolean): CatalogBasis {
  return volume ? 'volume' : 'mass';
}

function unitKind(code: number): CatalogUnitKind {
  return UNIT_KIND_BY_CODE.get(code) ?? 'none';
}

function unitSource(code: number): CatalogUnitSource {
  return UNIT_SOURCE_BY_CODE.get(code) ?? 'none';
}

function mapRow(row: Record<string, unknown>): CatalogProductRecord {
  const id = Number(row.id);
  const rescueCode = typeof row.g === 'string' ? row.g : null;
  const code = decodeCatalogCode(id, rescueCode);
  const metadataValue = Number(row.m);
  const metadata = decodeCatalogMetadata(metadataValue);
  const servingValue = metadata.hasServing ? asNullableNumber(row.s) : null;
  const productQuantityValue = metadata.hasProductQuantity ? asNullableNumber(row.q) : null;
  const provenUnitKind = unitKind(metadata.provenUnitKind);
  const provenUnitValue = provenUnitKind === 'none' ? null : asNullableNumber(row.u);

  return {
    code,
    name: String(row.n ?? '').trim(),
    brand: typeof row.brand === 'string' && row.brand.trim() ? row.brand.trim() : null,
    carbohydratesPer100: Number(row.c),
    carbohydrateBasis: basis(metadata.carbohydrateBasisVolume),
    carbohydrateSourcePrepared: metadata.carbohydrateSourcePrepared,
    servingValue,
    servingBasis: servingValue === null ? null : basis(metadata.servingBasisVolume),
    productQuantityValue,
    productQuantityBasis: productQuantityValue === null ? null : basis(metadata.productQuantityBasisVolume),
    provenUnitValue,
    provenUnitKind,
    provenUnitSource: unitSource(metadata.provenUnitSource),
    provenUnitBasis: provenUnitValue === null ? null : basis(metadata.provenUnitBasisVolume),
    defaultUnitKind: unitKind(metadata.defaultUnitKind),
    imageUrl: buildCatalogImageUrl(code, metadataValue),
    hasQualityErrors: metadata.hasQualityErrors,
    rankOrdinal: Number(row.r)
  };
}

function search(query: string, requestedLimit: number): CatalogProductRecord[] {
  const ftsQuery = buildCatalogFtsQuery(query);
  if (!ftsQuery) return [];
  const limit = Math.max(1, Math.min(20, Math.round(requestedLimit) || 20));
  const canonical = query.normalize('NFKC').trim();
  return rows<Record<string, unknown>>(
    CATALOG_SEARCH_SQL,
    [ftsQuery, canonical, canonical, canonical, limit]
  ).map(mapRow);
}

function product(barcode: string): CatalogProductRecord | null {
  const clean = barcode.replace(/\D/g, '');
  if (!clean || clean.length > 14) return null;
  const packed = packStandardGtin(clean);
  const result = packed === null
    ? rows<Record<string, unknown>>(CATALOG_RESCUE_BARCODE_SQL, [clean])
    : rows<Record<string, unknown>>(PRODUCT_BY_ID_SQL, [packed]);
  return result.length ? mapRow(result[0]) : null;
}

self.addEventListener('message', (event: MessageEvent<CatalogWorkerRequest>) => {
  const request = event.data;
  void (async () => {
    try {
      let result: unknown;
      if (request.type === 'init') {
        initializePromise ??= initialize(request).catch((error) => {
          status = { ...status, state: 'failed', message: errorMessage(error) };
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
