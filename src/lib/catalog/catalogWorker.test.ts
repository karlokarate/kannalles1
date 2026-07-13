import { describe, expect, it } from 'vitest';
import type { CatalogDatabase } from './catalogInstaller';
import { CatalogWorkerRuntime, queryCatalogProduct, queryCatalogSearch } from './catalog.worker';
import type { CatalogWorkerResponse } from './catalogProtocol';

function packedGtin(code: string): number {
  const lengthCode = code.length === 8 ? 0 : code.length === 13 ? 1 : 2;
  return Number(code) * 4 + lengthCode + 1;
}

function productRow(code: string, name: string, rank: number): Record<string, unknown> {
  return {
    id: packedGtin(code),
    g: null,
    n: name,
    brand: 'Testbrand',
    c: 42.5,
    s: null,
    q: 100,
    u: null,
    m: 1 << 4,
    r: rank
  };
}

class QueryDatabase implements CatalogDatabase {
  constructor(private readonly orderedRows: readonly Record<string, unknown>[]) {}

  exec(input: string | {
    readonly sql: string;
    readonly bind?: readonly unknown[];
    readonly rowMode?: 'object';
    readonly callback?: (row: Record<string, unknown>) => void;
  }): unknown {
    if (typeof input === 'string') return undefined;
    if (input.sql.includes('FROM x')) {
      for (const row of this.orderedRows) input.callback?.(row);
    } else if (input.sql.includes('WHERE p.id=?')) {
      const id = Number(input.bind?.[0]);
      const row = this.orderedRows.find((candidate) => candidate.id === id);
      if (row) input.callback?.(row);
    }
    return undefined;
  }

  selectValue(): unknown {
    throw new Error('not used');
  }

  close(): void {}
}

describe('FORGE-220 worker query boundary', () => {
  it('preserves exact SQLite row order and assigns Atlas resultIndex without reranking', () => {
    const database = new QueryDatabase([
      productRow('4008400322728', 'SQLite first', 1),
      productRow('3017620422003', 'SQLite second', 999)
    ]);
    const hits = queryCatalogSearch(database, 'kinder bueno', 20);
    expect(hits.map((hit) => [hit.displayName, hit.resultIndex])).toEqual([
      ['SQLite first', 0],
      ['SQLite second', 1]
    ]);
  });

  it('projects a barcode lookup directly to Atlas CatalogProduct', () => {
    const database = new QueryDatabase([productRow('4008400322728', 'Kinder Bueno', 100)]);
    const product = queryCatalogProduct(database, '4008400322728');
    expect(product).toMatchObject({
      code: '4008400322728',
      displayName: 'Kinder Bueno',
      carbohydratesPer100: 42.5
    });
  });

  it('returns a typed failure envelope instead of raw runtime objects', async () => {
    const posted: CatalogWorkerResponse[] = [];
    const runtime = new CatalogWorkerRuntime({
      port: { postMessage: (message) => posted.push(message) },
      activationStore: {
        readActivationRecord: async () => null,
        activateValidatedSlot: async () => undefined,
        clearInactiveSlotMetadata: async () => undefined
      },
      loadSqlite: async () => { throw new Error('not used'); },
      fetch: async () => { throw new Error('not used'); },
      urls: {
        sqliteModuleUrl: 'https://app.test/vendor/sqlite/index.mjs',
        manifestUrl: 'https://app.test/catalog/manifest.json',
        catalogBaseUrl: 'https://app.test/catalog/'
      }
    });
    const response = await runtime.handle({
      type: 'search',
      requestId: 'search-before-ready',
      query: 'kinder bueno',
      limit: 20
    });
    expect(response).toMatchObject({
      requestId: 'search-before-ready',
      ok: false,
      error: {
        name: 'CatalogFailure',
        code: 'CATALOG_NOT_READY',
        diagnostics: { retryAllowedImmediately: true }
      }
    });
    expect(JSON.stringify(response)).not.toContain('stack');
  });
});
