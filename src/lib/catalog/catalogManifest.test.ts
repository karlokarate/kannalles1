import { describe, expect, it } from 'vitest';
import { parseCatalogManifest, resolveCatalogArtifactUrl } from './catalogManifest';

function productionManifest(): Record<string, unknown> {
  return {
    contract: 'kh-checker-offline-catalog-production',
    contractVersion: '1.0.0',
    catalogVersion: '2026-07-13',
    generatedAtUtc: '2026-07-13T15:57:52.861271+00:00',
    database: {
      file: 'kh-checker-dach-v1.sqlite',
      bytes: 25227264,
      sha256: 'df177ab7545b13b39f40f1c2474adeb1501b19a44a82bf04838b4fd2e819458d',
      applicationId: 1263027011,
      userVersion: 1,
      pageSize: 4096,
      products: 317579,
      brands: 60682
    },
    image: {
      resolution: 200,
      dictionaryFile: 'catalog-image-keys.v2.json',
      dictionarySha256: 'cb573e736bd67b5477210a2f3de0d9cca2e0b34130703649be64060a507aef21'
    },
    codecFile: 'catalog-codecs.v1.json',
    runtimeTypescript: 'catalog-runtime.generated.ts',
    transportCompression: null,
    search: {
      ordering: 'exact display-name match, display-name prefix, display-name contains, then r DESC, n COLLATE NOCASE ASC, id ASC',
      resultLimitDefault: 20,
      runtimeParameters: [
        'ftsQuery',
        'canonicalProductQuery',
        'canonicalProductQuery',
        'canonicalProductQuery',
        'limit'
      ]
    }
  };
}

describe('catalog manifest authority', () => {
  it('normalizes the Production-v1 manifest without renaming its database artifact', () => {
    const manifest = parseCatalogManifest(productionManifest());
    expect(manifest.filename).toBe('kh-checker-dach-v1.sqlite');
    expect(manifest.productCount).toBe(317579);
    expect(resolveCatalogArtifactUrl(manifest, 'https://example.test/catalog/')).toBe(
      'https://example.test/catalog/kh-checker-dach-v1.sqlite'
    );
  });

  it('rejects path traversal and non-authoritative transport compression', () => {
    const unsafe = productionManifest();
    (unsafe.database as Record<string, unknown>).file = '../catalog.sqlite';
    expect(() => parseCatalogManifest(unsafe)).toThrow(/sicherer Dateiname/);

    const compressed = productionManifest();
    compressed.transportCompression = 'gzip';
    expect(() => parseCatalogManifest(compressed)).toThrow(/Komprimierte Katalogtransporte/);
  });

  it('rejects a changed visible ordering contract', () => {
    const changed = productionManifest();
    (changed.search as Record<string, unknown>).ordering = 'rank only';
    expect(() => parseCatalogManifest(changed)).toThrow(/Suchreihenfolge/);
  });
});
