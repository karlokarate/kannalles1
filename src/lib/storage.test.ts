import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSettings, ManualFormValues } from '../types';
import { buildManualResult } from './manual';
import { createPieceCalibration } from './calibration';
import {
  clearCalibrations,
  clearHistory,
  getCalibrations,
  getHistory,
  loadSettings,
  saveCalibration,
  saveResult,
  saveSettings
} from './storage';

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, String(value)); }
}

interface FakeIndexedDbState {
  stores: Map<string, Map<string, unknown>>;
  failMutations: boolean;
}

function fakeIndexedDb(state: FakeIndexedDbState): IDBFactory {
  const getStore = (name: string) => {
    let store = state.stores.get(name);
    if (!store) {
      store = new Map<string, unknown>();
      state.stores.set(name, store);
    }
    return store;
  };

  const database = {
    objectStoreNames: { contains: () => true },
    onversionchange: null as (() => void) | null,
    close: () => undefined,
    transaction(storeName: string, mode: IDBTransactionMode) {
      let pending = 0;
      const transaction = {
        error: null as DOMException | null,
        oncomplete: null as (() => void) | null,
        onerror: null as (() => void) | null,
        onabort: null as (() => void) | null,
        abort() {
          this.error = new DOMException('aborted', 'AbortError');
          this.onabort?.();
        },
        objectStore() {
          const records = getStore(storeName);
          const request = <T>(read: () => T, mutate = false) => {
            pending += 1;
            const result = {
              result: undefined as T,
              error: null as DOMException | null,
              onsuccess: null as (() => void) | null,
              onerror: null as (() => void) | null
            };
            globalThis.setTimeout(() => {
              if (mutate && mode === 'readwrite' && state.failMutations) {
                result.error = new DOMException('simulated write failure', 'UnknownError');
                transaction.error = result.error;
                result.onerror?.();
                transaction.onerror?.();
                return;
              }
              result.result = read();
              result.onsuccess?.();
              pending -= 1;
              if (pending === 0) transaction.oncomplete?.();
            }, 0);
            return result as unknown as IDBRequest<T>;
          };
          return {
            getAll: () => request(() => [...records.values()]),
            get: (key: IDBValidKey) => request(() => records.get(String(key))),
            put: (value: unknown) => request(() => {
              const record = value as { key?: unknown; id?: unknown };
              const key = String(record.key ?? record.id ?? '');
              records.set(key, value);
              return key;
            }, true),
            delete: (key: IDBValidKey) => request(() => { records.delete(String(key)); }, true),
            clear: () => request(() => { records.clear(); }, true)
          };
        }
      };
      return transaction as unknown as IDBTransaction;
    }
  };

  return {
    open: () => {
      const request = {
        result: database,
        error: null,
        onerror: null as (() => void) | null,
        onblocked: null as (() => void) | null,
        onsuccess: null as (() => void) | null,
        onupgradeneeded: null as (() => void) | null
      };
      globalThis.setTimeout(() => request.onsuccess?.(), 0);
      return request as unknown as IDBOpenDBRequest;
    }
  } as unknown as IDBFactory;
}

function fakeState(): FakeIndexedDbState {
  return { stores: new Map(), failMutations: false };
}

const settings: AppSettings = {
  aiEnabled: false,
  decimalPlaces: 1,
  searchPageSize: 15,
  preferGermanMarket: true,
  saveHistory: true,
  saveSearchSession: false,
  saveCalibrations: true,
  cacheApiData: true,
  dataGatewayUrl: 'https://gateway.example',
  productApiMode: 'hybrid'
};

const manual: ManualFormValues = {
  productName: 'Saft',
  brand: '',
  amount: 250,
  unit: 'ml',
  barcode: '',
  unitWeightG: null,
  nutritionBasis: '100ml',
  carbsPer100: 8
};

beforeEach(async () => {
  vi.stubGlobal('localStorage', new MemoryStorage());
  vi.stubGlobal('indexedDB', undefined);
  await clearHistory();
});

afterEach(() => vi.unstubAllGlobals());

