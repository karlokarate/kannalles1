import type {
  CatalogProductRecord,
  CatalogRuntimeStatus,
  CatalogWorkerRequest,
  CatalogWorkerResponse
} from './catalogProtocol';

type RequestWithoutId = CatalogWorkerRequest extends infer Request
  ? Request extends { id: number }
    ? Omit<Request, 'id'>
    : never
  : never;

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
  requestType: CatalogWorkerRequest['type'];
  signal?: AbortSignal;
  abort?: () => void;
}

let worker: Worker | null = null;
let nextRequestId = 1;
let initializePromise: Promise<CatalogRuntimeStatus> | null = null;
const pending = new Map<number, PendingRequest>();

function abortError(): DOMException {
  return new DOMException('Die lokale Datenbankanfrage wurde abgebrochen.', 'AbortError');
}

function rejectAll(reason: unknown): void {
  for (const request of pending.values()) {
    if (request.abort && request.signal) request.signal.removeEventListener('abort', request.abort);
    request.reject(reason);
  }
  pending.clear();
}

function ensureWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('./catalog.worker.ts', import.meta.url), {
    type: 'module',
    name: 'kh-checker-offline-catalog'
  });
  worker.addEventListener('message', (event: MessageEvent<CatalogWorkerResponse>) => {
    const response = event.data;
    const request = pending.get(response.id);
    if (!request) return;
    pending.delete(response.id);
    if (request.abort && request.signal) request.signal.removeEventListener('abort', request.abort);
    if (response.ok) request.resolve(response.result);
    else {
      const error = new Error(response.error.message);
      error.name = response.error.name;
      Object.assign(error, { code: response.error.code });
      request.reject(error);
    }
  });
  worker.addEventListener('error', (event) => {
    const error = new Error(event.message || 'Der SQLite-Worker ist unerwartet ausgefallen.');
    error.name = 'CatalogWorkerError';
    rejectAll(error);
    worker?.terminate();
    worker = null;
    initializePromise = null;
  });
  return worker;
}

function post<T>(request: RequestWithoutId, signal?: AbortSignal): Promise<T> {
  if (signal?.aborted) return Promise.reject(abortError());
  const id = nextRequestId++;
  return new Promise<T>((resolve, reject) => {
    const entry: PendingRequest = {
      resolve: (value) => resolve(value as T),
      reject,
      requestType: request.type,
      signal
    };
    if (signal) {
      entry.abort = () => {
        if (!pending.delete(id)) return;
        reject(abortError());
      };
      signal.addEventListener('abort', entry.abort, { once: true });
    }
    pending.set(id, entry);
    ensureWorker().postMessage({ ...request, id } satisfies CatalogWorkerRequest);
  });
}

function runtimeUrls(): {
  sqliteModuleUrl: string;
  manifestUrl: string;
  catalogUrl: string;
} {
  const base = new URL('./', document.baseURI);
  return {
    sqliteModuleUrl: new URL('vendor/sqlite/index.mjs', base).href,
    manifestUrl: new URL('catalog/manifest.json', base).href,
    catalogUrl: new URL('catalog/kh-checker-dach.sqlite', base).href
  };
}

export function initializeOfflineCatalog(): Promise<CatalogRuntimeStatus> {
  if (!initializePromise) {
    initializePromise = post<CatalogRuntimeStatus>({ type: 'init', ...runtimeUrls() }).catch((error) => {
      initializePromise = null;
      throw error;
    });
  }
  return initializePromise;
}

export async function searchOfflineCatalog(
  query: string,
  limit: number,
  signal?: AbortSignal
): Promise<CatalogProductRecord[]> {
  await initializeOfflineCatalog();
  if (signal?.aborted) throw abortError();
  return post<CatalogProductRecord[]>({ type: 'search', query, limit }, signal);
}

export async function getOfflineCatalogProduct(
  barcode: string,
  signal?: AbortSignal
): Promise<CatalogProductRecord | null> {
  await initializeOfflineCatalog();
  if (signal?.aborted) throw abortError();
  return post<CatalogProductRecord | null>({ type: 'product', barcode }, signal);
}

export async function getOfflineCatalogStatus(): Promise<CatalogRuntimeStatus> {
  await initializeOfflineCatalog();
  return post<CatalogRuntimeStatus>({ type: 'status' });
}

export function cancelOfflineCatalogRequests(): void {
  for (const [id, request] of pending) {
    if (request.requestType === 'init' || request.requestType === 'status') continue;
    pending.delete(id);
    if (request.abort && request.signal) request.signal.removeEventListener('abort', request.abort);
    request.reject(abortError());
  }
}

// Start installation as soon as the application module is evaluated. Search still
// awaits the same singleton promise, so no duplicate download or import can occur.
if (typeof document !== 'undefined') {
  void initializeOfflineCatalog().catch(() => undefined);
}
