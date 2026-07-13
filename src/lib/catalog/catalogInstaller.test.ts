import { describe, expect, it, vi } from 'vitest';
import type { CatalogSlotId } from './catalogDomain';
import {
  CatalogInstaller,
  type CatalogDatabase,
  type CatalogPool,
  type CatalogPools
} from './catalogInstaller';
import type { CatalogManifest } from './catalogProtocol';
import {
  type CatalogSlotMetadata,
  type CatalogSlotState,
  type CatalogSlotStateStore,
  activateCatalogSlot,
  emptyCatalogSlotState,
  recordValidatedCatalogSlot,
  slotMetadataFromManifest
} from './catalogSlots';

interface DatabaseProfile {
  readonly applicationId: number;
  readonly userVersion: number;
  readonly pageSize: number;
  readonly integrity: string;
  readonly productCount: number;
  readonly brandCount: number;
  readonly smoke: boolean;
}

const PRODUCT_COLUMNS = ['id', 'g', 'n', 'b', 'c', 's', 'q', 'u', 'm', 'r'];
const BRAND_COLUMNS = ['id', 'v'];

class MemoryStore implements CatalogSlotStateStore {
  readonly writes: CatalogSlotState[] = [];
  constructor(public state: CatalogSlotState = emptyCatalogSlotState()) {}
  async read(): Promise<CatalogSlotState> { return this.state; }
  async write(state: CatalogSlotState): Promise<void> {
    this.state = structuredClone(state);
    this.writes.push(structuredClone(state));
  }
}

class FakeDatabase implements CatalogDatabase {
  constructor(private readonly profile: DatabaseProfile) {}
  exec(input: string | {
    readonly sql: string;
    readonly bind?: readonly unknown[];
    readonly rowMode?: 'object';
    readonly callback?: (row: Record<string, unknown>) => void;
  }): unknown {
    const sql = typeof input === 'string' ? input : input.sql;
    const callback = typeof input === 'string' ? undefined : input.callback;
    if (sql.includes('table_info(p)')) {
      for (const name of PRODUCT_COLUMNS) callback?.({ name });
    } else if (sql.includes('table_info(d)')) {
      for (const name of BRAND_COLUMNS) callback?.({ name });
    } else if (sql.includes('integrity_check')) {
      callback?.({ integrity_check: this.profile.integrity });
    } else if (sql.includes('FROM x') && this.profile.smoke) {
      callback?.({ id: 12033681688014, g: null, n: 'Kinder Bueno', brand: 'Ferrero', c: 49, s: 21.5, q: 43, u: 21.5, m: 82436, r: 100 });
    } else if ((sql.includes('WHERE p.id=?') || sql.includes('WHERE p.g=?')) && this.profile.smoke) {
      callback?.({ id: 1 });
    }
    return undefined;
  }
  selectValue(sql: string): unknown {
    if (sql.includes('application_id')) return this.profile.applicationId;
    if (sql.includes('user_version')) return this.profile.userVersion;
    if (sql.includes('page_size')) return this.profile.pageSize;
    if (sql.includes("name='x'")) return "CREATE VIRTUAL TABLE x USING fts5(s, content='')";
    if (sql.includes('count(*) FROM p')) return this.profile.productCount;
    if (sql.includes('count(*) FROM d')) return this.profile.brandCount;
    throw new Error(`Unexpected scalar SQL: ${sql}`);
  }
  close(): void {}
}

class FakePool implements CatalogPool {
  readonly files = new Map<string, Uint8Array>();
  openFailure = false;
  readonly OpfsSAHPoolDb: new (filename: string, flags?: string) => CatalogDatabase;

