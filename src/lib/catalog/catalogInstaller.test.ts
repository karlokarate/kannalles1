import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CatalogSlotId } from './catalogDomain';
import { CatalogFailure } from './catalogErrors';
import {
  CatalogInstaller,
  type CatalogDatabase,
  type CatalogSlotStorage
} from './catalogInstaller';
import type { CatalogManifest } from './catalogProtocol';
import type {
  CatalogActivationRecord,
  CatalogActivationStore
} from './catalogSlots';

const PRODUCT_COLUMNS = ['id', 'g', 'n', 'b', 'c', 's', 'q', 'u', 'm', 'r'];

interface DatabaseProfile {
  applicationId: number;
  userVersion: number;
  pageSize: number;
  columns: string[];
  ftsSql: string;
  integrity: string;
  productCount: number;
  textSmoke: boolean;
  barcodeSmoke: boolean;
}

class MemoryActivationStore implements CatalogActivationStore {
  writes: CatalogActivationRecord[] = [];
  events: string[] = [];

  constructor(public record: CatalogActivationRecord | null = null) {}

  async readActivationRecord(): Promise<CatalogActivationRecord | null> {
    this.events.push('activation-read');
    return this.record;
  }

  async activateValidatedSlot(nextRecord: CatalogActivationRecord): Promise<void> {
    this.events.push('activation-write');
    this.record = { ...nextRecord };
    this.writes.push({ ...nextRecord });
  }

  async clearInactiveSlotMetadata(slot: CatalogSlotId): Promise<void> {
    this.events.push(`activation-clear-${slot}`);
    if (this.record?.activeSlot === slot) throw new Error('attempted to clear active slot');
    if (this.record?.previousSlot === slot) this.record = { ...this.record, previousSlot: null };
  }
}

class FakeDatabase implements CatalogDatabase {
  constructor(
    private readonly profile: DatabaseProfile,
    private readonly events: string[]
  ) {}

  exec(input: string | {
    readonly sql: string;
    readonly bind?: readonly unknown[];
    readonly rowMode?: 'object';
    readonly callback?: (row: Record<string, unknown>) => void;
  }): unknown {
    const sql = typeof input === 'string' ? input : input.sql;
    const callback = typeof input === 'string' ? undefined : input.callback;
    if (sql.includes('table_info(p)')) {
      this.events.push('validate-schema');
      for (const name of this.profile.columns) callback?.({ name });
    } else if (sql.includes('sqlite_schema')) {
      this.events.push('validate-fts-schema');
      callback?.({ sql: this.profile.ftsSql });
    } else if (sql.includes('integrity_check')) {
      this.events.push('validate-integrity');
      callback?.({ integrity_check: this.profile.integrity });
    } else if (sql.includes('FROM x')) {
      this.events.push('smoke-text');
      if (this.profile.textSmoke) callback?.({ id: 1 });
    } else if (sql.includes('WHERE p.id=?')) {
      this.events.push('smoke-barcode');
      if (this.profile.barcodeSmoke) callback?.({ id: 1 });
    } else if (sql.includes('WHERE p.g=?')) {
      this.events.push('smoke-barcode-rescue');
      if (this.profile.barcodeSmoke) callback?.({ id: 1 });
    }
    return undefined;
  }

  selectValue(sql: string): unknown {
    if (sql.includes('application_id')) return this.profile.applicationId;
    if (sql.includes('user_version')) return this.profile.userVersion;
    if (sql.includes('page_size')) return this.profile.pageSize;
    if (sql.includes('count(*) FROM p')) return this.profile.productCount;
    throw new Error(`Unexpected scalar SQL: ${sql}`);
  }

  close(): void {
    this.events.push('validation-close');
  }
}

class FakeStorage implements CatalogSlotStorage {
  readonly files = new Map<CatalogSlotId, Uint8Array>();
  readonly profiles: Record<CatalogSlotId, DatabaseProfile>;
  readonly events: string[] = [];
  importFailure: CatalogSlotId | null = null;
  openFailure: CatalogSlotId | null = null;

  constructor(profileA = validProfile(), profileB = validProfile()) {
    this.profiles = { a: profileA, b: profileB };
  }

  async hasSlot(slot: CatalogSlotId): Promise<boolean> {
    return this.files.has(slot);
  }

  async importSlot(slot: CatalogSlotId, bytes: Uint8Array): Promise<void> {
    this.events.push(`import-${slot}`);
    if (this.importFailure === slot) throw new Error('interrupted import');
    this.files.set(slot, bytes.slice());
  }

  async removeSlot(slot: CatalogSlotId): Promise<void> {
    this.events.push(`remove-${slot}`);
    this.files.delete(slot);
  }

  async readSlot(slot: CatalogSlotId): Promise<Uint8Array> {
    const bytes = this.files.get(slot);
    if (!bytes) throw new Error('missing slot');
    return bytes.slice();
  }

