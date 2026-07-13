import { describe, expect, it } from 'vitest';
import { CatalogClient } from './catalogClient';
import type {
  CatalogStatusEnvelope,
  CatalogWorkerRequest,
  CatalogWorkerResponse
} from './catalogProtocol';

const READY: CatalogStatusEnvelope = {
  status: {
    state: 'ready',
    activeSlot: 'a',
    catalogVersion: '2026-07-13',
    productCount: 317579,
    progress: null,
    diagnostics: null,
    retryAllowedImmediately: true
  },
  runtime: {
    persistent: true,
    installedFromNetwork: false,
    rollbackAvailable: false,
    activeSlotFile: 'catalog-a.sqlite'
  }
};

class FakeWorker {
  readonly messages: CatalogWorkerRequest[] = [];
  terminated = false;
  private readonly messageListeners: Array<(event: MessageEvent<CatalogWorkerResponse>) => void> = [];
  private readonly errorListeners: Array<(event: ErrorEvent) => void> = [];

  postMessage(message: CatalogWorkerRequest): void {
    this.messages.push(message);
  }

  addEventListener(type: 'message' | 'error', listener: ((event: MessageEvent<CatalogWorkerResponse>) => void) | ((event: ErrorEvent) => void)): void {
    if (type === 'message') this.messageListeners.push(listener as (event: MessageEvent<CatalogWorkerResponse>) => void);
    else this.errorListeners.push(listener as (event: ErrorEvent) => void);
  }

  respond(response: CatalogWorkerResponse): void {
    for (const listener of this.messageListeners) listener({ data: response } as MessageEvent<CatalogWorkerResponse>);
  }

  terminate(): void {
    this.terminated = true;
  }
}

function clientWith(worker: FakeWorker): CatalogClient {
  let id = 0;
  return new CatalogClient({
    createWorker: () => worker,
    requestId: () => `request-${++id}`
  });
}

describe('FORGE-220 catalog client transport', () => {
  it('deduplicates initialization and identical in-flight searches', async () => {
    const worker = new FakeWorker();
    const client = clientWith(worker);
    const initA = client.initialize();
    const initB = client.initialize();
    expect(initA).toBe(initB);
    expect(worker.messages).toHaveLength(1);
    expect(worker.messages[0]).toEqual({ type: 'initialize', requestId: 'request-1' });
    worker.respond({ requestId: 'request-1', ok: true, type: 'status', result: READY });
    await Promise.all([initA, initB]);

    const searchA = client.search(' Kinder Bueno ', 20);
    const searchB = client.search('kinder bueno', 20);
    await Promise.resolve();
    await Promise.resolve();
    const searchRequests = worker.messages.filter((message) => message.type === 'search');
    expect(searchRequests).toHaveLength(1);
    const requestId = searchRequests[0].requestId;
    worker.respond({ requestId, ok: true, type: 'search', result: [] });
    await expect(Promise.all([searchA, searchB])).resolves.toEqual([[], []]);
  });

  it('publishes status events and sends immediate retry-update without cooldown state', async () => {
    const worker = new FakeWorker();
    const client = clientWith(worker);
    const seen: CatalogStatusEnvelope[] = [];
    const unsubscribe = client.subscribe((status) => seen.push(status));
    const statusRequest = worker.messages.find((message) => message.type === 'status');
    expect(statusRequest).toBeDefined();
    worker.respond({ requestId: 'status-event', ok: true, type: 'status-event', result: READY });
    expect(seen).toEqual([READY]);

    const retry = client.retryUpdate();
    const retryRequest = worker.messages.find((message) => message.type === 'retry-update');
    expect(retryRequest).toBeDefined();
    worker.respond({ requestId: retryRequest!.requestId, ok: true, type: 'status', result: READY });
    await expect(retry).resolves.toEqual(READY);
    unsubscribe();
  });

  it('terminates its single worker and rejects pending requests with CatalogFailure', async () => {
    const worker = new FakeWorker();
    const client = clientWith(worker);
    const pending = client.status();
    client.terminate();
    await expect(pending).rejects.toMatchObject({ code: 'CATALOG_CANCELLED' });
    expect(worker.terminated).toBe(true);
  });
});