describe('versioned fail-soft repositories', () => {
  it('migrates pre-privacy settings with conservative explicit defaults', async () => {
    const {
      saveSearchSession: _session,
      saveCalibrations: _calibrations,
      cacheApiData: _cache,
      ...legacy
    } = settings;
    localStorage.setItem('kh-checker-settings-v3', JSON.stringify({ schemaVersion: 3, value: legacy }));
    await expect(loadSettings()).resolves.toMatchObject({
      saveHistory: false,
      saveSearchSession: false,
      saveCalibrations: false,
      cacheApiData: false,
      dataGatewayUrl: settings.dataGatewayUrl
    });
  });

  it('keeps settings usable when IndexedDB is unavailable', async () => {
    await expect(saveSettings(settings)).resolves.toBeUndefined();
    await expect(loadSettings()).resolves.toEqual(settings);
    const envelope = JSON.parse(localStorage.getItem('kh-checker-settings-v3') ?? '{}') as { schemaVersion?: number };
    expect(envelope.schemaVersion).toBe(3);
  });

  it('keeps a newer local privacy opt-out authoritative over stale IDB and stale-tab writes', async () => {
    const state = fakeState();
    state.stores.set('settings', new Map([['app', {
      key: 'app', schemaVersion: 3, value: settings, repositoryStoredAt: 100
    }]]));
    vi.stubGlobal('indexedDB', fakeIndexedDb(state));
    vi.resetModules();
    const repository = await import('./storage');
    await expect(repository.loadSettings()).resolves.toEqual(settings);

    const optedOut: AppSettings = {
      ...settings,
      saveHistory: false,
      saveSearchSession: false,
      saveCalibrations: false,
      cacheApiData: false
    };
    localStorage.setItem('kh-checker-settings-v3', JSON.stringify({
      schemaVersion: 3,
      value: { settings: optedOut, repositoryStoredAt: 200 }
    }));

    await repository.saveSettings(settings);
    await expect(repository.loadSettings()).resolves.toEqual(optedOut);
    const stored = JSON.parse(localStorage.getItem('kh-checker-settings-v3') ?? '{}') as {
      value?: Partial<AppSettings> & { settings?: AppSettings };
    };
    const persisted = stored.value?.settings ?? stored.value;
    expect(persisted?.cacheApiData).toBe(false);
    expect(persisted?.saveCalibrations).toBe(false);
  });

  it('keeps successful results in memory/localStorage when IndexedDB fails', async () => {
    const result = {
      ...buildManualResult(manual),
      dataFetchedAt: '2026-07-12T10:00:00.000Z',
      dataCacheAgeMs: 4_200
    };
    await expect(saveResult(result)).resolves.toBeUndefined();
    expect(await getHistory()).toContainEqual(expect.objectContaining({
      id: result.id,
      dataFetchedAt: result.dataFetchedAt,
      dataCacheAgeMs: 4_200
    }));
    const envelope = JSON.parse(localStorage.getItem('kh-checker-history-v3') ?? '{}') as { schemaVersion?: number };
    expect(envelope.schemaVersion).toBe(3);
  });

  it('does not resurrect a result or calibration when a concurrent clear wins', async () => {
    const result = buildManualResult(manual);
    const calibration = createPieceCalibration({
      productName: 'Riegel',
      displayName: 'Riegel',
      brand: null,
      barcode: null,
      unit: 'bar',
      measuredCount: 2,
      measuredTotalWeightG: 40,
      carbohydratesPer100g: 50,
      smallestEdibleUnit: true
    });
    expect(calibration).not.toBeNull();
    if (!calibration) throw new Error('Kalibrierung konnte nicht erzeugt werden.');
    const savingResult = saveResult(result);
    const clearingHistory = clearHistory();
    const savingCalibration = saveCalibration(calibration);
    const clearingCalibrations = clearCalibrations();
    await Promise.all([savingResult, clearingHistory, savingCalibration, clearingCalibrations]);
    expect(await getHistory()).toEqual([]);
    expect(await getCalibrations()).toEqual([]);
  });

  it('bounds a hanging IndexedDB transaction and returns the local fallback', async () => {
    vi.resetModules();
    const transaction = {
      error: null,
      oncomplete: null as (() => void) | null,
      onerror: null as (() => void) | null,
      onabort: null as (() => void) | null,
      objectStore: () => ({ getAll: () => ({}) }),
      abort() { this.onabort?.(); }
    };
    const database = {
      objectStoreNames: { contains: () => true },
      onversionchange: null as (() => void) | null,
      close: () => undefined,
      transaction: () => transaction
    };
    const openRequest = {
      result: database,
      error: null,
      onerror: null as (() => void) | null,
      onblocked: null as (() => void) | null,
      onsuccess: null as (() => void) | null,
      onupgradeneeded: null as (() => void) | null
    };
    vi.stubGlobal('indexedDB', {
      open: () => {
        globalThis.setTimeout(() => openRequest.onsuccess?.(), 0);
        return openRequest;
      }
    });
    const freshStorage = await import('./storage');
    const started = Date.now();
    await expect(freshStorage.getHistory()).resolves.toEqual([]);
    expect(Date.now() - started).toBeLessThan(2_500);
  }, 3_500);

  it('keeps history delete and clear tombstones authoritative after failed IDB mutations and reloads', async () => {
    const state = fakeState();
    vi.stubGlobal('indexedDB', fakeIndexedDb(state));
    vi.resetModules();
    let repository = await import('./storage');
    const first = buildManualResult({ ...manual, productName: 'Erstes Ergebnis' });
    const second = buildManualResult({ ...manual, productName: 'Zweites Ergebnis' });
    await repository.saveResult(first);
    await repository.saveResult(second);
    expect(state.stores.get('history')?.size).toBe(2);

    state.failMutations = true;
    await repository.deleteResult(first.id);
    expect(state.stores.get('history')?.has(first.id)).toBe(true);
    vi.resetModules();
    repository = await import('./storage');
    await expect(repository.getHistory()).resolves.toEqual([
      expect.objectContaining({ id: second.id })
    ]);

    await repository.clearHistory();
    expect(state.stores.get('history')?.size).toBe(2);
    vi.resetModules();
    repository = await import('./storage');
    await expect(repository.getHistory()).resolves.toEqual([]);
  });

  it('keeps calibration delete and clear tombstones authoritative after failed IDB mutations and reloads', async () => {
    const state = fakeState();
    vi.stubGlobal('indexedDB', fakeIndexedDb(state));
    vi.resetModules();
    let repository = await import('./storage');
    const first = createPieceCalibration({
      productName: 'Riegel A', unit: 'bar', measuredCount: 2, measuredTotalWeightG: 40
    });
    const second = createPieceCalibration({
      productName: 'Riegel B', unit: 'bar', measuredCount: 2, measuredTotalWeightG: 44
    });
    if (!first || !second) throw new Error('Testkalibrierung ungültig.');
    await repository.saveCalibration(first);
    await repository.saveCalibration(second);
    expect(state.stores.get('calibrations')?.size).toBe(2);

    state.failMutations = true;
    await repository.deleteCalibration(first.calibrationId);
    vi.resetModules();
    repository = await import('./storage');
    await expect(repository.getCalibrations()).resolves.toEqual([
      expect.objectContaining({ calibrationId: second.calibrationId })
    ]);

    await repository.clearCalibrations();
    expect(state.stores.get('calibrations')?.size).toBe(2);
    vi.resetModules();
    repository = await import('./storage');
    await expect(repository.getCalibrations()).resolves.toEqual([]);
  });

  it('reads the API cache in memory, IndexedDB, localStorage order and isolates a corrupt IDB record', async () => {
    const state = fakeState();
    vi.stubGlobal('indexedDB', fakeIndexedDb(state));
    vi.resetModules();
    let repository = await import('./storage');
    const now = Date.now();
    const key = 'kh-v3:gateway:search:v1:test:10:reis';
    const entry = {
      key,
      value: {
        response: {
          hits: [],
          api_meta: {
            cacheStatus: 'network' as const,
            fetchedAt: new Date(now).toISOString(),
            sourceUrl: 'index://snapshot',
            backend: 'gateway' as const,
            originBackend: 'search-index' as const,
            networkAttempted: true
          },
          source: 'none' as const,
          gateway_attempts: [],
          query_used: 'Reis'
        },
        sourceUrl: 'index://snapshot'
      },
      storedAt: now,
      expiresAt: now + 60_000,
      staleUntil: now + 120_000
    };
    await repository.putApiCache(entry);
    await vi.waitFor(() => expect(state.stores.get('api-cache')?.has(key)).toBe(true));
    await expect(repository.getApiCache(key)).resolves.toMatchObject({ readLayer: 'browser-memory' });

    vi.resetModules();
    repository = await import('./storage');
    await expect(repository.getApiCache(key)).resolves.toMatchObject({ readLayer: 'browser-indexeddb' });

    state.failMutations = true;
    await repository.putApiCache({
      ...entry,
      value: {
        ...entry.value,
        response: { ...entry.value.response, query_used: 'Neuer lokaler Stand' }
      },
      storedAt: now + 1,
      expiresAt: now + 60_001,
      staleUntil: now + 120_001
    });
    vi.resetModules();
    repository = await import('./storage');
    await expect(repository.getApiCache<{ response: { query_used: string } }>(key)).resolves.toMatchObject({
      readLayer: 'browser-localstorage',
      value: { response: { query_used: 'Neuer lokaler Stand' } }
    });

    state.stores.get('api-cache')?.set(key, {
      key,
      value: { response: { corrupt: true }, sourceUrl: 'corrupt://record' },
      storedAt: now,
      expiresAt: now + 60_000,
      staleUntil: now + 120_000,
      repositoryStoredAt: now
    });
    vi.resetModules();
    repository = await import('./storage');
    await expect(repository.getApiCache(key)).resolves.toMatchObject({ readLayer: 'browser-localstorage' });
  });

  it('prevents an IDB-resident API response from returning after clear failure and reload', async () => {
    const state = fakeState();
    vi.stubGlobal('indexedDB', fakeIndexedDb(state));
    vi.resetModules();
    let repository = await import('./storage');
    const now = Date.now();
    const key = 'kh-v3:gateway:search:v1:test:10:clear';
    await repository.putApiCache({
      key,
      value: {
        response: {
          hits: [],
          api_meta: { cacheStatus: 'network', fetchedAt: new Date(now).toISOString(), sourceUrl: 'index://snapshot' },
          source: 'none', gateway_attempts: [], query_used: 'Clear'
        },
        sourceUrl: 'index://snapshot'
      },
      storedAt: now,
      expiresAt: now + 60_000,
      staleUntil: now + 120_000
    });
    await vi.waitFor(() => expect(state.stores.get('api-cache')?.has(key)).toBe(true));
    state.failMutations = true;
    await repository.clearApiCache();
    expect(state.stores.get('api-cache')?.has(key)).toBe(true);
    vi.resetModules();
    repository = await import('./storage');
    await expect(repository.getApiCache(key)).resolves.toBeNull();
  });

  it('isolates one corrupt history record without hiding a valid neighbour after reload', async () => {
    vi.resetModules();
    const repository = await import('./storage');
    const valid = buildManualResult(manual);
    await repository.saveResult(valid);
    const envelope = JSON.parse(localStorage.getItem('kh-checker-history-v3') ?? '{}') as {
      value?: unknown[];
    };
    envelope.value?.push({ id: 'corrupt', createdAt: 'not-a-date' });
    localStorage.setItem('kh-checker-history-v3', JSON.stringify(envelope));
    vi.resetModules();
    await expect((await import('./storage')).getHistory()).resolves.toEqual([
      expect.objectContaining({ id: valid.id })
    ]);
  });

  it('honours clear epochs written by another tab even when all three repositories are warm in memory', async () => {
    vi.resetModules();
    const repository = await import('./storage');
    const result = buildManualResult(manual);
    const calibration = createPieceCalibration({
      productName: 'Tab-Riegel', unit: 'bar', measuredCount: 2, measuredTotalWeightG: 40
    });
    if (!calibration) throw new Error('Testkalibrierung ungültig.');
    const now = Date.now();
    const cacheKey = 'kh-v3:gateway:search:v1:test:10:tabs';
    await repository.saveResult(result);
    await repository.saveCalibration(calibration);
    await repository.putApiCache({
      key: cacheKey,
      value: {
        response: {
          hits: [],
          api_meta: { cacheStatus: 'network', fetchedAt: new Date(now).toISOString(), sourceUrl: 'index://tabs' },
          source: 'none', gateway_attempts: [], query_used: 'Tabs'
        },
        sourceUrl: 'index://tabs'
      },
      storedAt: now,
      expiresAt: now + 60_000,
      staleUntil: now + 120_000
    });
    expect(await repository.getHistory()).toHaveLength(1);
    expect(await repository.getCalibrations()).toHaveLength(1);
    expect(await repository.getApiCache(cacheKey)).not.toBeNull();

    const externalClear = JSON.stringify({
      schemaVersion: 3,
      value: { clearEpoch: Date.now() + 10_000, deletedIds: {} }
    });
    localStorage.setItem('kh-checker-history-deletions-v3', externalClear);
    localStorage.setItem('kh-checker-calibration-deletions-v3', externalClear);
    localStorage.setItem('kh-checker-api-cache-deletions-v3', externalClear);

    await expect(repository.getHistory()).resolves.toEqual([]);
    await expect(repository.getCalibrations()).resolves.toEqual([]);
    await expect(repository.getApiCache(cacheKey)).resolves.toBeNull();
  });

  it('bounds IndexedDB history while reserving retention space for favorites', async () => {
    const state = fakeState();
    const base = buildManualResult(manual);
    const history = new Map<string, unknown>();
    for (let index = 0; index < 520; index += 1) {
      const id = `history-${index}`;
      history.set(id, {
        ...base,
        id,
        createdAt: new Date(Date.UTC(2025, 0, 1, 0, 0, index)).toISOString(),
        favorite: index < 260,
        repositoryStoredAt: Date.now() + 10_000 + index
      });
    }
    state.stores.set('history', history);
    vi.stubGlobal('indexedDB', fakeIndexedDb(state));
    vi.resetModules();
    const repository = await import('./storage');
    const retained = await repository.getHistory();
    expect(retained).toHaveLength(500);
    expect(retained.filter((record) => record.favorite)).toHaveLength(250);
    expect(state.stores.get('history')?.size).toBe(500);
  });

  it('hard-caps calibration retention by most recent update', async () => {
    const state = fakeState();
    const base = createPieceCalibration({
      productName: 'Retention-Riegel', unit: 'bar', measuredCount: 2, measuredTotalWeightG: 40
    });
    if (!base) throw new Error('Testkalibrierung ungültig.');
    const calibrations = new Map<string, unknown>();
    for (let index = 0; index < 510; index += 1) {
      const calibrationId = `calibration-${index}`;
      const updatedAt = new Date(Date.UTC(2025, 0, 1, 0, 0, index)).toISOString();
      calibrations.set(calibrationId, {
        key: calibrationId,
        value: { ...base, calibrationId, createdAt: updatedAt, updatedAt },
        repositoryStoredAt: index + 1
      });
    }
    state.stores.set('calibrations', calibrations);
    vi.stubGlobal('indexedDB', fakeIndexedDb(state));
    vi.resetModules();
    const repository = await import('./storage');
    const retained = await repository.getCalibrations();
    expect(retained).toHaveLength(500);
    expect(retained.some((record) => record.calibrationId === 'calibration-0')).toBe(false);
    expect(state.stores.get('calibrations')?.size).toBe(500);
  });

  it('caps the durable API cache instead of growing until browser-origin eviction', async () => {
    const state = fakeState();
    const now = Date.now();
    const cache = new Map<string, unknown>();
    for (let index = 0; index < 330; index += 1) {
      const key = `fixture-cache-${index}`;
      cache.set(key, {
        key, value: { index }, storedAt: now + index,
        expiresAt: now + 60_000, staleUntil: now + 120_000,
        repositoryStoredAt: now + index
      });
    }
    state.stores.set('api-cache', cache);
    vi.stubGlobal('indexedDB', fakeIndexedDb(state));
    vi.resetModules();
    const repository = await import('./storage');
    await repository.putApiCache({
      key: 'fixture-cache-new', value: { newest: true }, storedAt: now + 1_000,
      expiresAt: now + 61_000, staleUntil: now + 121_000
    });
    await vi.waitFor(() => expect(state.stores.get('api-cache')?.size).toBe(320));
    expect(state.stores.get('api-cache')?.has('fixture-cache-new')).toBe(true);
    expect(state.stores.get('api-cache')?.has('fixture-cache-0')).toBe(false);
    expect((await repository.getApiCacheStats()).entries).toBe(320);
  });
});