  openSlot(slot: CatalogSlotId): CatalogDatabase {
    this.events.push(`open-${slot}`);
    if (this.openFailure === slot || !this.files.has(slot)) throw new Error(`cannot open ${slot}`);
    return new FakeDatabase(this.profiles[slot], this.events);
  }
}

function validProfile(overrides: Partial<DatabaseProfile> = {}): DatabaseProfile {
  return {
    applicationId: 1263027011,
    userVersion: 1,
    pageSize: 4096,
    columns: [...PRODUCT_COLUMNS],
    ftsSql: 'CREATE VIRTUAL TABLE x USING fts5(s, content=\'\')',
    integrity: 'ok',
    productCount: 317579,
    textSmoke: true,
    barcodeSmoke: true,
    ...overrides
  };
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('');
}

async function manifestFor(bytes: Uint8Array, version = '2026-07-13'): Promise<CatalogManifest> {
  return {
    contract: 'kh-checker-offline-catalog-production',
    contractVersion: '1.0.0',
    catalogVersion: version,
    generatedAtUtc: '2026-07-13T15:57:52.861271+00:00',
    filename: 'kh-checker-dach-v1.sqlite',
    sizeBytes: bytes.byteLength,
    sha256: await sha256(bytes),
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

function rawManifest(manifest: CatalogManifest): Record<string, unknown> {
  return {
    contract: manifest.contract,
    contractVersion: manifest.contractVersion,
    catalogVersion: manifest.catalogVersion,
    generatedAtUtc: manifest.generatedAtUtc,
    database: {
      file: manifest.filename,
      bytes: manifest.sizeBytes,
      sha256: manifest.sha256,
      applicationId: manifest.applicationId,
      userVersion: manifest.userVersion,
      pageSize: manifest.pageSize,
      products: manifest.productCount,
      brands: manifest.brandCount
    },
    image: {
      resolution: manifest.imageResolution,
      dictionaryFile: manifest.imageDictionaryFile,
      dictionarySha256: manifest.imageDictionarySha256
    },
    codecFile: manifest.codecFile,
    runtimeTypescript: manifest.runtimeTypescript,
    transportCompression: null,
    search: {
      ordering: manifest.searchOrdering,
      resultLimitDefault: manifest.resultLimitDefault,
      runtimeParameters: ['ftsQuery', 'canonicalProductQuery', 'canonicalProductQuery', 'canonicalProductQuery', 'limit']
    }
  };
}

function fetchFor(manifest: CatalogManifest, bytes: Uint8Array): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('manifest.json')) {
      return new Response(JSON.stringify(rawManifest(manifest)), { status: 200 });
    }
    return new Response(bytes.slice(), {
      status: 200,
      headers: { 'content-length': String(bytes.byteLength) }
    });
  }) as unknown as typeof fetch;
}

async function seededActiveA(): Promise<{
  bytes: Uint8Array;
  manifest: CatalogManifest;
  record: CatalogActivationRecord;
  storage: FakeStorage;
  activations: MemoryActivationStore;
}> {
  const bytes = new TextEncoder().encode('catalog-a-valid');
  const manifest = await manifestFor(bytes, '2026-07-13');
  const record: CatalogActivationRecord = {
    activeSlot: 'a',
    catalogVersion: manifest.catalogVersion,
    sha256: manifest.sha256,
    validatedAt: '2026-07-13T18:00:00.000Z',
    previousSlot: null
  };
  const storage = new FakeStorage();
  storage.files.set('a', bytes);
  return { bytes, manifest, record, storage, activations: new MemoryActivationStore(record) };
}

function installer(
  storage: FakeStorage,
  activations: MemoryActivationStore,
  fetcher: typeof fetch
): CatalogInstaller {
  return new CatalogInstaller({
    storage,
    activations,
    fetch: fetcher,
    now: () => '2026-07-13T19:00:00.000Z'
  });
}

async function expectFailedUpdateDoesNotSwitch(
  profileB: DatabaseProfile,
  expectedCode: string
): Promise<void> {
  const seeded = await seededActiveA();
  const updateBytes = new TextEncoder().encode(`catalog-b-${expectedCode}`);
  const updateManifest = await manifestFor(updateBytes, '2026-08-01');
  seeded.storage.profiles.b = profileB;
  await expect(installer(seeded.storage, seeded.activations, fetchFor(updateManifest, updateBytes)).installUpdate(
    'https://app.test/catalog/manifest.json',
    'https://app.test/catalog/'
  )).rejects.toMatchObject({ code: expectedCode });
  expect(seeded.activations.record).toEqual(seeded.record);
  expect(seeded.storage.files.get('a')).toEqual(seeded.bytes);
  expect(seeded.storage.files.has('b')).toBe(false);
}

afterEach(() => vi.restoreAllMocks());