  constructor(readonly profile: DatabaseProfile) {
    const pool = this;
    this.OpfsSAHPoolDb = class implements CatalogDatabase {
      private readonly delegate: FakeDatabase;
      constructor(filename: string) {
        if (pool.openFailure || !pool.files.has(filename)) throw new Error('open failed');
        this.delegate = new FakeDatabase(pool.profile);
      }
      exec(input: Parameters<CatalogDatabase['exec']>[0]): unknown { return this.delegate.exec(input); }
      selectValue(sql: string): unknown { return this.delegate.selectValue(sql); }
      close(): void { this.delegate.close(); }
    };
  }
  getFileNames(): string[] { return [...this.files.keys()]; }
  importDb(filename: string, bytes: Uint8Array): unknown { this.files.set(filename, bytes.slice()); return undefined; }
  exportFile(filename: string): Uint8Array {
    const bytes = this.files.get(filename);
    if (!bytes) throw new Error('missing file');
    return bytes.slice();
  }
  unlink(filename: string): unknown { this.files.delete(filename); return undefined; }
}

function profile(overrides: Partial<DatabaseProfile> = {}): DatabaseProfile {
  return {
    applicationId: 1263027011,
    userVersion: 1,
    pageSize: 4096,
    integrity: 'ok',
    productCount: 317579,
    brandCount: 60682,
    smoke: true,
    ...overrides
  };
}

async function hash(bytes: Uint8Array): Promise<string> {
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('');
}

async function manifest(bytes: Uint8Array, catalogVersion: string): Promise<CatalogManifest> {
  return {
    contract: 'kh-checker-offline-catalog-production',
    contractVersion: '1.0.0',
    catalogVersion,
    generatedAtUtc: '2026-07-13T15:57:52.861271+00:00',
    filename: 'kh-checker-dach-v1.sqlite',
    sizeBytes: bytes.byteLength,
    sha256: await hash(bytes),
    applicationId: 1263027011,
    userVersion: 1,
    pageSize: 4096,
    productCount: 317579,
    brandCount: 60682,
    codecFile: 'catalog-codecs.v1.json',
    runtimeTypescript: 'catalog-runtime.generated.ts',
    imageResolution: 200,
    imageDictionaryFile: 'catalog-image-keys.v2.json',
    imageDictionarySha256: 'c'.repeat(64),
    transportCompression: null,
    searchOrdering: 'exact display-name match, display-name prefix, display-name contains, then r DESC, n COLLATE NOCASE ASC, id ASC',
    resultLimitDefault: 20
  };
}

function rawManifest(value: CatalogManifest): Record<string, unknown> {
  return {
    contract: value.contract,
    contractVersion: value.contractVersion,
    catalogVersion: value.catalogVersion,
    generatedAtUtc: value.generatedAtUtc,
    database: {
      file: value.filename,
      bytes: value.sizeBytes,
      sha256: value.sha256,
      applicationId: value.applicationId,
      userVersion: value.userVersion,
      pageSize: value.pageSize,
      products: value.productCount,
      brands: value.brandCount
    },
    image: {
      resolution: value.imageResolution,
      dictionaryFile: value.imageDictionaryFile,
      dictionarySha256: value.imageDictionarySha256
    },
    codecFile: value.codecFile,
    runtimeTypescript: value.runtimeTypescript,
    transportCompression: null,
    search: {
      ordering: value.searchOrdering,
      resultLimitDefault: value.resultLimitDefault,
      runtimeParameters: ['ftsQuery', 'canonicalProductQuery', 'canonicalProductQuery', 'canonicalProductQuery', 'limit']
    }
  };
}

function fetcher(value: CatalogManifest, bytes: Uint8Array): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('manifest.json')) return new Response(JSON.stringify(rawManifest(value)), { status: 200 });
    return new Response(bytes.slice(), {
      status: 200,
      headers: { 'content-length': String(bytes.byteLength) }
    });
  }) as unknown as typeof fetch;
}

function pools(profileA = profile(), profileB = profile()): CatalogPools {
  return { a: new FakePool(profileA), b: new FakePool(profileB) };
}

function seedState(slot: CatalogSlotId, metadata: CatalogSlotMetadata): CatalogSlotState {
  return activateCatalogSlot(recordValidatedCatalogSlot(emptyCatalogSlotState(), metadata), slot);
}

