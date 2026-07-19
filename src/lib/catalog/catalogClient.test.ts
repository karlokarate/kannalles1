import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CatalogStatus } from './catalogDomain';
import type { CatalogWorkerRequest, CatalogWorkerResponse } from './catalogProtocol';

const ready: CatalogStatus = {
  state: 'ready',
  activeSlot: 'a',
  rollbackSlot: null,
  slotStates: { a: 'active', b: 'empty' },
  catalogVersion: 'production-v1',
  productCount: 317_519,
  persistent: true,
  progress: null,
  diagnostics: null,
  retryAllowedImmediately: true
};

const product = {
  productId: 1,
  code: '4008400322728',
  displayName: 'SQLite first',
  brand: 'Kinder',
  nutrition: { carbohydratesPer100: 49.5, basis: 'mass' as const, source: 'as_sold' as const },
  unitEvidence: {
    manufacturerServing: null,
    productQuantity: null,
    provenSmallestUnit: null,
    defaultUnitKind: 'mass' as const
  },
  imageReference: null,
  hasQualityErrors: false,
  rankOrdinal: 1
};

class FakeWorker extends EventTarget {
  static instances: FakeWorker[] = [];
  readonly requests: CatalogWorkerRequest[] = [];

  constructor() {
    super();
    FakeWorker.instances.push(this);
  }

  postMessage(request: CatalogWorkerRequest): void {
    this.requests.push(request);
    queueMicrotask(() => {
      let response: CatalogWorkerResponse;
      if (request.type === 'initialize' || request.type === 'retry' || request.type === 'status') {
        response = { ok: true, id: request.id, type: 'status', result: ready };
      } else if (request.type === 'search') {
        response = {
          ok: true,
          id: request.id,
          type: 'search',
          result: [
            { ...product, resultIndex: 0 },
            { ...product, productId: 2, displayName: 'SQLite second', rankOrdinal: 2, resultIndex: 1 }
          ]
        };
      } else {
        response = { ok: true, id: request.id, type: 'product', result: product };
      }
      this.dispatchEvent(new MessageEvent('message', { data: response }));
    });
  }

  terminate(): void {}
}

beforeEach(() => {
  vi.resetModules();
  FakeWorker.instances = [];
  vi.stubGlobal('Worker', FakeWorker);
  vi.stubGlobal('document', { baseURI: 'https://example.test/app/' });
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

  it('forwards the page offset and requests one non-rendered lookahead after twenty visible results', async () => {
    const client = await import('./catalogClient');
    await client.searchOfflineCatalog('reis', 99, undefined, 40);
    expect(FakeWorker.instances[0].requests.at(-1)).toMatchObject({
      type: 'search',
      query: 'reis',
      limit: 21,
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
