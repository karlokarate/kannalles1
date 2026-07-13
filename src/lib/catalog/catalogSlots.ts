import { CatalogFailure } from './catalogErrors';
import type { CatalogSlotId } from './catalogDomain';

export const CATALOG_SLOT_FILES = {
  a: 'catalog-a.sqlite',
  b: 'catalog-b.sqlite'
} as const;

export interface CatalogActivationRecord {
  readonly activeSlot: CatalogSlotId;
  readonly catalogVersion: string;
  readonly sha256: string;
  readonly validatedAt: string;
  readonly previousSlot: CatalogSlotId | null;
}

export interface CatalogActivationStore {
  readActivationRecord(): Promise<CatalogActivationRecord | null>;
  activateValidatedSlot(nextRecord: CatalogActivationRecord): Promise<void>;
  clearInactiveSlotMetadata(slot: CatalogSlotId): Promise<void>;
}

const DATABASE_NAME = 'kh-checker-catalog-activation-v1';
const STORE_NAME = 'activation';
const RECORD_KEY = 'active';

function isSlotId(value: unknown): value is CatalogSlotId {
  return value === 'a' || value === 'b';
}

export function parseActivationRecord(value: unknown): CatalogActivationRecord | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'object') {
    throw new CatalogFailure('CATALOG_STORAGE_UNAVAILABLE', 'Der Katalog-Aktivierungsdatensatz ist ungültig.', {
      operation: 'initialize'
    });
  }
  const record = value as Record<string, unknown>;
  const activeSlot = record.activeSlot;
  const previousSlot = record.previousSlot;
  if (
    !isSlotId(activeSlot)
    || (previousSlot !== null && !isSlotId(previousSlot))
    || previousSlot === activeSlot
    || typeof record.catalogVersion !== 'string'
    || record.catalogVersion.length === 0
    || typeof record.sha256 !== 'string'
    || !/^[a-f0-9]{64}$/i.test(record.sha256)
    || typeof record.validatedAt !== 'string'
    || Number.isNaN(Date.parse(record.validatedAt))
  ) {
    throw new CatalogFailure('CATALOG_STORAGE_UNAVAILABLE', 'Der Katalog-Aktivierungsdatensatz ist ungültig.', {
      operation: 'initialize'
    });
  }
  return {
    activeSlot,
    catalogVersion: record.catalogVersion,
    sha256: record.sha256.toLowerCase(),
    validatedAt: record.validatedAt,
    previousSlot
  };
}

export function inactiveSlot(activeSlot: CatalogSlotId | null): CatalogSlotId {
  return activeSlot === 'a' ? 'b' : 'a';
}

function openActivationDatabase(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let request: IDBOpenDBRequest;
    try {
      request = factory.open(DATABASE_NAME, 1);
    } catch (cause) {
      reject(new CatalogFailure('CATALOG_STORAGE_UNAVAILABLE', 'Katalog-Aktivierungsdaten können nicht geöffnet werden.', {
        operation: 'initialize',
        cause
      }));
      return;
    }
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME);
      }
    };
    request.onerror = () => reject(new CatalogFailure(
      'CATALOG_STORAGE_UNAVAILABLE',
      'Katalog-Aktivierungsdaten können nicht geöffnet werden.',
      { operation: 'initialize', cause: request.error }
    ));
    request.onsuccess = () => resolve(request.result);
  });
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted'));
  });
}

export class IndexedDbCatalogActivationStore implements CatalogActivationStore {
  constructor(private readonly factory: IDBFactory = indexedDB) {}

  async readActivationRecord(): Promise<CatalogActivationRecord | null> {
    const database = await openActivationDatabase(this.factory);
    try {
      const transaction = database.transaction(STORE_NAME, 'readonly');
      const request = transaction.objectStore(STORE_NAME).get(RECORD_KEY);
      const value = await new Promise<unknown>((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      return parseActivationRecord(value);
    } catch (cause) {
      if (cause instanceof CatalogFailure) throw cause;
      throw new CatalogFailure('CATALOG_STORAGE_UNAVAILABLE', 'Katalog-Aktivierungsdaten können nicht gelesen werden.', {
        operation: 'initialize',
        cause
      });
    } finally {
      database.close();
    }
  }

  async activateValidatedSlot(nextRecord: CatalogActivationRecord): Promise<void> {
    const record = parseActivationRecord(nextRecord);
    if (!record) {
      throw new CatalogFailure('CATALOG_STORAGE_UNAVAILABLE', 'Ein leerer Aktivierungsdatensatz kann nicht gespeichert werden.', {
        operation: 'activate'
      });
    }
    const database = await openActivationDatabase(this.factory);
    try {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      transaction.objectStore(STORE_NAME).put(record, RECORD_KEY);
      await transactionComplete(transaction);
    } catch (cause) {
      throw new CatalogFailure('CATALOG_STORAGE_UNAVAILABLE', 'Der validierte Katalogslot konnte nicht atomar aktiviert werden.', {
        operation: 'activate',
        activeSlot: record.previousSlot,
        attemptedSlot: record.activeSlot,
        catalogVersion: record.catalogVersion,
        cause
      });
    } finally {
      database.close();
    }
  }

  async clearInactiveSlotMetadata(slot: CatalogSlotId): Promise<void> {
    const database = await openActivationDatabase(this.factory);
    try {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(RECORD_KEY);
      const current = await new Promise<CatalogActivationRecord | null>((resolve, reject) => {
        request.onsuccess = () => {
          try {
            resolve(parseActivationRecord(request.result));
          } catch (error) {
            reject(error);
          }
        };
        request.onerror = () => reject(request.error);
      });
      if (current?.activeSlot === slot) {
        transaction.abort();
        throw new CatalogFailure('CATALOG_STORAGE_UNAVAILABLE', 'Metadaten des aktiven Katalogslots dürfen nicht gelöscht werden.', {
          operation: 'install',
          activeSlot: current.activeSlot,
          attemptedSlot: slot,
          catalogVersion: current.catalogVersion
        });
      }
      if (current?.previousSlot === slot) {
        store.put({ ...current, previousSlot: null } satisfies CatalogActivationRecord, RECORD_KEY);
      }
      await transactionComplete(transaction);
    } catch (cause) {
      if (cause instanceof CatalogFailure) throw cause;
      throw new CatalogFailure('CATALOG_STORAGE_UNAVAILABLE', 'Inaktive Katalogslot-Metadaten konnten nicht bereinigt werden.', {
        operation: 'install',
        attemptedSlot: slot,
        cause
      });
    } finally {
      database.close();
    }
  }
}

const defaultStore = typeof indexedDB === 'undefined' ? null : new IndexedDbCatalogActivationStore();

function requireDefaultStore(): IndexedDbCatalogActivationStore {
  if (!defaultStore) {
    throw new CatalogFailure('CATALOG_STORAGE_UNAVAILABLE', 'IndexedDB ist für den Katalog nicht verfügbar.', {
      operation: 'initialize'
    });
  }
  return defaultStore;
}

export function readActivationRecord(): Promise<CatalogActivationRecord | null> {
  return requireDefaultStore().readActivationRecord();
}

export function activateValidatedSlot(nextRecord: CatalogActivationRecord): Promise<void> {
  return requireDefaultStore().activateValidatedSlot(nextRecord);
}

export function clearInactiveSlotMetadata(slot: CatalogSlotId): Promise<void> {
  return requireDefaultStore().clearInactiveSlotMetadata(slot);
}
