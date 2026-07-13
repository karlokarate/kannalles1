import { describe, expect, it } from 'vitest';
import { projectCatalogProductRow, projectCatalogSearchRows } from './catalogProjection';

function packedGtin(code: string): number {
  const lengthCode = code.length === 8 ? 0 : code.length === 13 ? 1 : 2;
  return Number(code) * 4 + lengthCode + 1;
}

function row(name: string, rank: number, metadata = 0, unit: number | null = null) {
  return {
    id: packedGtin('3017620422003'),
    g: null,
    n: name,
    brand: 'Ferrero',
    c: 49,
    s: 21.5,
    q: null,
    u: unit,
    m: metadata,
    r: rank
  };
}

describe('Atlas-aligned catalog projection', () => {
  it('projects proven unit evidence into the Atlas SSOT without a parallel record type', () => {
    const metadata = (1 << 2) | (5 << 9) | (5 << 12) | (2 << 15);
    const product = projectCatalogProductRow(row('Kinder Bueno', 100, metadata, 21.5));
    expect(product).toMatchObject({
      productId: packedGtin('3017620422003'),
      displayName: 'Kinder Bueno',
      nutrition: {
        carbohydratesPer100: 49,
        basis: 'mass',
        source: 'as_sold'
      },
      unitEvidence: {
        provenSmallestUnit: {
          baseValue: 21.5,
          basis: 'mass',
          unitKind: 'bar',
          source: 'explicit_serving_count',
          smallestEdibleUnit: true
        }
      }
    });
  });

  it('returns null when no countable-unit weight is proven', () => {
    expect(projectCatalogProductRow(row('Ohne Stückbeweis', 1)).unitEvidence.provenSmallestUnit).toBeNull();
  });

  it('preserves SQLite result order exactly and only adds resultIndex', () => {
    const hits = projectCatalogSearchRows([
      row('Third by app ranking', 1),
      row('First by app ranking', 999),
      row('Second by app ranking', 500)
    ]);
    expect(hits.map((hit) => [hit.displayName, hit.resultIndex])).toEqual([
      ['Third by app ranking', 0],
      ['First by app ranking', 1],
      ['Second by app ranking', 2]
    ]);
  });
});
