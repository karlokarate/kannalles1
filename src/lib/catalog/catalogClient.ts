import type { CatalogProduct, CatalogSearchHit } from './catalogDomain';
import { CatalogFailure } from './catalogErrors';
import type {
  CatalogStatusEnvelope,
  CatalogWorkerFailure,
  CatalogWorkerRequest,
  CatalogWorkerResponse
} from './catalogProtocol';

type RequestByType<Type extends CatalogWorkerRequest['type']> = Extract<CatalogWorkerRequest, { type: Type }>;
type RequestPayload<Type extends CatalogWorkerRequest['type']> = Omit<RequestByType<Type>, 'requestId'>;
type CatalogStatusListener = (status: CatalogStatusEnvelope) => void;

interface WorkerLike {
  postMessage(message: CatalogWorkerRequest): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<CatalogWorkerResponse>) => void): void;
  addEventListener(type: 'error', listener: (event: ErrorEvent) => void): void;
  terminate(): void;
}

interface PendingRequest {
  readonly resolve: (value: unknown) => void;
  readonly reject: (reason?: unknown) => void;
}

export interface CatalogClientOptions {
  readonly createWorker?: () => WorkerLike;
  readonly requestId?: () => string;
}

function defaultCreateWorker(): WorkerLike {
  return new Worker(new URL('./catalog.worker.ts', import.meta.url), {
    type: 'module',
    name: 'kh-checker-offline-catalog'
  });
}

let fallbackRequestCounter = 0;
function defaultRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  fallbackRequestCounter += 1;
  return `catalog-${Date.now()}-${fallbackRequestCounter}`;
}

function reviveFailure(response: CatalogWorkerFailure): CatalogFailure {
  const diagnostics = response.error.diagnostics;
  return new CatalogFailure(response.error.code, response.error.message, {
    operation: diagnostics.operation,
    technical: diagnostics.technical,
    activeSlot: diagnostics.activeSlot,
    attemptedSlot: diagnostics.attemptedSlot,
    catalogVersion: diagnostics.catalogVersion,
    details: diagnostics.details,
    occurredAt: diagnostics.occurredAt
  });
}

function cancelled(operation: 'initialize' | 'search' | 'product_lookup'): CatalogFailure {
  return new CatalogFailure('CATALOG_CANCELLED', 'Die lokale Kataloganfrage wurde abgebrochen.', { operation });
}

function withAbort<T>(promise: Promise<T>, signal: AbortSignal | undefined, operation: 'search' | 'product_lookup'): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(cancelled(operation));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(cancelled(operation));
    signal.addEventListener('abort', onAbort, { once: true });
    void promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}

export class CatalogClient {
  private readonly createWorker: () => WorkerLike;
  private readonly nextRequestId: () => string;
  private worker: WorkerLike | null = null;
  private initialization: Promise<CatalogStatusEnvelope> | null = null;
  private readonly pending = new Map<string, PendingRequest>();
  private readonly searches = new Map<string, Promise<readonly CatalogSearchHit[]>>();
  private readonly listeners = new Set<CatalogStatusListener>();
  private latestStatus: CatalogStatusEnvelope | null = null;

  constructor(options: CatalogClientOptions = {}) {
    this.createWorker = options.createWorker ?? defaultCreateWorker;
    this.nextRequestId = options.requestId ?? defaultRequestId;
  }

  private ensureWorker(): WorkerLike {
    if (this.worker) return this.worker;
    const worker = this.createWorker();
    worker.addEventListener('message', (event) => this.handleMessage(event.data));
    worker.addEventListener('error', (event) => {
      const failure = new CatalogFailure('CATALOG_UNKNOWN', 'Der lokale Katalogworker ist unerwartet ausgefallen.', {
        operation: 'initialize',
        technical: event.message || 'Worker error'
      });
      this.rejectAll(failure);
      worker.terminate();
      if (this.worker === worker) this.worker = null;
      this.initialization = null;
      this.searches.clear();
    });
    this.worker = worker;
    return worker;
  }

  private handleMessage(response: CatalogWorkerResponse): void {
    if (response.ok && response.type === 'status-event') {
      this.publishStatus(response.result);
      return;
    }
    const request = this.pending.get(response.requestId);
    if (!request) return;
    this.pending.delete(response.requestId);
    if (!response.ok) {
      request.reject(reviveFailure(response));
      return;
    }
    if (response.type === 'status') this.publishStatus(response.result);
    request.resolve(response.result);
  }

