import { describe, expect, it } from 'vitest';
import {
  CATALOG_APPLICATION_ID,
  CATALOG_SEARCH_SQL,
  CATALOG_USER_VERSION,
  buildCatalogFtsQuery,
  decodeCatalogCode,
  decodeCatalogMetadata,
  packStandardGtin
} from '../../../Catalog/catalog-runtime.generated';

describe('generated production catalog runtime', () => {
  it('keeps the SQLite identities and deterministic production ordering', () => {
    expect(CATALOG_APPLICATION_ID).toBe(1263027011);
    expect(CATALOG_USER_VERSION).toBe(1);
    expect(CATALOG_SEARCH_SQL).toContain('p.r DESC,p.n COLLATE NOCASE ASC,p.id ASC');
    expect(CATALOG_SEARCH_SQL).toContain("WHEN lower(p.n)=lower(?) THEN 0");
    expect(CATALOG_SEARCH_SQL).toContain("WHEN lower(p.n) LIKE '%' || lower(?) || '%' THEN 2");
  });

  it.each([
    '00001234',
    '3017620422003',
    '12345678901234'
  ])('round-trips standard GTIN %s without precision loss', (code) => {
    const packed = packStandardGtin(code);
    expect(packed).not.toBeNull();
    expect(decodeCatalogCode(packed as number, null)).toBe(code);
  });

  it('uses the rescue code instead of interpreting a negative rescue id', () => {
    expect(decodeCatalogCode(-17, 'non-standard-code')).toBe('non-standard-code');
  });

  it('decodes proven unit and image metadata from JavaScript-safe integers', () => {
    // flags: hasServing, defaultUnit=bar, provenUnit=bar,
    // provenSource=explicitServingCount; image payload remains absent.
    const metadata = (1 << 2) | (5 << 9) | (5 << 12) | (2 << 15);
    const decoded = decodeCatalogMetadata(metadata);
    expect(decoded).toMatchObject({
      hasServing: true,
      defaultUnitKind: 5,
      provenUnitKind: 5,
      provenUnitSource: 2,
      imageKeyId: null,
      imageRevision: null
    });
  });

  it('builds escaped AND-prefix FTS expressions and rejects empty input', () => {
    expect(buildCatalogFtsQuery('Kinder Bueno')).toBe('"kinder"* AND "bueno"*');
    expect(buildCatalogFtsQuery('a')).toBeNull();
  });
});
