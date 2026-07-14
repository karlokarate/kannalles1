import { manualCatalogProductByCode, searchManualCatalog } from '../manualCatalog';
import type { CatalogProduct, CatalogSearchHit, CatalogStatus } from './catalogDomain';
import { CatalogFailure } from './catalogErrors';
import type { CatalogWorkerRequest, CatalogWorkerResponse } from './catalogProtocol';

type RequestWithoutId = CatalogWorkerRequest extends infer Request
  ? Request extends { id: number }
    ? Omit<Request, 'id'>
    : never
  : never;

interface PendingRequest {
  readonly resolve: (value: unknown) => void;
  readonly reject: (reason?: unknown) => void;
  readonly signal?: AbortSignal;
  abort?: () => void;
}

type CatalogStatusListener = (status: CatalogStatus) => void;

let worker: Worker | null = null;
let nextRequestId = 1;
let initialization: Promise<CatalogStatus> | null = null;
const pending = new Map<number, PendingRequest>();
const statusListeners = new Set<CatalogStatusListener>();

function abortFailure(): CatalogFailure {
  return new CatalogFailure('CATALOG_CANCELLED', 'Die lokale Kataloganfrage wurde abgebrochen.', {
    operation: 'search'
  });
}

function rejectAll(reason: unknown): void {
  for (const request of pending.values()) {
    if (request.abort && request.signal) request.signal.removeEventListener('abort', request.abort);
    request.reject(reason);
  }
  pending.clear();
}

function notifyStatus(status: CatalogStatus): void {
  for (const listener of statusListeners) listener(status);
}

function reviveFailure(response: Extract<CatalogWorkerResponse, { ok: false }>): CatalogFailure {
  const diagnostics = response.error.diagnostics;
  return new CatalogFailure(response.error.code, response.error.message, {
    operation: diagnostics.operation,
    technical: diagnostics.technical,
    activeSlot: diagnostics.activeSlot,
    attemptedSlot: diagnostics.attemptedSlot,
    rollbackSlot: diagnostics.rollbackSlot,
    catalogVersion: diagnostics.catalogVersion,
    details: diagnostics.details,
    occurredAt: diagnostics.occurredAt
  });
}

function ensureWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('./catalog.worker.ts', import.meta.url), {
    type: 'module',
    name: 'kh-checker-offline-catalog'
  });
  worker.addEventListener('message', (event: MessageEvent<CatalogWorkerResponse>) => {
    const response = event.data;
    if (response.ok && response.type === 'status-event') {
      notifyStatus(response.result);
      return;
    }
    const request = pending.get(response.id);
    if (!request) return;
    pending.delete(response.id);
    if (request.abort && request.signal) request.signal.removeEventListener('abort', request.abort);
    if (response.ok) {
      if (response.type === 'status') notifyStatus(response.result);
      request.resolve(response.result);
    } else {
      request.reject(reviveFailure(response));
    }
  });
  worker.addEventListener('error', (event) => {
    const failure = new CatalogFailure('CATALOG_UNKNOWN', 'Der lokale Katalogworker ist unerwartet ausgefallen.', {
      operation: 'initialize',
      technical: event.message || 'Worker error'
    });
    rejectAll(failure);
    worker?.terminate();
    worker = null;
    initialization = null;
  });
  return worker;
}

function post<T>(request: RequestWithoutId, signal?: AbortSignal): Promise<T> {
  if (signal?.aborted) return Promise.reject(abortFailure());
  const id = nextRequestId++;
  return new Promise<T>((resolve, reject) => {
    const entry: PendingRequest = {
      resolve: (value) => resolve(value as T),
      reject,
      signal
    };
    if (signal) {
      entry.abort = () => {
        if (!pending.delete(id)) return;
        reject(abortFailure());
      };
      signal.addEventListener('abort', entry.abort, { once: true });
    }
    pending.set(id, entry);
    ensureWorker().postMessage({ ...request, id } satisfies CatalogWorkerRequest);
  });
}

function runtimeConfig(): {
  sqliteModuleUrl: string;
  manifestUrl: string;
  catalogBaseUrl: string;
} {
  const base = new URL('./', document.baseURI);
  return {
    sqliteModuleUrl: new URL('vendor/sqlite/index.mjs', base).href,
    manifestUrl: new URL('catalog/manifest.json', base).href,
    catalogBaseUrl: new URL('catalog/', base).href
  };
}

export function initializeOfflineCatalog(): Promise<CatalogStatus> {
  initialization ??= post<CatalogStatus>({ type: 'initialize', ...runtimeConfig() }).catch((error) => {
    initialization = null;
    throw error;
  });
  return initialization;
}

export function retryOfflineCatalog(): Promise<CatalogStatus> {
  initialization = post<CatalogStatus>({ type: 'retry', ...runtimeConfig() }).catch((error) => {
    initialization = null;
    throw error;
  });
  return initialization;
}

export function getOfflineCatalogStatus(): Promise<CatalogStatus> {
  return post<CatalogStatus>({ type: 'status' });
}

export async function searchOfflineCatalog(
  query: string,
  limit = 20,
  signal?: AbortSignal,
  offset = 0
): Promise<readonly CatalogSearchHit[]> {
  await initializeOfflineCatalog();
  if (signal?.aborted) throw abortFailure();
  const normalizedLimit = Math.max(1, Math.min(20, Math.trunc(limit)));
  const normalizedOffset = Math.max(0, Math.trunc(offset));
  const manualHits = searchManualCatalog(query);
  const manualPage = manualHits.slice(normalizedOffset, normalizedOffset + normalizedLimit);
  const remaining = normalizedLimit - manualPage.length;
  const sqliteOffset = Math.max(0, normalizedOffset - manualHits.length);
  const sqliteHits = remaining > 0
    ? await post<readonly CatalogSearchHit[]>({
        type: 'search',
        query,
        limit: remaining,
        offset: sqliteOffset
      }, signal)
    : [];
  return [...manualPage, ...sqliteHits].map((hit, resultIndex) => ({ ...hit, resultIndex }));
}

export async function getOfflineCatalogProduct(
  barcode: string,
  signal?: AbortSignal
): Promise<CatalogProduct | null> {
  const manual = manualCatalogProductByCode(barcode);
  if (manual) return manual;
  await initializeOfflineCatalog();
  if (signal?.aborted) throw abortFailure();
  return post<CatalogProduct | null>({ type: 'product', barcode }, signal);
}

export function subscribeOfflineCatalogStatus(listener: CatalogStatusListener): () => void {
  statusListeners.add(listener);
  void getOfflineCatalogStatus().then(listener).catch(() => undefined);
  return () => statusListeners.delete(listener);
}

export function disposeOfflineCatalog(): void {
  const failure = new CatalogFailure('CATALOG_CANCELLED', 'Der lokale Katalogworker wurde beendet.', {
    operation: 'initialize'
  });
  rejectAll(failure);
  worker?.terminate();
  worker = null;
  initialization = null;
}

/** Cancels all in-flight requests without discarding the verified worker runtime. */
export function cancelOfflineCatalogRequests(): void {
  rejectAll(abortFailure());
  initialization = null;
}

if (typeof document !== 'undefined') {
  void initializeOfflineCatalog().catch(() => undefined);
}
