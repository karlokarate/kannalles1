import type { AppSettings, CalculationResult, PieceCalibration } from '../types';
import { ProductGatewayResponseSchema, SearchGatewayResponseSchema } from '../generated/search-api';
import type { CalibrationLookupInput } from './calibration';
import {
  calibrationLookupKeys,
  normalizeStoredCalibration,
  selectCalibration
} from './calibration';
import { parseStoredCalculationResult } from './resultValidation';

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
const SETTINGS_FALLBACK_KEY = 'kh-checker-settings-v3';
const HISTORY_FALLBACK_KEY = 'kh-checker-history-v3';
const HISTORY_DELETION_LEDGER_KEY = 'kh-checker-history-deletions-v3';
const CALIBRATION_DELETION_LEDGER_KEY = 'kh-checker-calibration-deletions-v3';
const API_CACHE_DELETION_LEDGER_KEY = 'kh-checker-api-cache-deletions-v3';
const REPOSITORY_SCHEMA_VERSION = 3;
const IDB_OPEN_TIMEOUT_MS = 1_800;
const IDB_TRANSACTION_TIMEOUT_MS = 1_200;
const IDB_RETRY_BACKOFF_MS = 30_000;
const FALLBACK_MAX_ENTRIES = 32;
const FALLBACK_MAX_BYTES = 1_750_000;
const MEMORY_MAX_ENTRIES = 320;
const IDB_API_CACHE_MAX_ENTRIES = 320;
const IDB_API_CACHE_MAX_BYTES = 12 * 1024 * 1024;
const IDB_HISTORY_MAX_ENTRIES = 500;
const IDB_HISTORY_FAVORITE_RESERVE = 250;
const IDB_CALIBRATION_MAX_ENTRIES = 500;

export type ApiCacheReadLayer = 'browser-memory' | 'browser-indexeddb' | 'browser-localstorage';

export interface ApiCacheEntry<T = unknown> {
  key: string;
  value: T;
  storedAt: number;
  expiresAt: number;
  staleUntil: number;
  /** Local repository write time, independent of the upstream fetch time. */
  repositoryStoredAt?: number;
  /** Set only on returned copies; never persisted as cache provenance. */
  readLayer?: ApiCacheReadLayer;
}

export interface ApiCacheStats {
  entries: number;
  freshEntries: number;
  staleEntries: number;
  approximateBytes: number;
  persistence: 'indexeddb' | 'localstorage' | 'memory';
  persistenceIssue: 'none' | 'quota-exceeded' | 'unavailable';
}

const memoryApiCache = new Map<string, ApiCacheEntry>();
const memoryCalibrations = new Map<string, PieceCalibration>();
const memoryCalibrationStoredAt = new Map<string, number>();
const memoryHistory = new Map<string, CalculationResult>();
const memoryHistoryStoredAt = new Map<string, number>();
let memorySettings: AppSettings | null = null;
let memorySettingsStoredAt = 0;
let lastPersistence: ApiCacheStats['persistence'] = 'memory';
let lastPersistenceIssue: ApiCacheStats['persistenceIssue'] = 'none';
let databasePromise: Promise<IDBDatabase> | null = null;
let indexedDbRetryAfter = 0;
let apiCacheGeneration = 0;
let historyGeneration = 0;
let calibrationGeneration = 0;
let historyWriteQueue: Promise<void> = Promise.resolve();
let calibrationWriteQueue: Promise<void> = Promise.resolve();
let apiCacheWriteQueue: Promise<void> = Promise.resolve();

/** Apply another tab's persisted ledger mutation without writing a new event. */
export function synchronizeExternalRepositoryMutation(
  repository: 'history' | 'calibrations' | 'api-cache'
): void {
  if (repository === 'history') historyGeneration += 1;
  else if (repository === 'calibrations') calibrationGeneration += 1;
  else apiCacheGeneration += 1;
}

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
  const { readLayer: _readLayer, ...persistentEntry } = entry;
  memoryApiCache.delete(entry.key);
  memoryApiCache.set(entry.key, persistentEntry);
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
    let timeout: ReturnType<typeof globalThis.setTimeout> | null = null;

    const clearTransactionTimeout = () => {
      if (timeout !== null) globalThis.clearTimeout(timeout);
      timeout = null;
    };

    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      clearTransactionTimeout();
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

    timeout = globalThis.setTimeout(() => {
      try { tx.abort(); } catch { /* no-op */ }
      resetDatabaseConnection(db);
      fail(new Error(`IndexedDB-Transaktion hat nach ${IDB_TRANSACTION_TIMEOUT_MS} ms nicht geantwortet.`));
    }, IDB_TRANSACTION_TIMEOUT_MS);

    request.onsuccess = () => {
      result = request.result;
      requestSucceeded = true;
    };
    request.onerror = () => fail(request.error);
    tx.oncomplete = () => {
      if (settled) return;
      settled = true;
      clearTransactionTimeout();
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
    && (candidate.repositoryStoredAt === undefined
      || (typeof candidate.repositoryStoredAt === 'number'
        && Number.isFinite(candidate.repositoryStoredAt)
        && candidate.repositoryStoredAt >= 0))
    && 'value' in candidate
    && isValidCachedPayload(candidate.key, candidate.value);
}

function isValidCachedPayload(key: string | undefined, value: unknown): boolean {
  if (!key?.startsWith('kh-v3:gateway:')) return true;
  if (!value || typeof value !== 'object') return false;
  const response = (value as { response?: unknown }).response;
  if (!response || typeof response !== 'object') return false;
  const normalized = response as {
    gateway_attempts?: unknown;
    api_meta?: { attempts?: unknown };
  };
  // Browser cache entries intentionally store the transport-normalized domain
  // DTO. Reconstruct the required wire-only diagnostics field for strict
  // contract validation instead of silently rejecting every valid cache write.
  const wireCandidate = {
    ...normalized,
    gateway_attempts: Array.isArray(normalized.gateway_attempts)
      ? normalized.gateway_attempts
      : Array.isArray(normalized.api_meta?.attempts)
        ? normalized.api_meta.attempts
        : []
  };
  if (key.includes(':search:v1:')) return SearchGatewayResponseSchema.safeParse(wireCandidate).success;
  if (key.includes(':product:v2:')) return ProductGatewayResponseSchema.safeParse(wireCandidate).success;
  return false;
}

