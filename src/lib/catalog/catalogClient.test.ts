import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CatalogProduct, CatalogSearchHit, CatalogStatus } from './catalogDomain';
import type { CatalogWorkerRequest, CatalogWorkerResponse } from './catalogProtocol';

const ready: CatalogStatus = {
  state: 'ready',
  activeSlot: 'a',
  rollbackSlot: null,
  slotStates: { a: 'active', b: 'empty' },
  catalogVersion: '2026-07-13',
  productCount: 317579,
  persistent: true,
  progress: 1,
  diagnostics: null,
  retryAllowedImmediately: true
};

const product: CatalogProduct = {
  productId: 1,
  code: '3017620422003',
  displayName: 'Kinder Bueno',
  brand: 'Ferrero',
  nutrition: { carbohydratesPer100: 49, basis: 'mass', source: 'as_sold' },
  unitEvidence: {
    manufacturerServing: null,
    productQuantity: null,
    provenSmallestUnit: null,
    defaultUnitKind: 'mass'
  },
  imageReference: null,
  hasQualityErrors: false,
  rankOrdinal: 1
};

class FakeWorker extends EventTarget {
  static instances: FakeWorker[] = [];
  readonly requests: CatalogWorkerRequest[] = [];
  terminated = false;

  constructor(_url: URL, _options: WorkerOptions) {
    super();
    FakeWorker.instances.push(this);
  }

  postMessage(request: CatalogWorkerRequest): void {
    this.requests.push(request);
    queueMicrotask(() => {
      let response: CatalogWorkerResponse;
      if (request.type === 'initialize' || request.type === 'retry' || request.type === 'status') {
        response = { id: request.id, ok: true, type: 'status', result: ready };
      } else if (request.type === 'search') {
        const hits: CatalogSearchHit[] = [
          { ...product, displayName: 'SQLite first', resultIndex: 0 },
          { ...product, displayName: 'SQLite second', resultIndex: 1 }
        ];
        response = { id: request.id, ok: true, type: 'search', result: hits };
      } else {
        response = { id: request.id, ok: true, type: 'product', result: product };
      }
      this.dispatchEvent(new MessageEvent('message', { data: response }));
    });
  }

  terminate(): void {
    this.terminated = true;
  }
}

beforeEach(() => {
  FakeWorker.instances = [];
  vi.stubGlobal('Worker', FakeWorker);
  vi.stubGlobal('document', { baseURI: 'https://example.test/app/' });
});

afterEach(async () => {
  const client = await import('./catalogClient');
  client.disposeOfflineCatalog();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('A/B catalog client protocol', () => {
  it('initializes one worker with manifest and catalog base URLs, never a renamed database URL', async () => {
    const client = await import('./catalogClient');
    const status = await client.initializeOfflineCatalog();
    expect(status).toEqual(ready);
    const request = FakeWorker.instances[0].requests[0];
    expect(request).toMatchObject({
      type: 'initialize',
      manifestUrl: 'https://example.test/app/catalog/manifest.json',
      catalogBaseUrl: 'https://example.test/app/catalog/'
    });
    expect(request).not.toHaveProperty('catalogUrl');
  });

  it('returns worker search hits in their existing SQLite order', async () => {
    const client = await import('./catalogClient');
    const hits = await client.searchOfflineCatalog('kinder bueno');
    expect(hits.map((hit) => [hit.displayName, hit.resultIndex])).toEqual([
      ['SQLite first', 0],
      ['SQLite second', 1]
    ]);
  });

  it('forwards a pagination offset while capping each page at 20 results', async () => {
    const client = await import('./catalogClient');
    await client.searchOfflineCatalog('reis', 99, undefined, 40);
    expect(FakeWorker.instances[0].requests.at(-1)).toMatchObject({
      type: 'search',
      query: 'reis',
      limit: 20,
      offset: 40
    });
  });

  it('exposes immediate retry and Atlas CatalogStatus without inventing a second status model', async () => {
    const client = await import('./catalogClient');
    await client.initializeOfflineCatalog();
    const status = await client.retryOfflineCatalog();
    expect(status.retryAllowedImmediately).toBe(true);
    expect(FakeWorker.instances[0].requests.at(-1)?.type).toBe('retry');
  });
});
