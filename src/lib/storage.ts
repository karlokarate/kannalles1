import type { AppSettings, CalculationResult, PieceCalibration } from '../types';
import type { CalibrationLookupInput } from './calibration';
import {
  calibrationLookupKeys,
  normalizeStoredCalibration,
  selectCalibration
} from './calibration';

const DB_NAME = 'kh-checker-v1';
const DB_VERSION = 3;
const STORE_HISTORY = 'history';
const STORE_CALIBRATIONS = 'calibrations';
const STORE_SETTINGS = 'settings';
const STORE_API_CACHE = 'api-cache';
const CALIBRATION_INDEX_SCOPE_KEY = 'scopeKey';
const CALIBRATION_INDEX_BARCODE = 'barcode';
const CALIBRATION_INDEX_CANONICAL_PRODUCT_UNIT = 'canonicalProductUnit';
const CALIBRATION_INDEX_UPDATED_AT = 'updatedAt';
const API_CACHE_FALLBACK_KEY = 'kh-checker-v2.2-api-cache-fallback';
const CALIBRATIONS_FALLBACK_KEY = 'kh-checker-v2-calibrations-fallback';
const IDB_OPEN_TIMEOUT_MS = 1_800;
const IDB_RETRY_BACKOFF_MS = 30_000;
const FALLBACK_MAX_ENTRIES = 32;
const FALLBACK_MAX_BYTES = 1_750_000;
const MEMORY_MAX_ENTRIES = 320;

export interface ApiCacheEntry<T = unknown> {
  key: string;
  value: T;
  storedAt: number;
  expiresAt: number;
  staleUntil: number;
}

export interface ApiCacheStats {
  entries: number;
  freshEntries: number;
  staleEntries: number;
  approximateBytes: number;
  persistence: 'indexeddb' | 'localstorage' | 'memory';
}

const memoryApiCache = new Map<string, ApiCacheEntry>();
const memoryCalibrations = new Map<string, PieceCalibration>();
let lastPersistence: ApiCacheStats['persistence'] = 'memory';
let databasePromise: Promise<IDBDatabase> | null = null;
let indexedDbRetryAfter = 0;
let apiCacheGeneration = 0;

function indexedDbAvailable(): boolean {
  try {
    return typeof indexedDB !== 'undefined';
  } catch {
    return false;
  }
}

function localStorageAvailable(): boolean {
  try {
    return typeof localStorage !== 'undefined';
  } catch {
    return false;
  }
}

function rememberApiEntry(entry: ApiCacheEntry): void {
  memoryApiCache.delete(entry.key);
  memoryApiCache.set(entry.key, entry);
  if (memoryApiCache.size <= MEMORY_MAX_ENTRIES) return;

  const excess = memoryApiCache.size - MEMORY_MAX_ENTRIES;
  const oldest = [...memoryApiCache.values()]
    .sort((a, b) => a.storedAt - b.storedAt)
    .slice(0, excess);
  oldest.forEach((item) => { memoryApiCache.delete(item.key); });
}

function resetDatabaseConnection(db?: IDBDatabase): void {
  if (db) {
    try { db.close(); } catch { /* no-op */ }
  }
  databasePromise = null;
}

