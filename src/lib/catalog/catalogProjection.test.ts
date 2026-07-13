import { describe, expect, it } from 'vitest';
import { projectCatalogProductRow, projectCatalogSearchRows } from './catalogProjection';

function packedGtin(code: string): number {
  const lengthCode = code.length === 8 ? 0 : code.length === 13 ? 1 : 2;
  return Number(code) * 4 + lengthCode + 1;
}

function row(name: string, rank: number) {
  const metadata = (1 << 2) | (5 << 9) | (5 << 12) | (2 << 15);
  return {
    id: packedGtin('4008400322728') + rank,
    g: null,
    n: name,
    brand: 'Ferrero',
    c: 49,
    s: 21.5,
    q: null,
    u: 21.5,
    m: metadata,
    r: rank
  };
}

describe('Atlas catalog projection', () => {
  it('projects structured proven evidence using Atlas snake_case vocabulary', () => {
    const product = projectCatalogProductRow(row('Kinder Bueno', 100));
    expect(product.provenUnit).toEqual({
      value: 21.5,
      basis: 'mass',
      kind: 'bar',
      source: 'explicit_serving_count',
      countability: 'countable',
      smallestEdibleUnit: true,
      proven: true
    });
    expect(product.image).toBeNull();
  });

  it('does not synthesize absent unit evidence', () => {
    const product = projectCatalogProductRow({
      ...row('Produkt ohne Stückbeweis', 1),
      u: null,
      m: 1 << 4
    });
    expect(product.provenUnit).toBeNull();
  });

  it('assigns resultIndex in the exact SQLite row order without reranking', () => {
    const hits = projectCatalogSearchRows([
      row('SQLite first', 1),
      row('SQLite second', 999)
    ]);
    expect(hits.map((hit) => [hit.displayName, hit.resultIndex])).toEqual([
      ['SQLite first', 0],
      ['SQLite second', 1]
    ]);
  });
});