function isSettingsRecord(value: unknown): value is AppSettings {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<AppSettings>;
  return typeof candidate.aiEnabled === 'boolean'
    && [0, 1, 2].includes(Number(candidate.decimalPlaces))
    && [10, 15, 20].includes(Number(candidate.searchPageSize))
    && typeof candidate.preferGermanMarket === 'boolean'
    && typeof candidate.saveHistory === 'boolean'
    && typeof candidate.saveSearchSession === 'boolean'
    && typeof candidate.saveCalibrations === 'boolean'
    && typeof candidate.cacheApiData === 'boolean'
    && typeof candidate.dataGatewayUrl === 'string'
    && ['hybrid', 'v2', 'v3'].includes(String(candidate.productApiMode))
    && (candidate.offAccount === null || isOffAccountCredentials(candidate.offAccount));
}

function isOffAccountCredentials(value: unknown): value is NonNullable<AppSettings['offAccount']> {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<NonNullable<AppSettings['offAccount']>>;
  return typeof candidate.userId === 'string'
    && candidate.userId.trim().length > 0
    && !candidate.userId.includes('@')
    && typeof candidate.password === 'string'
    && candidate.password.length > 0
    && typeof candidate.verifiedAt === 'string'
    && Number.isFinite(Date.parse(candidate.verifiedAt));
}

function migrateSettingsRecord(value: unknown): AppSettings | null {
  if (isSettingsRecord(value)) return {
    aiEnabled: value.aiEnabled,
    decimalPlaces: value.decimalPlaces,
    searchPageSize: value.searchPageSize,
    preferGermanMarket: value.preferGermanMarket,
    saveHistory: value.saveHistory,
    saveSearchSession: value.saveSearchSession,
    saveCalibrations: value.saveCalibrations,
    cacheApiData: value.cacheApiData,
    dataGatewayUrl: value.dataGatewayUrl,
    productApiMode: value.productApiMode,
    offAccount: value.offAccount
  };
  if (!value || typeof value !== 'object') return null;
  const legacy = value as Partial<AppSettings>;
  if (typeof legacy.aiEnabled !== 'boolean'
    || ![0, 1, 2].includes(Number(legacy.decimalPlaces))
    || ![10, 15, 20].includes(Number(legacy.searchPageSize))
    || typeof legacy.preferGermanMarket !== 'boolean'
    || typeof legacy.saveHistory !== 'boolean'
    || typeof legacy.dataGatewayUrl !== 'string'
    || !['hybrid', 'v2', 'v3'].includes(String(legacy.productApiMode))) return null;
  const hasIndependentRepositoryConsent = typeof legacy.saveSearchSession === 'boolean'
    && typeof legacy.saveCalibrations === 'boolean'
    && typeof legacy.cacheApiData === 'boolean';
  return {
    aiEnabled: legacy.aiEnabled,
    decimalPlaces: legacy.decimalPlaces as AppSettings['decimalPlaces'],
    searchPageSize: legacy.searchPageSize as AppSettings['searchPageSize'],
    preferGermanMarket: legacy.preferGermanMarket,
    // Only releases predating the independent repository controls need the
    // conservative opt-out migration. A current record merely missing the new
    // OFF account field retains the user's existing choices.
    saveHistory: hasIndependentRepositoryConsent ? legacy.saveHistory : false,
    saveSearchSession: hasIndependentRepositoryConsent ? Boolean(legacy.saveSearchSession) : false,
    saveCalibrations: hasIndependentRepositoryConsent ? Boolean(legacy.saveCalibrations) : false,
    cacheApiData: hasIndependentRepositoryConsent ? Boolean(legacy.cacheApiData) : false,
    dataGatewayUrl: legacy.dataGatewayUrl,
    productApiMode: legacy.productApiMode as AppSettings['productApiMode'],
    offAccount: isOffAccountCredentials(legacy.offAccount) ? legacy.offAccount : null
  };
}

interface VersionedRepositoryValue<T> {
  schemaVersion: typeof REPOSITORY_SCHEMA_VERSION;
  value: T;
}

interface StoredSettingsValue {
  settings: AppSettings;
  repositoryStoredAt: number;
}

function readVersionedLocal<T>(key: string, validate: (value: unknown) => value is T): T | null {
  if (!localStorageAvailable()) return null;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<VersionedRepositoryValue<unknown>>;
    if (parsed.schemaVersion !== REPOSITORY_SCHEMA_VERSION || !validate(parsed.value)) return null;
    return parsed.value;
  } catch {
    return null;
  }
}

function writeVersionedLocal<T>(key: string, value: T): boolean {
  if (!localStorageAvailable()) return false;
  try {
    const record: VersionedRepositoryValue<T> = { schemaVersion: REPOSITORY_SCHEMA_VERSION, value };
    localStorage.setItem(key, JSON.stringify(record));
    return true;
  } catch {
    return false;
  }
}

function parseStoredSettingsValue(value: unknown): StoredSettingsValue | null {
  if (value && typeof value === 'object' && 'settings' in value) {
    const candidate = value as { settings?: unknown; repositoryStoredAt?: unknown };
    const settings = migrateSettingsRecord(candidate.settings);
    if (!settings) return null;
    const repositoryStoredAt = typeof candidate.repositoryStoredAt === 'number'
      && Number.isFinite(candidate.repositoryStoredAt)
      && candidate.repositoryStoredAt >= 0
      ? candidate.repositoryStoredAt
      : 0;
    return { settings, repositoryStoredAt };
  }
  const legacy = migrateSettingsRecord(value);
  const repositoryStoredAt = value && typeof value === 'object'
    && typeof (value as { repositoryStoredAt?: unknown }).repositoryStoredAt === 'number'
    && Number.isFinite((value as { repositoryStoredAt: number }).repositoryStoredAt)
    ? Math.max(0, (value as { repositoryStoredAt: number }).repositoryStoredAt)
    : 0;
  return legacy ? { settings: legacy, repositoryStoredAt } : null;
}