function openDatabase(): Promise<IDBDatabase> {
  if (!indexedDbAvailable()) {
    return Promise.reject(new Error('IndexedDB ist in dieser Laufzeit nicht verfügbar.'));
  }
  if (Date.now() < indexedDbRetryAfter) {
    return Promise.reject(new Error('IndexedDB wird nach einem vorherigen Fehler kurz nicht erneut geöffnet.'));
  }
  if (databasePromise) return databasePromise;

  databasePromise = new Promise((resolve, reject) => {
    let settled = false;
    let request: IDBOpenDBRequest;

    const finishResolve = (db: IDBDatabase) => {
      if (settled) {
        try { db.close(); } catch { /* no-op */ }
        return;
      }
      settled = true;
      globalThis.clearTimeout(timeout);
      indexedDbRetryAfter = 0;
      db.onversionchange = () => resetDatabaseConnection(db);
      resolve(db);
    };
    const finishReject = (error: unknown) => {
      if (settled) return;
      settled = true;
      globalThis.clearTimeout(timeout);
      indexedDbRetryAfter = Date.now() + IDB_RETRY_BACKOFF_MS;
      databasePromise = null;
      reject(error instanceof Error ? error : new Error('IndexedDB konnte nicht geöffnet werden.'));
    };

    const timeout = globalThis.setTimeout(
      () => finishReject(new Error('IndexedDB-Öffnung hat zu lange gedauert.')),
      IDB_OPEN_TIMEOUT_MS
    );

    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (error) {
      finishReject(error);
      return;
    }

    request.onerror = () => finishReject(request.error);
    request.onblocked = () => finishReject(new Error('IndexedDB wird von einer anderen App-Instanz blockiert.'));
    request.onsuccess = () => finishResolve(request.result);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_HISTORY)) {
        const store = db.createObjectStore(STORE_HISTORY, { keyPath: 'id' });
        store.createIndex('createdAt', 'createdAt');
        store.createIndex('favorite', 'favorite');
      }
      const calibrationStore = !db.objectStoreNames.contains(STORE_CALIBRATIONS)
        ? db.createObjectStore(STORE_CALIBRATIONS, { keyPath: 'key' })
        : request.transaction?.objectStore(STORE_CALIBRATIONS);
      if (calibrationStore) {
        if (!calibrationStore.indexNames.contains(CALIBRATION_INDEX_SCOPE_KEY)) {
          calibrationStore.createIndex(CALIBRATION_INDEX_SCOPE_KEY, 'value.scopeKey');
        }
        if (!calibrationStore.indexNames.contains(CALIBRATION_INDEX_BARCODE)) {
          calibrationStore.createIndex(CALIBRATION_INDEX_BARCODE, 'value.product.barcode');
        }
        if (!calibrationStore.indexNames.contains(CALIBRATION_INDEX_CANONICAL_PRODUCT_UNIT)) {
          calibrationStore.createIndex(
            CALIBRATION_INDEX_CANONICAL_PRODUCT_UNIT,
            ['value.product.canonicalName', 'value.product.brandCanonical', 'value.unit.kind']
          );
        }
        if (!calibrationStore.indexNames.contains(CALIBRATION_INDEX_UPDATED_AT)) {
          calibrationStore.createIndex(CALIBRATION_INDEX_UPDATED_AT, 'value.updatedAt');
        }
      }
      if (!db.objectStoreNames.contains(STORE_SETTINGS)) {
        db.createObjectStore(STORE_SETTINGS, { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains(STORE_API_CACHE)) {
        const store = db.createObjectStore(STORE_API_CACHE, { keyPath: 'key' });
        store.createIndex('staleUntil', 'staleUntil');
      }
    };
  });

  // Attach a rejection observer so a timed-out open request cannot become an
  // unhandled rejection while callers fall back to localStorage or memory.
  void databasePromise.catch(() => undefined);
  return databasePromise;
}

async function transact<T>(
  storeName: string,
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  const db = await openDatabase();
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    let result: T;
    let requestSucceeded = false;
    let tx: IDBTransaction;
    let request: IDBRequest<T>;

    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      reject(error instanceof Error ? error : new Error('IndexedDB-Transaktion fehlgeschlagen.'));
    };

    try {
      tx = db.transaction(storeName, mode);
      request = action(tx.objectStore(storeName));
    } catch (error) {
      resetDatabaseConnection(db);
      fail(error);
      return;
    }

    request.onsuccess = () => {
      result = request.result;
      requestSucceeded = true;
    };
    request.onerror = () => fail(request.error);
    tx.oncomplete = () => {
      if (settled) return;
      settled = true;
      resolve(requestSucceeded ? result : (undefined as T));
    };
    tx.onerror = () => fail(tx.error);
    tx.onabort = () => fail(tx.error ?? new Error('IndexedDB-Transaktion wurde abgebrochen.'));
  });
}

function isValidApiCacheEntry(value: unknown): value is ApiCacheEntry {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<ApiCacheEntry>;
  return typeof candidate.key === 'string'
    && candidate.key.length > 0
    && typeof candidate.storedAt === 'number'
    && Number.isFinite(candidate.storedAt)
    && candidate.storedAt >= 0
    && typeof candidate.expiresAt === 'number'
    && Number.isFinite(candidate.expiresAt)
    && candidate.expiresAt >= candidate.storedAt
    && typeof candidate.staleUntil === 'number'
    && Number.isFinite(candidate.staleUntil)
    && candidate.staleUntil >= candidate.expiresAt
    && 'value' in candidate;
}

function readFallbackEntries(): ApiCacheEntry[] {
  if (!localStorageAvailable()) return [];
  try {
    const raw = localStorage.getItem(API_CACHE_FALLBACK_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValidApiCacheEntry);
  } catch {
    return [];
  }
}

