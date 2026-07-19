import { describe, expect, it } from 'vitest';
import { parseCatalogQuery, parseProductList } from './queryParser';

describe('fractional catalog queries', () => {
  it('parses ein halbes Brötchen as half of the resolved product unit', () => {
    expect(parseCatalogQuery('Ein halbes Brötchen')).toEqual({
      raw: 'Ein halbes Brötchen',
      catalogQuery: 'Brötchen',
      barcode: null,
      amount: 0.5,
      amountExplicit: true,
      unit: 'g',
      unitExplicit: false
    });
  });

  it.each([
    ['eine halbe Portion Nudeln', 0.5, 'portion', true, 'Nudeln'],
    ['anderthalb Riegel Kinder Bueno', 1.5, 'bar', true, 'Kinder Bueno'],
    ['dreiviertel Brötchen', 0.75, 'g', false, 'Brötchen'],
    ['½ Brötchen', 0.5, 'g', false, 'Brötchen'],
    ['1½ Brötchen', 1.5, 'g', false, 'Brötchen'],
    ['null komma fünf Brötchen', 0.5, 'g', false, 'Brötchen']
  ])('removes the complete quantity phrase from %s', (input, expectedAmount, expectedUnit, expectedExplicit, expectedQuery) => {
    expect(parseCatalogQuery(input)).toMatchObject({
      amount: expectedAmount,
      amountExplicit: true,
      unit: expectedUnit,
      unitExplicit: expectedExplicit,
      catalogQuery: expectedQuery
    });
  });

  it('retains the existing one-product article behavior', () => {
    expect(parseCatalogQuery('ein Brötchen')).toMatchObject({
      amount: 1,
      amountExplicit: true,
      unitExplicit: false,
      catalogQuery: 'Brötchen'
    });
  });

  it('keeps fractional products intact in multi-product input', () => {
    const parts = parseProductList('ein halbes Brötchen mit 15 g Nutella und 200 ml Milch');
    expect(parts).toEqual([
      'ein halbes Brötchen',
      '15 g Nutella',
      '200 ml Milch'
    ]);
    expect(parts.map((part) => parseCatalogQuery(part))).toEqual([
      expect.objectContaining({ amount: 0.5, catalogQuery: 'Brötchen' }),
      expect.objectContaining({ amount: 15, unit: 'g', catalogQuery: 'Nutella' }),
      expect.objectContaining({ amount: 200, unit: 'ml', catalogQuery: 'Milch' })
    ]);
  });

  it('does not change barcode recognition', () => {
    expect(parseCatalogQuery('4008400321622')).toMatchObject({
      barcode: '4008400321622',
      amount: 1,
      amountExplicit: false
    });
  });
});