  private publishStatus(status: CatalogStatusEnvelope): void {
    this.latestStatus = status;
    for (const listener of this.listeners) listener(status);
  }

  private rejectAll(reason: unknown): void {
    for (const request of this.pending.values()) request.reject(reason);
    this.pending.clear();
  }

  private post<Type extends CatalogWorkerRequest['type'], Result>(payload: RequestPayload<Type>): Promise<Result> {
    const requestId = this.nextRequestId();
    const request = { ...payload, requestId } as RequestByType<Type>;
    return new Promise<Result>((resolve, reject) => {
      this.pending.set(requestId, {
        resolve: (value) => resolve(value as Result),
        reject
      });
      try {
        this.ensureWorker().postMessage(request);
      } catch (error) {
        this.pending.delete(requestId);
        reject(error);
      }
    });
  }

  initialize(): Promise<CatalogStatusEnvelope> {
    if (this.latestStatus?.status.state === 'ready') return Promise.resolve(this.latestStatus);
    this.initialization ??= this.post<'initialize', CatalogStatusEnvelope>({ type: 'initialize' })
      .catch((error) => {
        this.initialization = null;
        throw error;
      });
    return this.initialization;
  }

  retryUpdate(): Promise<CatalogStatusEnvelope> {
    const retry = this.post<'retry-update', CatalogStatusEnvelope>({ type: 'retry-update' });
    this.initialization = retry.catch((error) => {
      this.initialization = null;
      throw error;
    });
    return this.initialization;
  }

  status(): Promise<CatalogStatusEnvelope> {
    return this.post<'status', CatalogStatusEnvelope>({ type: 'status' });
  }

  async search(query: string, limit = 20, signal?: AbortSignal): Promise<readonly CatalogSearchHit[]> {
    await this.initialize();
    const canonical = query.normalize('NFKC').trim();
    const normalizedLimit = Math.max(1, Math.min(20, Math.trunc(limit) || 20));
    const key = `${canonical.toLocaleLowerCase('de-DE')}\u0000${normalizedLimit}`;
    let shared = this.searches.get(key);
    if (!shared) {
      shared = this.post<'search', readonly CatalogSearchHit[]>({
        type: 'search',
        query: canonical,
        limit: normalizedLimit
      });
      this.searches.set(key, shared);
      void shared.finally(() => {
        if (this.searches.get(key) === shared) this.searches.delete(key);
      }).catch(() => undefined);
    }
    return withAbort(shared, signal, 'search');
  }

  async product(code: string, signal?: AbortSignal): Promise<CatalogProduct | null> {
    await this.initialize();
    const request = this.post<'product', CatalogProduct | null>({ type: 'product', code });
    return withAbort(request, signal, 'product_lookup');
  }

  subscribe(listener: CatalogStatusListener): () => void {
    this.listeners.add(listener);
    if (this.latestStatus) listener(this.latestStatus);
    else void this.status().catch(() => undefined);
    return () => this.listeners.delete(listener);
  }

  terminate(): void {
    const failure = cancelled('initialize');
    this.rejectAll(failure);
    this.searches.clear();
    this.worker?.terminate();
    this.worker = null;
    this.initialization = null;
    this.latestStatus = null;
  }
}

const defaultClient = new CatalogClient();

export function initializeOfflineCatalog(): Promise<CatalogStatusEnvelope> {
  return defaultClient.initialize();
}

export function retryOfflineCatalogUpdate(): Promise<CatalogStatusEnvelope> {
  return defaultClient.retryUpdate();
}

export function getOfflineCatalogStatus(): Promise<CatalogStatusEnvelope> {
  return defaultClient.status();
}

export function searchOfflineCatalog(
  query: string,
  limit = 20,
  signal?: AbortSignal
): Promise<readonly CatalogSearchHit[]> {
  return defaultClient.search(query, limit, signal);
}

export function getOfflineCatalogProduct(
  code: string,
  signal?: AbortSignal
): Promise<CatalogProduct | null> {
  return defaultClient.product(code, signal);
}

export function subscribeOfflineCatalogStatus(listener: CatalogStatusListener): () => void {
  return defaultClient.subscribe(listener);
}

export function disposeOfflineCatalog(): void {
  defaultClient.terminate();
}

if (typeof document !== 'undefined') {
  void initializeOfflineCatalog().catch(() => undefined);
}