function writeFallbackEntries(entries: ApiCacheEntry[]): boolean {
  if (!localStorageAvailable()) return false;
  const now = Date.now();
  const ordered = [...entries]
    .filter((entry) => entry.staleUntil > now)
    .sort((a, b) => b.storedAt - a.storedAt)
    .slice(0, FALLBACK_MAX_ENTRIES);

  while (ordered.length) {
    try {
      const serialized = JSON.stringify(ordered);
      if (serialized.length > FALLBACK_MAX_BYTES) {
        ordered.pop();
        continue;
      }
      localStorage.setItem(API_CACHE_FALLBACK_KEY, serialized);
      return true;
    } catch {
      ordered.pop();
    }
  }

  try {
    localStorage.removeItem(API_CACHE_FALLBACK_KEY);
  } catch {
    // Nothing else to do.
  }
  return false;
}

function shouldMirrorEntry(entry: ApiCacheEntry): boolean {
  // URL-specific entries can duplicate a large search payload. The compact
  // localStorage fallback therefore keeps only the backend-independent entries
  // that are sufficient to restore searches and selected products.
  return entry.key.includes(':search-query:') || /:product:\d+$/.test(entry.key);
}

function mirrorEntryToFallback(entry: ApiCacheEntry): boolean {
  if (!shouldMirrorEntry(entry)) return false;
  const entries = readFallbackEntries().filter((item) => item.key !== entry.key);
  entries.push(entry);
  return writeFallbackEntries(entries);
}

export async function saveResult(result: CalculationResult): Promise<void> {
  await transact(STORE_HISTORY, 'readwrite', (store) => store.put(result));
}