function readSettingsFallback(): StoredSettingsValue | null {
  if (!localStorageAvailable()) return null;
  try {
    const raw = localStorage.getItem(SETTINGS_FALLBACK_KEY);
    const parsed = raw ? JSON.parse(raw) as Partial<VersionedRepositoryValue<unknown>> : null;
    if (parsed?.schemaVersion !== REPOSITORY_SCHEMA_VERSION) return null;
    return parseStoredSettingsValue(parsed.value);
  } catch {
    return null;
  }
}

function writeSettingsFallback(value: StoredSettingsValue): void {
  // Keep the settings fields at the legacy location so a rollback can still
  // read preferences; only the additive timestamp is new.
  writeVersionedLocal(SETTINGS_FALLBACK_KEY, {
    ...value.settings,
    repositoryStoredAt: value.repositoryStoredAt
  });
}

async function deleteStoreKeys(storeName: string, keys: string[]): Promise<void> {
  if (!keys.length) return;
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    let tx: IDBTransaction;
    let timeout: ReturnType<typeof globalThis.setTimeout> | null = null;
    const clearTransactionTimeout = () => {
      if (timeout !== null) globalThis.clearTimeout(timeout);
      timeout = null;
    };
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      clearTransactionTimeout();
      reject(error instanceof Error ? error : new Error('Repository-Bereinigung fehlgeschlagen.'));
    };
    try {
      tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      keys.forEach((key) => { store.delete(key); });
    } catch (error) {
      resetDatabaseConnection(db);
      fail(error);
      return;
    }
    timeout = globalThis.setTimeout(() => {
      try { tx.abort(); } catch { /* no-op */ }
      resetDatabaseConnection(db);
      fail(new Error(`Repository-Bereinigung hat nach ${IDB_TRANSACTION_TIMEOUT_MS} ms nicht geantwortet.`));
    }, IDB_TRANSACTION_TIMEOUT_MS);
    tx.oncomplete = () => {
      if (settled) return;
      settled = true;
      clearTransactionTimeout();
      resolve();
    };
    tx.onerror = () => fail(tx.error);
    tx.onabort = () => fail(tx.error ?? new Error('Repository-Bereinigung wurde abgebrochen.'));
  });
}

function persistenceIssueFor(error: unknown): ApiCacheStats['persistenceIssue'] {
  const name = error && typeof error === 'object' && 'name' in error
    ? String((error as { name?: unknown }).name)
    : '';
  return /quota/i.test(name) ? 'quota-exceeded' : 'unavailable';
}

interface RepositoryDeletionLedger {
  clearEpoch: number;
  deletedIds: Record<string, number>;
}

const EMPTY_DELETION_LEDGER: RepositoryDeletionLedger = { clearEpoch: 0, deletedIds: {} };

function isDeletionLedger(value: unknown): value is RepositoryDeletionLedger {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<RepositoryDeletionLedger>;
  return typeof candidate.clearEpoch === 'number'
    && Number.isFinite(candidate.clearEpoch)
    && candidate.clearEpoch >= 0
    && Boolean(candidate.deletedIds && typeof candidate.deletedIds === 'object')
    && Object.entries(candidate.deletedIds ?? {}).every(([id, timestamp]) =>
      id.length > 0 && typeof timestamp === 'number' && Number.isFinite(timestamp) && timestamp >= 0
    );
}

function readDeletionLedger(key: string): RepositoryDeletionLedger {
  return readVersionedLocal(key, isDeletionLedger) ?? EMPTY_DELETION_LEDGER;
}

function writeDeletionLedger(key: string, ledger: RepositoryDeletionLedger): RepositoryDeletionLedger {
  const deletedIds = Object.fromEntries(
    Object.entries(ledger.deletedIds)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 256)
  );
  const normalized = { clearEpoch: ledger.clearEpoch, deletedIds };
  writeVersionedLocal(key, normalized);
  return normalized;
}

function nextRepositoryTimestamp(after = 0): number {
  return Math.max(Date.now(), Math.floor(after) + 1);
}

function markRepositoryClear(key: string): RepositoryDeletionLedger {
  const current = readDeletionLedger(key);
  return writeDeletionLedger(key, {
    clearEpoch: nextRepositoryTimestamp(current.clearEpoch),
    deletedIds: {}
  });
}

function markRepositoryDelete(key: string, id: string): RepositoryDeletionLedger {
  const current = readDeletionLedger(key);
  return writeDeletionLedger(key, {
    ...current,
    deletedIds: {
      ...current.deletedIds,
      [id]: nextRepositoryTimestamp(Math.max(current.clearEpoch, current.deletedIds[id] ?? 0))
    }
  });
}

function markRepositoryDeletes(key: string, ids: Iterable<string>): RepositoryDeletionLedger {
  const current = readDeletionLedger(key);
  const deletedIds = { ...current.deletedIds };
  let timestamp = Math.max(
    current.clearEpoch,
    ...Object.values(deletedIds),
    0
  );
  for (const id of ids) {
    if (!id) continue;
    timestamp = nextRepositoryTimestamp(timestamp);
    deletedIds[id] = timestamp;
  }
  return writeDeletionLedger(key, { ...current, deletedIds });
}

function repositoryStoredAt(value: unknown): number | null {
  if (!value || typeof value !== 'object') return null;
  const timestamp = (value as { repositoryStoredAt?: unknown }).repositoryStoredAt;
  return typeof timestamp === 'number' && Number.isFinite(timestamp) && timestamp >= 0 ? timestamp : null;
}

function repositoryRecordVisible(value: unknown, id: string, ledger: RepositoryDeletionLedger): boolean {
  const requiredAfter = Math.max(ledger.clearEpoch, ledger.deletedIds[id] ?? 0);
  if (requiredAfter === 0) return true;
  const storedAt = repositoryStoredAt(value);
  return storedAt !== null && storedAt > requiredAfter;
}

