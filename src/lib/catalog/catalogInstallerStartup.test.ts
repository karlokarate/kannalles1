import { describe, expect, it, vi } from 'vitest';
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

class ValidDatabase implements CatalogDatabase {
  exec(input: string | {
    readonly sql: string;
    readonly bind?: readonly unknown[];
    readonly rowMode?: 'object';
    readonly callback?: (row: Record<string, unknown>) => void;
  }): unknown {
    if (typeof input === 'string') return undefined;
    if (input.sql.includes('table_info(p)')) {
      for (const name of PRODUCT_COLUMNS) input.callback?.({ name });
    } else if (input.sql.includes('sqlite_schema')) {
      input.callback?.({ sql: "CREATE VIRTUAL TABLE x USING fts5(s, content='')" });
    } else if (input.sql.includes('integrity_check')) {
      input.callback?.({ integrity_check: 'ok' });
    } else if (input.sql.includes('FROM x') || input.sql.includes('WHERE p.id=?')) {
      input.callback?.({ id: 1 });
    }
    return undefined;
  }

  selectValue(sql: string): unknown {
    if (sql.includes('application_id')) return 1263027011;
    if (sql.includes('user_version')) return 1;
    if (sql.includes('page_size')) return 4096;
    if (sql.includes('count(*) FROM p')) return 317579;
    throw new Error(`Unexpected SQL: ${sql}`);
  }

  close(): void {}
}

class MemoryActivations implements CatalogActivationStore {
  readonly writes: CatalogActivationRecord[] = [];

  constructor(public record: CatalogActivationRecord | null = null) {}

  async readActivationRecord(): Promise<CatalogActivationRecord | null> {
    return this.record;
  }

  async activateValidatedSlot(record: CatalogActivationRecord): Promise<void> {
    this.record = { ...record };
    this.writes.push({ ...record });
  }

  async clearInactiveSlotMetadata(slot: CatalogSlotId): Promise<void> {
    if (this.record?.previousSlot === slot) this.record = { ...this.record, previousSlot: null };
  }
}

class StartupStorage implements CatalogSlotStorage {
  readonly files = new Map<CatalogSlotId, Uint8Array>();
  readonly opens: Record<CatalogSlotId, number> = { a: 0, b: 0 };
  failOnOpen: Partial<Record<CatalogSlotId, number>> = {};

  async hasSlot(slot: CatalogSlotId): Promise<boolean> {
    return this.files.has(slot);
  }

  async importSlot(slot: CatalogSlotId, bytes: Uint8Array): Promise<void> {
    this.files.set(slot, bytes.slice());
  }

  async removeSlot(slot: CatalogSlotId): Promise<void> {
    this.files.delete(slot);
  }

  async readSlot(slot: CatalogSlotId): Promise<Uint8Array> {
    const bytes = this.files.get(slot);
    if (!bytes) throw new Error('missing slot');
    return bytes.slice();
  }

  openSlot(slot: CatalogSlotId): CatalogDatabase {
    this.opens[slot] += 1;
    if (!this.files.has(slot) || this.failOnOpen[slot] === this.opens[slot]) {
      throw new Error(`cannot open ${slot}`);
    }
    return new ValidDatabase();
  }
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('');
}

async function manifestFor(bytes: Uint8Array, version = '2026-08-01'): Promise<CatalogManifest> {
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
    if (String(input).endsWith('manifest.json')) {
      return new Response(JSON.stringify(rawManifest(manifest)), { status: 200 });
    }
    return new Response(bytes.slice(), {
      status: 200,
      headers: { 'content-length': String(bytes.byteLength) }
    });
  }) as unknown as typeof fetch;
}

describe('FORGE-210 startup activation boundary', () => {
  it('proves candidate startup-open before writing the first active pointer', async () => {
    const bytes = new TextEncoder().encode('candidate-startup');
    const manifest = await manifestFor(bytes);
    const storage = new StartupStorage();
    storage.failOnOpen.a = 2;
    const activations = new MemoryActivations();
    const installer = new CatalogInstaller({ storage, activations, fetch: fetchFor(manifest, bytes) });

    await expect(installer.initialize(
      'https://app.test/catalog/manifest.json',
      'https://app.test/catalog/'
    )).rejects.toBeInstanceOf(CatalogFailure);

    expect(activations.record).toBeNull();
    expect(activations.writes).toHaveLength(0);
    expect(storage.files.has('a')).toBe(false);
  });

  it('revalidates and atomically rolls back a failed active-slot startup', async () => {
    const bytesA = new TextEncoder().encode('retained-a');
    const bytesB = new TextEncoder().encode('failed-b');
    const activation: CatalogActivationRecord = {
      activeSlot: 'b',
      catalogVersion: '2026-08-01',
      sha256: await sha256(bytesB),
      validatedAt: '2026-08-01T10:00:00.000Z',
      previousSlot: 'a'
    };
    const storage = new StartupStorage();
    storage.files.set('a', bytesA);
    storage.files.set('b', bytesB);
    storage.failOnOpen.b = 1;
    const activations = new MemoryActivations(activation);
    const fetcher = vi.fn() as unknown as typeof fetch;
    const installer = new CatalogInstaller({ storage, activations, fetch: fetcher });

    const result = await installer.initialize(
      'https://app.test/catalog/manifest.json',
      'https://app.test/catalog/'
    );

    expect(result.activation).toMatchObject({ activeSlot: 'a', previousSlot: null });
    expect(result.diagnostics).toMatchObject({ operation: 'rollback', attemptedSlot: 'b' });
    expect(activations.record).toMatchObject({ activeSlot: 'a', previousSlot: null });
    expect(storage.files.has('a')).toBe(true);
    expect(storage.files.has('b')).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
