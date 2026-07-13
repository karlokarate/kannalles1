import type { CatalogSlotId } from './catalogDomain';
import { CatalogFailure } from './catalogErrors';
import type { CatalogManifest } from './catalogProtocol';

export interface CatalogSlotMetadata {
  readonly slot: CatalogSlotId;
  readonly filename: string;
  readonly catalogVersion: string;
  readonly sha256: string;
  readonly sizeBytes: number;
  readonly applicationId: number;
  readonly userVersion: number;
  readonly pageSize: number;
  readonly productCount: number;
  readonly brandCount: number;
  readonly validatedAtUtc: string;
}

export interface CatalogSlotState {
  readonly schemaVersion: 1;
  readonly activeSlot: CatalogSlotId | null;
  readonly rollbackSlot: CatalogSlotId | null;
  readonly slots: Readonly<Record<CatalogSlotId, CatalogSlotMetadata | null>>;
}

const DATABASE_NAME = 'kh-checker-catalog-slots-v1';
const STORE_NAME = 'state';
const STATE_KEY = 'catalog-slot-state';

export function emptyCatalogSlotState(): CatalogSlotState {
  return {
    schemaVersion: 1,
    activeSlot: null,
    rollbackSlot: null,
    slots: { a: null, b: null }
  };
}

export function inactiveCatalogSlot(activeSlot: CatalogSlotId | null): CatalogSlotId {
  return activeSlot === 'a' ? 'b' : 'a';
}

/** Same manifest filename is used in each isolated slot pool. */
export function catalogSlotDatabasePath(filename: string): string {
  return `/${filename}`;
}

export function slotMetadataFromManifest(
  slot: CatalogSlotId,
  manifest: CatalogManifest,
  validatedAtUtc: string
): CatalogSlotMetadata {
  return {
    slot,
    filename: manifest.filename,
    catalogVersion: manifest.catalogVersion,
    sha256: manifest.sha256,
    sizeBytes: manifest.sizeBytes,
    applicationId: manifest.applicationId,
    userVersion: manifest.userVersion,
    pageSize: manifest.pageSize,
    productCount: manifest.productCount,
    brandCount: manifest.brandCount,
    validatedAtUtc
  };
}

export function recordValidatedCatalogSlot(
  state: CatalogSlotState,
  metadata: CatalogSlotMetadata
): CatalogSlotState {
  return {
    ...state,
    slots: { ...state.slots, [metadata.slot]: metadata }
  };
}

export function activateCatalogSlot(state: CatalogSlotState, slot: CatalogSlotId): CatalogSlotState {
  if (!state.slots[slot]) {
    throw new CatalogFailure('CATALOG_STORAGE_UNAVAILABLE', 'Ein nicht validierter Katalogslot kann nicht aktiviert werden.', {
      operation: 'activate',
      activeSlot: state.activeSlot,
      attemptedSlot: slot
    });
  }
  if (state.activeSlot === slot) return state;
  const previousActive = state.activeSlot;
  return {
    ...state,
    activeSlot: slot,
    rollbackSlot: previousActive && state.slots[previousActive] ? previousActive : null
  };
}

export function discardCatalogSlot(state: CatalogSlotState, slot: CatalogSlotId): CatalogSlotState {
  return {
    ...state,
    activeSlot: state.activeSlot === slot ? null : state.activeSlot,
    rollbackSlot: state.rollbackSlot === slot ? null : state.rollbackSlot,
    slots: { ...state.slots, [slot]: null }
  };
}

export function rollbackCatalogSlot(state: CatalogSlotState): CatalogSlotState {
  const failedActive = state.activeSlot;
  const rollbackSlot = state.rollbackSlot;
  if (!rollbackSlot || !state.slots[rollbackSlot]) {
    throw new CatalogFailure('CATALOG_OPEN_FAILED', 'Kein validierter Rollback-Slot ist verfügbar.', {
      operation: 'rollback',
      activeSlot: failedActive
    });
  }
  return {
    ...state,
    activeSlot: rollbackSlot,
    rollbackSlot: null,
    slots: failedActive ? { ...state.slots, [failedActive]: null } : state.slots
  };
}

function isSlotId(value: unknown): value is CatalogSlotId {
  return value === 'a' || value === 'b';
}

function isMetadata(value: unknown, slot: CatalogSlotId): value is CatalogSlotMetadata {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return item.slot === slot
    && typeof item.filename === 'string'
    && item.filename.length > 0
    && typeof item.catalogVersion === 'string'
    && /^[a-f0-9]{64}$/i.test(String(item.sha256))
    && Number.isSafeInteger(item.sizeBytes)
    && Number(item.sizeBytes) > 0
    && Number.isSafeInteger(item.applicationId)
    && Number.isSafeInteger(item.userVersion)
    && Number.isSafeInteger(item.pageSize)
    && Number.isSafeInteger(item.productCount)
    && Number(item.productCount) > 0
    && Number.isSafeInteger(item.brandCount)
    && Number(item.brandCount) > 0
    && typeof item.validatedAtUtc === 'string'
    && !Number.isNaN(Date.parse(item.validatedAtUtc));
}

