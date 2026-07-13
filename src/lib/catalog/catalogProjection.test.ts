import { describe, expect, it } from 'vitest';
import { projectCatalogProductRow } from './catalogProjection';

function packedGtin(code: string): number {
  const lengthCode = code.length === 8 ? 0 : code.length === 13 ? 1 : 2;
  return Number(code) * 4 + lengthCode + 1;
}

describe('catalog row projection', () => {
  it('projects structured proven-unit evidence without guessing a weight', () => {
    const metadata =
      (1 << 2)
      | (5 << 9)
      | (5 << 12)
      | (2 << 15);
    const product = projectCatalogProductRow({
      id: packedGtin('3017620422003'),
      g: null,
      n: 'Kinder Bueno',
      brand: 'Ferrero',
      c: 49,
      s: 21.5,
      q: null,
      u: 21.5,
      m: metadata,
      r: 100
    });
    expect(product.unitEvidence.provenSmallestUnit).toEqual({
      value: 21.5,
      basis: 'mass',
      kind: 'bar',
      source: 'explicitServingCount'
    });
  });

  it('returns null when the catalog does not prove a countable-unit weight', () => {
    const product = projectCatalogProductRow({
      id: packedGtin('3017620422003'),
      g: null,
      n: 'Produkt ohne Stückbeweis',
      brand: null,
      c: 20,
      s: null,
      q: 100,
      u: null,
      m: 1 << 4,
      r: 1
    });
    expect(product.unitEvidence.provenSmallestUnit).toBeNull();
  });
});