describe('catalog A/B installer', () => {
  it('installs into the inactive OPFS pool, fully validates, then atomically activates it', async () => {
    const bytes = new TextEncoder().encode('catalog-v1');
    const value = await manifest(bytes, '2026-07-13');
    const store = new MemoryStore();
    const runtimePools = pools();
    const installer = new CatalogInstaller(runtimePools, {
      store,
      fetcher: fetcher(value, bytes),
      now: () => '2026-07-13T19:00:00.000Z'
    });
    const result = await installer.bootstrap('https://example.test/catalog/manifest.json', 'https://example.test/catalog/');
    expect(result.status).toMatchObject({ state: 'ready', activeSlot: 'a', catalogVersion: '2026-07-13' });
    expect(runtimePools.a.getFileNames()).toEqual(['/kh-checker-dach-v1.sqlite']);
    expect(runtimePools.b.getFileNames()).toEqual([]);
    expect(store.state.activeSlot).toBe('a');
    expect(store.state.rollbackSlot).toBeNull();
  });

  it('keeps the previous validated slot authoritative when an update fails validation', async () => {
    const oldBytes = new TextEncoder().encode('catalog-old');
    const newBytes = new TextEncoder().encode('catalog-new');
    const oldManifest = await manifest(oldBytes, '2026-07-13');
    const newManifest = await manifest(newBytes, '2026-07-14');
    const oldMetadata = slotMetadataFromManifest('a', oldManifest, '2026-07-13T18:00:00.000Z');
    const store = new MemoryStore(seedState('a', oldMetadata));
    const runtimePools = pools(profile(), profile({ integrity: 'corrupt' }));
    (runtimePools.a as FakePool).files.set('/kh-checker-dach-v1.sqlite', oldBytes);
    const installer = new CatalogInstaller(runtimePools, { store, fetcher: fetcher(newManifest, newBytes) });
    const result = await installer.bootstrap('https://example.test/catalog/manifest.json', 'https://example.test/catalog/');
    expect(result.status.state).toBe('ready');
    expect(result.status.activeSlot).toBe('a');
    expect(result.status.diagnostics?.code).toBe('CATALOG_INTEGRITY_FAILED');
    expect(store.state.activeSlot).toBe('a');
    expect(store.state.slots.b).toBeNull();
    expect(runtimePools.a.getFileNames()).toEqual(['/kh-checker-dach-v1.sqlite']);
  });

  it('rolls back during startup when the active slot is corrupt and the previous slot remains valid', async () => {
    const oldBytes = new TextEncoder().encode('catalog-old');
    const badBytes = new TextEncoder().encode('catalog-corrupt');
    const oldManifest = await manifest(oldBytes, '2026-07-13');
    const badManifest = await manifest(new TextEncoder().encode('catalog-new'), '2026-07-14');
    const oldMetadata = slotMetadataFromManifest('a', oldManifest, '2026-07-13T18:00:00.000Z');
    const badMetadata = slotMetadataFromManifest('b', badManifest, '2026-07-14T18:00:00.000Z');
    let state = seedState('a', oldMetadata);
    state = activateCatalogSlot(recordValidatedCatalogSlot(state, badMetadata), 'b');
    const store = new MemoryStore(state);
    const runtimePools = pools();
    (runtimePools.a as FakePool).files.set('/kh-checker-dach-v1.sqlite', oldBytes);
    (runtimePools.b as FakePool).files.set('/kh-checker-dach-v1.sqlite', badBytes);
    const installer = new CatalogInstaller(runtimePools, { store, fetcher: fetcher(oldManifest, oldBytes) });
    const result = await installer.bootstrap('https://example.test/catalog/manifest.json', 'https://example.test/catalog/');
    expect(result.status).toMatchObject({ state: 'ready', activeSlot: 'a', catalogVersion: '2026-07-13' });
    expect(result.status.diagnostics?.operation).toBe('rollback');
    expect(store.state.activeSlot).toBe('a');
    expect(store.state.rollbackSlot).toBeNull();
    expect(store.state.slots.b).toBeNull();
    expect(runtimePools.b.getFileNames()).toEqual([]);
  });
});