describe('FORGE-210 atomic A/B lifecycle', () => {
  it('1. first installation activates slot a', async () => {
    const bytes = new TextEncoder().encode('first-catalog');
    const manifest = await manifestFor(bytes);
    const storage = new FakeStorage();
    const activations = new MemoryActivationStore();
    const result = await installer(storage, activations, fetchFor(manifest, bytes)).initialize(
      'https://app.test/catalog/manifest.json',
      'https://app.test/catalog/'
    );
    expect(result.activation.activeSlot).toBe('a');
    expect(activations.record?.activeSlot).toBe('a');
    expect(storage.files.has('a')).toBe(true);
  });

  it('2. the next valid version installs into b', async () => {
    const seeded = await seededActiveA();
    const bytes = new TextEncoder().encode('second-catalog');
    const manifest = await manifestFor(bytes, '2026-08-01');
    const result = await installer(seeded.storage, seeded.activations, fetchFor(manifest, bytes)).installUpdate(
      'https://app.test/catalog/manifest.json',
      'https://app.test/catalog/'
    );
    expect(result.activation.activeSlot).toBe('b');
    expect(seeded.activations.record?.activeSlot).toBe('b');
  });

  it('3. activation metadata is not written before complete validation', async () => {
    const bytes = new TextEncoder().encode('ordered-validation');
    const manifest = await manifestFor(bytes);
    const storage = new FakeStorage();
    const activations = new MemoryActivationStore();
    await installer(storage, activations, fetchFor(manifest, bytes)).initialize(
      'https://app.test/catalog/manifest.json',
      'https://app.test/catalog/'
    );
    const validationClose = storage.events.lastIndexOf('validation-close');
    expect(validationClose).toBeGreaterThan(storage.events.indexOf('smoke-barcode'));
    expect(activations.writes).toHaveLength(1);
    expect(activations.events.lastIndexOf('activation-write')).toBeGreaterThan(
      activations.events.lastIndexOf('activation-read')
    );
  });

  it('4. hash failure leaves the active slot unchanged', async () => {
    const seeded = await seededActiveA();
    const bytes = new TextEncoder().encode('bad-hash-body');
    const manifest = await manifestFor(new TextEncoder().encode('bad-hash-bodz'), '2026-08-01');
    await expect(installer(seeded.storage, seeded.activations, fetchFor(manifest, bytes)).installUpdate(
      'https://app.test/catalog/manifest.json',
      'https://app.test/catalog/'
    )).rejects.toMatchObject({ code: 'CATALOG_HASH_MISMATCH' });
    expect(seeded.activations.record).toEqual(seeded.record);
    expect(seeded.storage.files.get('a')).toEqual(seeded.bytes);
  });

  it('5. schema failure leaves the active slot unchanged', async () => {
    await expectFailedUpdateDoesNotSwitch(validProfile({ columns: PRODUCT_COLUMNS.slice(0, -1) }), 'CATALOG_SCHEMA_MISMATCH');
  });

  it('6. integrity failure leaves the active slot unchanged', async () => {
    await expectFailedUpdateDoesNotSwitch(validProfile({ integrity: 'database disk image is malformed' }), 'CATALOG_INTEGRITY_FAILED');
  });

  it('7. smoke-query failure leaves the active slot unchanged', async () => {
    await expectFailedUpdateDoesNotSwitch(validProfile({ textSmoke: false }), 'CATALOG_QUERY_FAILED');
  });

  it('8. interrupted import leaves the active slot unchanged', async () => {
    const seeded = await seededActiveA();
    const bytes = new TextEncoder().encode('interrupted-catalog');
    const manifest = await manifestFor(bytes, '2026-08-01');
    seeded.storage.importFailure = 'b';
    await expect(installer(seeded.storage, seeded.activations, fetchFor(manifest, bytes)).installUpdate(
      'https://app.test/catalog/manifest.json',
      'https://app.test/catalog/'
    )).rejects.toBeInstanceOf(CatalogFailure);
    expect(seeded.activations.record).toEqual(seeded.record);
    expect(seeded.storage.files.has('b')).toBe(false);
  });

  it('9. successful switch retains the previous slot', async () => {
    const seeded = await seededActiveA();
    const bytes = new TextEncoder().encode('retained-catalog-b');
    const manifest = await manifestFor(bytes, '2026-08-01');
    await installer(seeded.storage, seeded.activations, fetchFor(manifest, bytes)).installUpdate(
      'https://app.test/catalog/manifest.json',
      'https://app.test/catalog/'
    );
    expect(seeded.activations.record).toMatchObject({ activeSlot: 'b', previousSlot: 'a' });
    expect(seeded.storage.files.has('a')).toBe(true);
    expect(seeded.storage.files.has('b')).toBe(true);
  });

  it('10. startup reopens the last validated active slot without downloading', async () => {
    const seeded = await seededActiveA();
    const fetcher = vi.fn() as unknown as typeof fetch;
    const result = await installer(seeded.storage, seeded.activations, fetcher).initialize(
      'https://app.test/catalog/manifest.json',
      'https://app.test/catalog/'
    );
    expect(result.activation.activeSlot).toBe('a');
    expect(result.installedFromNetwork).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