function repositoryTimestampForWrite(
  ledger: RepositoryDeletionLedger,
  id: string,
  previous = 0
): number {
  return nextRepositoryTimestamp(Math.max(ledger.clearEpoch, ledger.deletedIds[id] ?? 0, previous));
}

function historyFallbackRecords(): Array<CalculationResult & { repositoryStoredAt: number }> {
  return [...memoryHistory.values()]
    .map((result) => ({
      ...result,
      repositoryStoredAt: memoryHistoryStoredAt.get(result.id) ?? 0
    }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 100);
}

function retainedHistory(records: CalculationResult[]): CalculationResult[] {
  const ordered = [...records].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const favorites = ordered.filter((record) => record.favorite).slice(0, IDB_HISTORY_FAVORITE_RESERVE);
  const keep = new Set(favorites.map((record) => record.id));
  const regular = ordered.filter((record) => !keep.has(record.id))
    .slice(0, IDB_HISTORY_MAX_ENTRIES - favorites.length);
  return [...favorites, ...regular].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function applyHistoryRetentionToMemory(): string[] {
  const retained = retainedHistory([...memoryHistory.values()]);
  const keep = new Set(retained.map((record) => record.id));
  const removed = [...memoryHistory.keys()].filter((id) => !keep.has(id));
  for (const id of removed) {
    memoryHistory.delete(id);
    memoryHistoryStoredAt.delete(id);
  }
  return removed;
}

async function enforceHistoryRetention(rawRecords?: unknown[]): Promise<void> {
  const records = rawRecords ?? await transact<unknown[]>(STORE_HISTORY, 'readonly', (store) => store.getAll());
  const parsed = records.map((value) => ({
    id: value && typeof value === 'object' && typeof (value as { id?: unknown }).id === 'string'
      ? (value as { id: string }).id
      : null,
    result: parseStoredCalculationResult(value)
  }));
  const retained = retainedHistory(parsed.flatMap((item) => item.result ? [item.result] : []));
  const keep = new Set(retained.map((record) => record.id));
  const removed = parsed.flatMap((item) => item.id && !keep.has(item.id) ? [item.id] : []);
  await deleteStoreKeys(STORE_HISTORY, removed);
}

function writeHistoryFallback(): void {
  writeVersionedLocal(HISTORY_FALLBACK_KEY, historyFallbackRecords());
}

function rememberHistoryRecord(value: unknown, ledger: RepositoryDeletionLedger): void {
  const result = parseStoredCalculationResult(value);
  if (!result || !repositoryRecordVisible(value, result.id, ledger)) return;
  const storedAt = repositoryStoredAt(value) ?? 0;
  const previous = memoryHistoryStoredAt.get(result.id) ?? -1;
  if (previous > storedAt) return;
  memoryHistory.set(result.id, result);
  memoryHistoryStoredAt.set(result.id, storedAt);
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
  return entry.key.includes(':search:v1:')
    || entry.key.includes(':product:v2:')
    || entry.key.includes(':search-query:')
    || /:product:\d+$/.test(entry.key);
}

function mirrorEntryToFallback(entry: ApiCacheEntry): boolean {
  if (!shouldMirrorEntry(entry)) return false;
  const entries = readFallbackEntries().filter((item) => item.key !== entry.key);
  entries.push(entry);
  return writeFallbackEntries(entries);
}

export async function saveResult(result: CalculationResult): Promise<void> {
  const normalized = parseStoredCalculationResult(result);
  if (!normalized) throw new Error('Ungültiges Ergebnis kann nicht gespeichert werden.');
  const generation = historyGeneration;
  const ledger = readDeletionLedger(HISTORY_DELETION_LEDGER_KEY);
  const storedAt = repositoryTimestampForWrite(
    ledger,
    normalized.id,
    memoryHistoryStoredAt.get(normalized.id) ?? 0
  );
  memoryHistory.set(normalized.id, normalized);
  memoryHistoryStoredAt.set(normalized.id, storedAt);
  const removedByRetention = applyHistoryRetentionToMemory();
  writeHistoryFallback();
  historyWriteQueue = historyWriteQueue.catch(() => undefined).then(async () => {
    if (generation !== historyGeneration) return;
    try {
      await transact(STORE_HISTORY, 'readwrite', (store) => generation === historyGeneration
        ? store.put({
          ...normalized,
          repositorySchemaVersion: REPOSITORY_SCHEMA_VERSION,
          repositoryStoredAt: storedAt
        })
        : store.get(normalized.id));
      await deleteStoreKeys(STORE_HISTORY, removedByRetention);
      await enforceHistoryRetention();
    } catch {
      // Memory/localStorage already contain the confirmed result.
    }
  });
  await historyWriteQueue;
}

export async function getHistory(): Promise<CalculationResult[]> {
  const generation = historyGeneration;
  let ledger = readDeletionLedger(HISTORY_DELETION_LEDGER_KEY);
  for (const id of memoryHistory.keys()) {
    if (!repositoryRecordVisible({ repositoryStoredAt: memoryHistoryStoredAt.get(id) }, id, ledger)) {
      memoryHistory.delete(id);
      memoryHistoryStoredAt.delete(id);
    }
  }
  if (localStorageAvailable()) {
    try {
      const raw = localStorage.getItem(HISTORY_FALLBACK_KEY);
      const envelope = raw ? JSON.parse(raw) as Partial<VersionedRepositoryValue<unknown>> : null;
      if (envelope?.schemaVersion === REPOSITORY_SCHEMA_VERSION && Array.isArray(envelope.value)) {
        for (const value of envelope.value) rememberHistoryRecord(value, ledger);
      }
    } catch {
      // A corrupt fallback is isolated from settings and valid in-memory data.
    }
  }
  try {
    const results = await transact<unknown[]>(STORE_HISTORY, 'readonly', (store) => store.getAll());
    ledger = readDeletionLedger(HISTORY_DELETION_LEDGER_KEY);
    for (const value of results ?? []) {
      if (generation === historyGeneration) rememberHistoryRecord(value, ledger);
    }
    if (generation === historyGeneration) {
      applyHistoryRetentionToMemory();
      await enforceHistoryRetention(results);
    }
  } catch {
    // Memory/localStorage are the controlled fallback.
  }
  const merged = retainedHistory([...memoryHistory.values()]);
  if (generation === historyGeneration) writeHistoryFallback();
  return merged;
}

export async function deleteResult(id: string): Promise<void> {
  const generation = historyGeneration;
  markRepositoryDelete(HISTORY_DELETION_LEDGER_KEY, id);
  memoryHistory.delete(id);
  memoryHistoryStoredAt.delete(id);
  writeHistoryFallback();
  historyWriteQueue = historyWriteQueue.catch(() => undefined).then(async () => {
    if (generation !== historyGeneration) return;
    try {
      await transact(STORE_HISTORY, 'readwrite', (store) => store.delete(id));
    } catch {
      // Fallback repositories are already updated.
    }
  });
  await historyWriteQueue;
}

export async function clearHistory(): Promise<void> {
  markRepositoryClear(HISTORY_DELETION_LEDGER_KEY);
  historyGeneration += 1;
  memoryHistory.clear();
  memoryHistoryStoredAt.clear();
  if (localStorageAvailable()) {
    try { localStorage.removeItem(HISTORY_FALLBACK_KEY); } catch { /* no-op */ }
  }
  historyWriteQueue = historyWriteQueue.catch(() => undefined).then(async () => {
    try {
      await transact(STORE_HISTORY, 'readwrite', (store) => store.clear());
    } catch {
      // Memory/localStorage are already cleared.
    }
  });
  await historyWriteQueue;
}

interface StoredCalibrationRecord {
  key: string;
  value: PieceCalibration;
  repositoryStoredAt?: number;
}

function isStoredCalibrationRecord(value: unknown): value is StoredCalibrationRecord {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<StoredCalibrationRecord>;
  return typeof record.key === 'string'
    && Boolean(record.value)
    && record.value?.schemaVersion === 2;
}

async function putCalibrationRecord(
  calibration: PieceCalibration,
  generation = calibrationGeneration,
  storedAt = repositoryTimestampForWrite(
    readDeletionLedger(CALIBRATION_DELETION_LEDGER_KEY),
    calibration.calibrationId,
    memoryCalibrationStoredAt.get(calibration.calibrationId) ?? 0
  )
): Promise<void> {
  const stored: StoredCalibrationRecord = {
    key: calibration.calibrationId,
    value: calibration,
    repositoryStoredAt: storedAt
  };
  calibrationWriteQueue = calibrationWriteQueue.catch(() => undefined).then(async () => {
    if (generation !== calibrationGeneration) return;
    await transact(STORE_CALIBRATIONS, 'readwrite', (store) => generation === calibrationGeneration
      ? store.put(stored)
      : store.get(calibration.calibrationId));
  });
  await calibrationWriteQueue;
}

function rememberCalibrationRecord(value: unknown, ledger: RepositoryDeletionLedger): PieceCalibration | null {
  const calibration = normalizeStoredCalibration(value);
  if (!calibration || !repositoryRecordVisible(value, calibration.calibrationId, ledger)) return null;
  const storedAt = repositoryStoredAt(value) ?? 0;
  const previous = memoryCalibrationStoredAt.get(calibration.calibrationId) ?? -1;
  if (previous > storedAt) return memoryCalibrations.get(calibration.calibrationId) ?? null;
  memoryCalibrations.set(calibration.calibrationId, calibration);
  memoryCalibrationStoredAt.set(calibration.calibrationId, storedAt);
  return calibration;
}

function readFallbackCalibrations(ledger: RepositoryDeletionLedger): PieceCalibration[] {
  const records = [...memoryCalibrations.values()];
  if (!localStorageAvailable()) return records;
  try {
    const raw = localStorage.getItem(CALIBRATIONS_FALLBACK_KEY);
    const parsed = raw ? JSON.parse(raw) as unknown : [];
    if (Array.isArray(parsed)) {
      for (const value of parsed) rememberCalibrationRecord(value, ledger);
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
    const stored: StoredCalibrationRecord[] = records.map((record) => ({
      key: record.calibrationId,
      value: record,
      repositoryStoredAt: memoryCalibrationStoredAt.get(record.calibrationId) ?? 0
    }));
    localStorage.setItem(CALIBRATIONS_FALLBACK_KEY, JSON.stringify(stored));
  } catch {
    // IndexedDB or memory still retains the calibration.
  }
}

function retainedCalibrations(records: PieceCalibration[]): PieceCalibration[] {
  return [...records]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, IDB_CALIBRATION_MAX_ENTRIES);
}

function applyCalibrationRetentionToMemory(): string[] {
  const keep = new Set(retainedCalibrations([...memoryCalibrations.values()])
    .map((record) => record.calibrationId));
  const removed = [...memoryCalibrations.keys()].filter((id) => !keep.has(id));
  for (const id of removed) {
    memoryCalibrations.delete(id);
    memoryCalibrationStoredAt.delete(id);
  }
  return removed;
}

async function enforceCalibrationRetention(rawRecords?: unknown[]): Promise<void> {
  const records = rawRecords
    ?? await transact<unknown[]>(STORE_CALIBRATIONS, 'readonly', (store) => store.getAll());
  const parsed = records.map((value) => {
    const calibration = normalizeStoredCalibration(value);
    const id = calibration?.calibrationId
      ?? (value && typeof value === 'object' && typeof (value as { key?: unknown }).key === 'string'
        ? (value as { key: string }).key
        : null);
    return { id, calibration };
  });
  const keep = new Set(retainedCalibrations(
    parsed.flatMap((item) => item.calibration ? [item.calibration] : [])
  ).map((record) => record.calibrationId));
  await deleteStoreKeys(
    STORE_CALIBRATIONS,
    parsed.flatMap((item) => item.id && !keep.has(item.id) ? [item.id] : [])
  );
}

export async function getCalibrations(): Promise<PieceCalibration[]> {
  const generation = calibrationGeneration;
  let ledger = readDeletionLedger(CALIBRATION_DELETION_LEDGER_KEY);
  for (const id of memoryCalibrations.keys()) {
    if (!repositoryRecordVisible({ repositoryStoredAt: memoryCalibrationStoredAt.get(id) }, id, ledger)) {
      memoryCalibrations.delete(id);
      memoryCalibrationStoredAt.delete(id);
    }
  }
  const merged = new Map<string, PieceCalibration>();
  const pendingMigrations = new Map<string, PieceCalibration>();
  for (const calibration of readFallbackCalibrations(ledger)) {
    merged.set(calibration.calibrationId, calibration);
  }

  try {
    const rawRecords = await transact<unknown[]>(STORE_CALIBRATIONS, 'readonly', (store) => store.getAll());
    ledger = readDeletionLedger(CALIBRATION_DELETION_LEDGER_KEY);
    for (const value of rawRecords ?? []) {
      if (generation !== calibrationGeneration) continue;
      const calibration = rememberCalibrationRecord(value, ledger);
      if (!calibration) continue;
      merged.set(calibration.calibrationId, calibration);
      if (!isStoredCalibrationRecord(value)) {
        pendingMigrations.set(calibration.calibrationId, calibration);
      }
    }
    if (generation === calibrationGeneration) {
      applyCalibrationRetentionToMemory();
      await enforceCalibrationRetention(rawRecords);
    }
  } catch {
    // The fallback records are already available.
  }

  const records = retainedCalibrations([...memoryCalibrations.values()]);
  if (generation === calibrationGeneration) writeFallbackCalibrations(records);

  // Legacy records remain untouched for rollback. Their normalized v2 copy is
  // written under a separate key and read back before this migration is treated
  // as successful; a later cleanup release may remove the legacy record.
  for (const calibration of pendingMigrations.values()) {
    if (generation !== calibrationGeneration) break;
    try {
      await putCalibrationRecord(calibration, generation);
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
  const normalized = normalizeStoredCalibration(calibration);
  if (!normalized) throw new Error('Ungültige Kalibrierung kann nicht gespeichert werden.');
  const generation = calibrationGeneration;
  const existing = await getCalibrations();
  if (generation !== calibrationGeneration) return;
  const storedAt = repositoryTimestampForWrite(
    readDeletionLedger(CALIBRATION_DELETION_LEDGER_KEY),
    normalized.calibrationId,
    memoryCalibrationStoredAt.get(normalized.calibrationId) ?? 0
  );
  const records = existing.filter((item) => item.calibrationId !== normalized.calibrationId);
  records.push(normalized);
  memoryCalibrationStoredAt.set(normalized.calibrationId, storedAt);
  writeFallbackCalibrations(retainedCalibrations(records));
  try {
    await putCalibrationRecord(normalized, generation, storedAt);
    const removed = applyCalibrationRetentionToMemory();
    await deleteStoreKeys(STORE_CALIBRATIONS, removed);
    await enforceCalibrationRetention();
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
  const generation = calibrationGeneration;
  const records = (await getCalibrations()).filter((item) => item.calibrationId !== calibrationId);
  if (generation !== calibrationGeneration) return;
  markRepositoryDelete(CALIBRATION_DELETION_LEDGER_KEY, calibrationId);
  memoryCalibrationStoredAt.delete(calibrationId);
  writeFallbackCalibrations(records);
  calibrationWriteQueue = calibrationWriteQueue.catch(() => undefined).then(async () => {
    if (generation !== calibrationGeneration) return;
    try {
      await transact(STORE_CALIBRATIONS, 'readwrite', (store) => store.delete(calibrationId));
    } catch {
      // Fallback storage is already updated.
    }
  });
  await calibrationWriteQueue;
}

export async function clearCalibrations(): Promise<void> {
  markRepositoryClear(CALIBRATION_DELETION_LEDGER_KEY);
  calibrationGeneration += 1;
  memoryCalibrations.clear();
  memoryCalibrationStoredAt.clear();
  if (localStorageAvailable()) {
    try { localStorage.removeItem(CALIBRATIONS_FALLBACK_KEY); } catch { /* no-op */ }
  }
  calibrationWriteQueue = calibrationWriteQueue.catch(() => undefined).then(async () => {
    try {
      await transact(STORE_CALIBRATIONS, 'readwrite', (store) => store.clear());
    } catch {
      // Memory and localStorage were cleared even when IndexedDB is unavailable.
    }
  });
  await calibrationWriteQueue;
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  if (!isSettingsRecord(settings)) throw new Error('Ungültige Einstellungen können nicht gespeichert werden.');
  const latestFallback = readSettingsFallback();
  // Another tab may have persisted a privacy opt-out after this tab rendered.
  // Never overwrite that newer state with a stale in-memory `true` snapshot.
  if (latestFallback && latestFallback.repositoryStoredAt > memorySettingsStoredAt) {
    memorySettings = latestFallback.settings;
    memorySettingsStoredAt = latestFallback.repositoryStoredAt;
    return;
  }
  const repositoryStoredAt = nextRepositoryTimestamp(Math.max(
    memorySettingsStoredAt,
    latestFallback?.repositoryStoredAt ?? 0
  ));
  const stored: StoredSettingsValue = { settings, repositoryStoredAt };
  memorySettings = settings;
  memorySettingsStoredAt = repositoryStoredAt;
  writeSettingsFallback(stored);
  try {
    await transact(STORE_SETTINGS, 'readwrite', (store) => store.put({
      key: 'app',
      schemaVersion: REPOSITORY_SCHEMA_VERSION,
      value: settings,
      repositoryStoredAt
    }));
  } catch {
    // Memory/localStorage already contain the settings.
  }
}

export async function loadSettings(): Promise<AppSettings | null> {
  let selected: StoredSettingsValue | null = memorySettings
    ? { settings: memorySettings, repositoryStoredAt: memorySettingsStoredAt }
    : null;
  const fallback = readSettingsFallback();
  if (fallback && (!selected || fallback.repositoryStoredAt >= selected.repositoryStoredAt)) {
    selected = fallback;
  }
  try {
    const result = await transact<{
      key: string;
      schemaVersion?: number;
      value?: unknown;
      repositoryStoredAt?: unknown;
    } | undefined>(
      STORE_SETTINGS,
      'readonly',
      (store) => store.get('app')
    );
    const idb = result
      ? parseStoredSettingsValue(
        result.value && typeof result.value === 'object' && 'settings' in result.value
          ? result.value
          : { settings: result.value, repositoryStoredAt: result.repositoryStoredAt }
      )
      : null;
    if (idb && (!selected || idb.repositoryStoredAt > selected.repositoryStoredAt)) {
      selected = idb;
    }
  } catch {
    // Memory/localStorage remain available.
  }
  if (selected) {
    memorySettings = selected.settings;
    memorySettingsStoredAt = selected.repositoryStoredAt;
    writeSettingsFallback(selected);
  }
  return memorySettings;
}

export async function getApiCache<T>(key: string): Promise<ApiCacheEntry<T> | null> {
  let ledger = readDeletionLedger(API_CACHE_DELETION_LEDGER_KEY);
  let fallback = readFallbackEntries().find((entry) =>
    entry.key === key && repositoryRecordVisible(entry, key, ledger)
  ) as ApiCacheEntry<T> | undefined;
  const memory = memoryApiCache.get(key) as ApiCacheEntry<T> | undefined;
  if (memory) {
    if (isValidApiCacheEntry(memory) && repositoryRecordVisible(memory, key, ledger)) {
      if (fallback && (fallback.repositoryStoredAt ?? 0) > (memory.repositoryStoredAt ?? 0)) {
        rememberApiEntry(fallback as ApiCacheEntry);
        lastPersistence = 'localstorage';
        return { ...fallback, readLayer: 'browser-localstorage' };
      }
      return { ...memory, readLayer: 'browser-memory' };
    }
    memoryApiCache.delete(key);
  }

  // IndexedDB is the authoritative durable browser cache. Its transaction is
  // bounded, so browsers with broken/blocked IDB still reach localStorage.
  try {
    const entry = (await transact<ApiCacheEntry<T> | undefined>(
      STORE_API_CACHE,
      'readonly',
      (store) => store.get(key)
    )) ?? null;
    ledger = readDeletionLedger(API_CACHE_DELETION_LEDGER_KEY);
    fallback = readFallbackEntries().find((candidate) =>
      candidate.key === key && repositoryRecordVisible(candidate, key, ledger)
    ) as ApiCacheEntry<T> | undefined;
    if (entry && isValidApiCacheEntry(entry) && repositoryRecordVisible(entry, key, ledger)) {
      if (fallback && (fallback.repositoryStoredAt ?? 0) > (entry.repositoryStoredAt ?? 0)) {
        rememberApiEntry(fallback as ApiCacheEntry);
        lastPersistence = 'localstorage';
        return { ...fallback, readLayer: 'browser-localstorage' };
      }
      rememberApiEntry(entry as ApiCacheEntry);
      lastPersistence = 'indexeddb';
      return { ...entry, readLayer: 'browser-indexeddb' };
    }
    if (entry && !isValidApiCacheEntry(entry)) {
      void deleteApiCacheKeys([key], false).catch(() => undefined);
    }
  } catch {
    // Cache misses remain cheap during the IndexedDB retry backoff.
  }

  ledger = readDeletionLedger(API_CACHE_DELETION_LEDGER_KEY);
  fallback = readFallbackEntries().find((entry) =>
    entry.key === key && repositoryRecordVisible(entry, key, ledger)
  ) as ApiCacheEntry<T> | undefined;
  if (fallback) {
    rememberApiEntry(fallback as ApiCacheEntry);
    lastPersistence = 'localstorage';
    return { ...fallback, readLayer: 'browser-localstorage' };
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
    let timeout: ReturnType<typeof globalThis.setTimeout> | null = null;
    const clearTransactionTimeout = () => {
      if (timeout !== null) globalThis.clearTimeout(timeout);
      timeout = null;
    };
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      clearTransactionTimeout();
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

    timeout = globalThis.setTimeout(() => {
      try { tx.abort(); } catch { /* no-op */ }
      resetDatabaseConnection(db);
      fail(new Error(`API-Cache-Transaktion hat nach ${IDB_TRANSACTION_TIMEOUT_MS} ms nicht geantwortet.`));
    }, IDB_TRANSACTION_TIMEOUT_MS);

    request.onerror = () => fail(request.error);
    tx.oncomplete = () => {
      if (settled) return;
      settled = true;
      clearTransactionTimeout();
      resolve();
    };
    tx.onerror = () => fail(tx.error);
    tx.onabort = () => fail(tx.error ?? new Error('API-Cache-Transaktion wurde abgebrochen.'));
  });
}

function approximateEntryBytes(entry: ApiCacheEntry): number {
  try {
    // UTF-16 is a conservative, deterministic browser-side approximation.
    return JSON.stringify(entry).length * 2;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

async function enforceApiCacheBounds(now = Date.now(), rawEntries?: ApiCacheEntry[]): Promise<void> {
  const entries = rawEntries
    ?? await transact<ApiCacheEntry[]>(STORE_API_CACHE, 'readonly', (store) => store.getAll());
  const ledger = readDeletionLedger(API_CACHE_DELETION_LEDGER_KEY);
  const candidates = entries
    .filter((entry) => isValidApiCacheEntry(entry)
      && entry.staleUntil > now
      && repositoryRecordVisible(entry, entry.key, ledger))
    .sort((a, b) => (b.repositoryStoredAt ?? b.storedAt) - (a.repositoryStoredAt ?? a.storedAt));
  const keep = new Set<string>();
  let bytes = 0;
  for (const entry of candidates) {
    const entryBytes = approximateEntryBytes(entry);
    if (keep.size >= IDB_API_CACHE_MAX_ENTRIES || bytes + entryBytes > IDB_API_CACHE_MAX_BYTES) continue;
    keep.add(entry.key);
    bytes += entryBytes;
  }
  const removed = entries.flatMap((entry) => {
    const key = entry && typeof entry === 'object' && typeof entry.key === 'string' ? entry.key : null;
    return key && !keep.has(key) ? [key] : [];
  });
  await deleteStoreKeys(STORE_API_CACHE, removed);
}

export async function putApiCache<T>(entry: ApiCacheEntry<T>): Promise<void> {
  if (!isValidApiCacheEntry(entry)) return;
  const persistedEntry: ApiCacheEntry<T> = {
    ...entry,
    repositoryStoredAt: repositoryTimestampForWrite(
      readDeletionLedger(API_CACHE_DELETION_LEDGER_KEY),
      entry.key,
      memoryApiCache.get(entry.key)?.repositoryStoredAt ?? entry.repositoryStoredAt ?? 0
    )
  };
  rememberApiEntry(persistedEntry as ApiCacheEntry);
  const mirrored = mirrorEntryToFallback(persistedEntry as ApiCacheEntry);
  lastPersistence = mirrored ? 'localstorage' : 'memory';

  // Memory and the compact canonical localStorage mirror are available before
  // this function returns. IndexedDB persistence continues in the background so
  // a slow Android WebView database open cannot delay a successful API result.
  const generation = apiCacheGeneration;
  apiCacheWriteQueue = apiCacheWriteQueue.catch(() => undefined).then(async () => {
    if (generation !== apiCacheGeneration) return;
    try {
      await persistApiCacheEntry(persistedEntry as ApiCacheEntry, generation);
      if (generation !== apiCacheGeneration) return;
      await enforceApiCacheBounds();
      lastPersistence = 'indexeddb';
      lastPersistenceIssue = 'none';
    } catch (error) {
      lastPersistenceIssue = persistenceIssueFor(error);
      // The request path must never fail solely because persistence is blocked.
    }
  });
  void apiCacheWriteQueue;
}

export async function clearApiCache(): Promise<void> {
  markRepositoryClear(API_CACHE_DELETION_LEDGER_KEY);
  apiCacheGeneration += 1;
  memoryApiCache.clear();
  await apiCacheWriteQueue.catch(() => undefined);
  try {
    await transact(STORE_API_CACHE, 'readwrite', (store) => store.clear());
  } catch {
    // IndexedDB may be unavailable or blocked.
  }
  if (localStorageAvailable()) {
    try { localStorage.removeItem(API_CACHE_FALLBACK_KEY); } catch { /* no-op */ }
  }
  lastPersistence = 'memory';
  lastPersistenceIssue = 'none';
}

async function deleteApiCacheKeys(keys: string[], tombstone = true): Promise<void> {
  if (!keys.length) return;
  if (tombstone) {
    markRepositoryDeletes(API_CACHE_DELETION_LEDGER_KEY, keys);
    for (const key of keys) memoryApiCache.delete(key);
    const keySet = new Set(keys);
    const fallback = readFallbackEntries().filter((entry) => !keySet.has(entry.key));
    if (fallback.length) writeFallbackEntries(fallback);
    else if (localStorageAvailable()) {
      try { localStorage.removeItem(API_CACHE_FALLBACK_KEY); } catch { /* no-op */ }
    }
  }
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    let tx: IDBTransaction;
    let timeout: ReturnType<typeof globalThis.setTimeout> | null = null;
    const clearTransactionTimeout = () => {
      if (timeout !== null) globalThis.clearTimeout(timeout);
      timeout = null;
    };
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      clearTransactionTimeout();
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
    timeout = globalThis.setTimeout(() => {
      try { tx.abort(); } catch { /* no-op */ }
      resetDatabaseConnection(db);
      fail(new Error(`Cache-Bereinigung hat nach ${IDB_TRANSACTION_TIMEOUT_MS} ms nicht geantwortet.`));
    }, IDB_TRANSACTION_TIMEOUT_MS);
    tx.oncomplete = () => {
      if (settled) return;
      settled = true;
      clearTransactionTimeout();
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
    const liveKeys = new Set([
      ...memoryApiCache.values(),
      ...readFallbackEntries()
    ].filter((entry) => entry.staleUntil > now).map((entry) => entry.key));
    const expiredKeys = entries
      .filter((entry) => isValidApiCacheEntry(entry) && entry.staleUntil <= now && !liveKeys.has(entry.key))
      .map((entry) => entry.key);
    await deleteApiCacheKeys(expiredKeys, false);
    await enforceApiCacheBounds(now, entries);
  } catch {
    // Best-effort maintenance only.
  }
}

export async function getApiCacheStats(now = Date.now()): Promise<ApiCacheStats> {
  let ledger = readDeletionLedger(API_CACHE_DELETION_LEDGER_KEY);
  const combined = new Map<string, ApiCacheEntry>();
  for (const entry of memoryApiCache.values()) {
    if (isValidApiCacheEntry(entry) && repositoryRecordVisible(entry, entry.key, ledger)) {
      combined.set(entry.key, entry);
    }
  }
  for (const entry of readFallbackEntries()) {
    if (!repositoryRecordVisible(entry, entry.key, ledger)) continue;
    const previous = combined.get(entry.key);
    if (!previous || previous.storedAt < entry.storedAt) combined.set(entry.key, entry);
  }

  try {
    const stored = await transact<ApiCacheEntry[]>(STORE_API_CACHE, 'readonly', (store) => store.getAll());
    ledger = readDeletionLedger(API_CACHE_DELETION_LEDGER_KEY);
    for (const entry of stored) {
      if (!isValidApiCacheEntry(entry) || !repositoryRecordVisible(entry, entry.key, ledger)) continue;
      const previous = combined.get(entry.key);
      if (!previous || previous.storedAt < entry.storedAt) combined.set(entry.key, entry);
    }
    lastPersistence = 'indexeddb';
  } catch (error) {
    lastPersistenceIssue = persistenceIssueFor(error);
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
    persistence: lastPersistence,
    persistenceIssue: lastPersistenceIssue
  };
}