export async function getHistory(): Promise<CalculationResult[]> {
  const results = await transact<CalculationResult[]>(STORE_HISTORY, 'readonly', (store) => store.getAll());
  return results.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function deleteResult(id: string): Promise<void> {
  await transact(STORE_HISTORY, 'readwrite', (store) => store.delete(id));
}

export async function clearHistory(): Promise<void> {
  await transact(STORE_HISTORY, 'readwrite', (store) => store.clear());
}

interface StoredCalibrationRecord {
  key: string;
  value: PieceCalibration;
}

function isStoredCalibrationRecord(value: unknown): value is StoredCalibrationRecord {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<StoredCalibrationRecord>;
  return typeof record.key === 'string'
    && Boolean(record.value)
    && record.value?.schemaVersion === 2;
}

async function putCalibrationRecord(calibration: PieceCalibration): Promise<void> {
  const stored: StoredCalibrationRecord = { key: calibration.calibrationId, value: calibration };
  await transact(STORE_CALIBRATIONS, 'readwrite', (store) => store.put(stored));
}

function readFallbackCalibrations(): PieceCalibration[] {
  const records = [...memoryCalibrations.values()];
  if (!localStorageAvailable()) return records;
  try {
    const raw = localStorage.getItem(CALIBRATIONS_FALLBACK_KEY);
    const parsed = raw ? JSON.parse(raw) as unknown : [];
    if (Array.isArray(parsed)) {
      for (const value of parsed) {
        const calibration = normalizeStoredCalibration(value);
        if (calibration) memoryCalibrations.set(calibration.calibrationId, calibration);
      }
    }
  } catch {
    // Memory remains the deterministic fallback.
  }
  return [...memoryCalibrations.values()];
}

function writeFallbackCalibrations(records: PieceCalibration[]): void {
  memoryCalibrations.clear();
  records.forEach((record) => { memoryCalibrations.set(record.calibrationId, record); });
  if (!localStorageAvailable()) return;
  try {
    localStorage.setItem(CALIBRATIONS_FALLBACK_KEY, JSON.stringify(records));
  } catch {
    // IndexedDB or memory still retains the calibration.
  }
}

export async function getCalibrations(): Promise<PieceCalibration[]> {
  const merged = new Map<string, PieceCalibration>();
  const pendingMigrations = new Map<string, PieceCalibration>();
  for (const calibration of readFallbackCalibrations()) {
    merged.set(calibration.calibrationId, calibration);
  }

  try {
    const rawRecords = await transact<unknown[]>(STORE_CALIBRATIONS, 'readonly', (store) => store.getAll());
    for (const value of rawRecords ?? []) {
      const calibration = normalizeStoredCalibration(value);
      if (!calibration) continue;
      merged.set(calibration.calibrationId, calibration);
      if (!isStoredCalibrationRecord(value)) {
        pendingMigrations.set(calibration.calibrationId, calibration);
      }
    }
  } catch {
    // The fallback records are already available.
  }

  const records = [...merged.values()];
  writeFallbackCalibrations(records);

  // Legacy records remain untouched for rollback. Their normalized v2 copy is
  // written under a separate key and read back before this migration is treated
  // as successful; a later cleanup release may remove the legacy record.
  for (const calibration of pendingMigrations.values()) {
    try {
      await putCalibrationRecord(calibration);
      const verified = await transact<unknown>(
        STORE_CALIBRATIONS,
        'readonly',
        (store) => store.get(calibration.calibrationId)
      );
      if (!normalizeStoredCalibration(verified)) {
        throw new Error('Migrierte Kalibrierung konnte nicht verifiziert werden.');
      }
    } catch {
      // The normalized memory/localStorage copy remains usable in this session.
    }
  }

  return records;
}

export async function saveCalibration(calibration: PieceCalibration): Promise<void> {
  const existing = await getCalibrations();
  const records = existing.filter((item) => item.calibrationId !== calibration.calibrationId);
  records.push(calibration);
  writeFallbackCalibrations(records);
  try {
    await putCalibrationRecord(calibration);
  } catch {
    // localStorage/memory already contains the confirmed measurement.
  }
}

export async function findCalibration(input: CalibrationLookupInput): Promise<PieceCalibration | null> {
  const keys = new Set(calibrationLookupKeys(input));
  if (!keys.size) return null;
  const records = (await getCalibrations()).filter((record) =>
    keys.has(record.scopeKey)
    && record.unit.kind === input.unit
  );
  return selectCalibration(records);
}

/** Backward-compatible exact key lookup for internal migrations and old callers. */
export async function getCalibration(key: string): Promise<PieceCalibration | null> {
  const records = await getCalibrations();
  return selectCalibration(records.filter((record) =>
    record.scopeKey === key || record.calibrationId === key
  ));
}

export async function deleteCalibration(calibrationId: string): Promise<void> {
  const records = (await getCalibrations()).filter((item) => item.calibrationId !== calibrationId);
  writeFallbackCalibrations(records);
  try {
    await transact(STORE_CALIBRATIONS, 'readwrite', (store) => store.delete(calibrationId));
  } catch {
    // Fallback storage is already updated.
  }
}

export async function clearCalibrations(): Promise<void> {
  memoryCalibrations.clear();
  if (localStorageAvailable()) {
    try { localStorage.removeItem(CALIBRATIONS_FALLBACK_KEY); } catch { /* no-op */ }
  }
  try {
    await transact(STORE_CALIBRATIONS, 'readwrite', (store) => store.clear());
  } catch {
    // Memory and localStorage were cleared even when IndexedDB is unavailable.
  }
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  await transact(STORE_SETTINGS, 'readwrite', (store) => store.put({ key: 'app', value: settings }));
}

export async function loadSettings(): Promise<AppSettings | null> {
  const result = await transact<{ key: string; value: AppSettings } | undefined>(
    STORE_SETTINGS,
    'readonly',
    (store) => store.get('app')
  );
  return result?.value ?? null;
}

export async function getApiCache<T>(key: string): Promise<ApiCacheEntry<T> | null> {
  const memory = memoryApiCache.get(key) as ApiCacheEntry<T> | undefined;
  if (memory) return memory;

  // Prefer the compact synchronous mirror before opening IndexedDB. This keeps
  // repeat searches fast in Android viewers where IndexedDB can open slowly or
  // intermittently, while canonical entries stay identical in both stores.
  const fallback = readFallbackEntries().find((entry) => entry.key === key) as ApiCacheEntry<T> | undefined;
  if (fallback) {
    rememberApiEntry(fallback as ApiCacheEntry);
    lastPersistence = 'localstorage';
    return fallback;
  }

  try {
    const entry = (await transact<ApiCacheEntry<T> | undefined>(
      STORE_API_CACHE,
      'readonly',
      (store) => store.get(key)
    )) ?? null;
    if (entry) {
      rememberApiEntry(entry as ApiCacheEntry);
      lastPersistence = 'indexeddb';
      return entry;
    }
  } catch {
    // Cache misses remain cheap during the IndexedDB retry backoff.
  }
  return null;
}

async function persistApiCacheEntry(entry: ApiCacheEntry, generation: number): Promise<void> {
  const db = await openDatabase();
  // The generation is checked after the potentially slow database open and
  // immediately before the transaction starts. A cache clear that happened in
  // between can therefore not be undone by an older background write.
  if (generation !== apiCacheGeneration) return;

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    let tx: IDBTransaction;
    let request: IDBRequest<IDBValidKey>;
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      reject(error instanceof Error ? error : new Error('API-Cache konnte nicht gespeichert werden.'));
    };

    try {
      tx = db.transaction(STORE_API_CACHE, 'readwrite');
      request = tx.objectStore(STORE_API_CACHE).put(entry);
    } catch (error) {
      resetDatabaseConnection(db);
      fail(error);
      return;
    }

    request.onerror = () => fail(request.error);
    tx.oncomplete = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    tx.onerror = () => fail(tx.error);
    tx.onabort = () => fail(tx.error ?? new Error('API-Cache-Transaktion wurde abgebrochen.'));
  });
}