export function parseCatalogSlotState(value: unknown): CatalogSlotState {
  if (value === undefined) return emptyCatalogSlotState();
  if (!value || typeof value !== 'object') {
    throw new CatalogFailure('CATALOG_STORAGE_UNAVAILABLE', 'Der persistierte Katalogslot-Zustand ist ungültig.', {
      operation: 'initialize'
    });
  }
  const item = value as Record<string, unknown>;
  const slotsValue = item.slots;
  if (item.schemaVersion !== 1 || !slotsValue || typeof slotsValue !== 'object') {
    throw new CatalogFailure('CATALOG_STORAGE_UNAVAILABLE', 'Der persistierte Katalogslot-Zustand ist ungültig.', {
      operation: 'initialize'
    });
  }
  const slots = slotsValue as Record<string, unknown>;
  const a = slots.a === null ? null : isMetadata(slots.a, 'a') ? slots.a : undefined;
  const b = slots.b === null ? null : isMetadata(slots.b, 'b') ? slots.b : undefined;
  const activeSlot = item.activeSlot === null ? null : isSlotId(item.activeSlot) ? item.activeSlot : undefined;
  const rollbackSlot = item.rollbackSlot === null ? null : isSlotId(item.rollbackSlot) ? item.rollbackSlot : undefined;
  if (a === undefined || b === undefined || activeSlot === undefined || rollbackSlot === undefined) {
    throw new CatalogFailure('CATALOG_STORAGE_UNAVAILABLE', 'Die persistierten Katalogslot-Metadaten sind ungültig.', {
      operation: 'initialize'
    });
  }
  const parsedSlots = { a, b } as const;
  if (activeSlot && !parsedSlots[activeSlot]) {
    throw new CatalogFailure('CATALOG_STORAGE_UNAVAILABLE', 'Der aktive Slot besitzt keine validierten Metadaten.', {
      operation: 'initialize', activeSlot
    });
  }
  if (rollbackSlot && (!parsedSlots[rollbackSlot] || rollbackSlot === activeSlot)) {
    throw new CatalogFailure('CATALOG_STORAGE_UNAVAILABLE', 'Der Rollback-Slot ist ungültig.', {
      operation: 'initialize', activeSlot, attemptedSlot: rollbackSlot
    });
  }
  return { schemaVersion: 1, activeSlot, rollbackSlot, slots: parsedSlots };
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DATABASE_NAME, 1);
    } catch (error) {
      reject(new CatalogFailure('CATALOG_STORAGE_UNAVAILABLE', 'Katalogslot-Metadaten können nicht geöffnet werden.', {
        operation: 'initialize', cause: error
      }));
      return;
    }
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME);
    };
    request.onerror = () => reject(new CatalogFailure('CATALOG_STORAGE_UNAVAILABLE', 'Katalogslot-Metadaten können nicht geöffnet werden.', {
      operation: 'initialize', cause: request.error
    }));
    request.onsuccess = () => resolve(request.result);
  });
}

export interface CatalogSlotStateStore {
  read(): Promise<CatalogSlotState>;
  write(state: CatalogSlotState): Promise<void>;
}

export class CatalogSlotStore implements CatalogSlotStateStore {
  async read(): Promise<CatalogSlotState> {
    const database = await openDatabase();
    try {
      const value = await new Promise<unknown>((resolve, reject) => {
        const request = database.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(STATE_KEY);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
      });
      return parseCatalogSlotState(value);
    } catch (error) {
      if (error instanceof CatalogFailure) throw error;
      throw new CatalogFailure('CATALOG_STORAGE_UNAVAILABLE', 'Katalogslot-Metadaten können nicht gelesen werden.', {
        operation: 'initialize', cause: error
      });
    } finally {
      database.close();
    }
  }

  async write(state: CatalogSlotState): Promise<void> {
    const normalized = parseCatalogSlotState(state);
    const database = await openDatabase();
    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction(STORE_NAME, 'readwrite');
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
        transaction.oncomplete = () => resolve();
        transaction.objectStore(STORE_NAME).put(normalized, STATE_KEY);
      });
    } catch (error) {
      throw new CatalogFailure('CATALOG_STORAGE_UNAVAILABLE', 'Der aktive Katalogslot konnte nicht atomar gespeichert werden.', {
        operation: 'activate', activeSlot: normalized.activeSlot, cause: error
      });
    } finally {
      database.close();
    }
  }
}