export async function putApiCache<T>(entry: ApiCacheEntry<T>): Promise<void> {
  rememberApiEntry(entry as ApiCacheEntry);
  const mirrored = mirrorEntryToFallback(entry as ApiCacheEntry);
  lastPersistence = mirrored ? 'localstorage' : 'memory';

  // Memory and the compact canonical localStorage mirror are available before
  // this function returns. IndexedDB persistence continues in the background so
  // a slow Android WebView database open cannot delay a successful API result.
  const generation = apiCacheGeneration;
  void (async () => {
    if (generation !== apiCacheGeneration) return;
    try {
      await persistApiCacheEntry(entry as ApiCacheEntry, generation);
      if (generation === apiCacheGeneration) lastPersistence = 'indexeddb';
    } catch {
      // The request path must never fail solely because persistence is blocked.
    }
  })();
}

export async function clearApiCache(): Promise<void> {
  apiCacheGeneration += 1;
  memoryApiCache.clear();
  try {
    await transact(STORE_API_CACHE, 'readwrite', (store) => store.clear());
  } catch {
    // IndexedDB may be unavailable or blocked.
  }
  if (localStorageAvailable()) {
    try { localStorage.removeItem(API_CACHE_FALLBACK_KEY); } catch { /* no-op */ }
  }
  lastPersistence = 'memory';
}

async function deleteApiCacheKeys(keys: string[]): Promise<void> {
  if (!keys.length) return;
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    let tx: IDBTransaction;
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      reject(error instanceof Error ? error : new Error('Cache-Bereinigung fehlgeschlagen.'));
    };
    try {
      tx = db.transaction(STORE_API_CACHE, 'readwrite');
      const store = tx.objectStore(STORE_API_CACHE);
      keys.forEach((key) => { store.delete(key); });
    } catch (error) {
      resetDatabaseConnection(db);
      fail(error);
      return;
    }
    tx.oncomplete = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    tx.onerror = () => fail(tx.error);
    tx.onabort = () => fail(tx.error ?? new Error('Cache-Bereinigung wurde abgebrochen.'));
  });
}

export async function pruneApiCache(now = Date.now()): Promise<void> {
  for (const [key, entry] of memoryApiCache) {
    if (entry.staleUntil <= now) memoryApiCache.delete(key);
  }

  const fallbackEntries = readFallbackEntries().filter((entry) => entry.staleUntil > now);
  if (fallbackEntries.length) writeFallbackEntries(fallbackEntries);
  else if (localStorageAvailable()) {
    try { localStorage.removeItem(API_CACHE_FALLBACK_KEY); } catch { /* no-op */ }
  }

  try {
    const entries = await transact<ApiCacheEntry[]>(STORE_API_CACHE, 'readonly', (store) => store.getAll());
    await deleteApiCacheKeys(entries.filter((entry) => entry.staleUntil <= now).map((entry) => entry.key));
  } catch {
    // Best-effort maintenance only.
  }
}

export async function getApiCacheStats(now = Date.now()): Promise<ApiCacheStats> {
  const combined = new Map<string, ApiCacheEntry>();
  for (const entry of memoryApiCache.values()) combined.set(entry.key, entry);
  for (const entry of readFallbackEntries()) {
    const previous = combined.get(entry.key);
    if (!previous || previous.storedAt < entry.storedAt) combined.set(entry.key, entry);
  }

  try {
    const stored = await transact<ApiCacheEntry[]>(STORE_API_CACHE, 'readonly', (store) => store.getAll());
    for (const entry of stored) {
      const previous = combined.get(entry.key);
      if (!previous || previous.storedAt < entry.storedAt) combined.set(entry.key, entry);
    }
    lastPersistence = 'indexeddb';
  } catch {
    if (combined.size && localStorageAvailable()) lastPersistence = 'localstorage';
  }

  const entries = [...combined.values()].filter((entry) => entry.staleUntil > now);
  let approximateBytes = 0;
  try { approximateBytes = JSON.stringify(entries).length; } catch { approximateBytes = 0; }
  return {
    entries: entries.length,
    freshEntries: entries.filter((entry) => entry.expiresAt > now).length,
    staleEntries: entries.filter((entry) => entry.expiresAt <= now && entry.staleUntil > now).length,
    approximateBytes,
    persistence: lastPersistence
  };
}
