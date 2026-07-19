import { describe, expect, it } from 'vitest';
import {
  parseCatalogInputParts,
  parseCatalogQuery
} from './queryParser';

describe('compound product portion semantics', () => {
  it('treats every unitless product as a required portion', () => {
    const parts = parseCatalogInputParts('ein halbes Brötchen mit Nutella');
    expect(parts).toEqual([
      {
        source: 'ein halbes Brötchen',
        parsed: {
          raw: 'ein halbes Brötchen',
          catalogQuery: 'Brötchen',
          barcode: null,
          amount: 0.5,
          amountExplicit: true,
          unit: 'portion',
          unitExplicit: true
        }
      },
      {
        source: 'Nutella',
        parsed: {
          raw: 'Nutella',
          catalogQuery: 'Nutella',
          barcode: null,
          amount: 1,
          amountExplicit: false,
          unit: 'portion',
          unitExplicit: true
        }
      }
    ]);
  });

  it('applies the same rule generically to unrelated product categories', () => {
    expect(parseCatalogInputParts('zwei Äpfel und Joghurt').map((part) => part.parsed))
      .toEqual([
        expect.objectContaining({
          catalogQuery: 'Äpfel',
          amount: 2,
          unit: 'portion',
          unitExplicit: true
        }),
        expect.objectContaining({
          catalogQuery: 'Joghurt',
          amount: 1,
          unit: 'portion',
          unitExplicit: true
        })
      ]);
  });

  it('preserves an explicitly entered unit inside a compound meal', () => {
    expect(parseCatalogInputParts('ein halbes Brötchen mit 15 g Nutella').map((part) => part.parsed))
      .toEqual([
        expect.objectContaining({
          catalogQuery: 'Brötchen',
          amount: 0.5,
          unit: 'portion',
          unitExplicit: true
        }),
        expect.objectContaining({
          catalogQuery: 'Nutella',
          amount: 15,
          unit: 'g',
          unitExplicit: true
        })
      ]);
  });

  it('does not force a portion for a standalone product search', () => {
    expect(parseCatalogQuery('ein halbes Brötchen')).toMatchObject({
      catalogQuery: 'Brötchen',
      amount: 0.5,
      unit: 'g',
      unitExplicit: false
    });
    expect(parseCatalogInputParts('Nutella')).toEqual([
      {
        source: 'Nutella',
        parsed: expect.objectContaining({
          catalogQuery: 'Nutella',
          amount: 1,
          unit: 'g',
          unitExplicit: false
        })
      }
    ]);
  });

  it('keeps protected product names containing connector words as one product', () => {
    const parts = parseCatalogInputParts('100 g Pfannkuchen mit Quark');
    expect(parts).toHaveLength(1);
    expect(parts[0]?.parsed).toMatchObject({
      catalogQuery: 'Pfannkuchen mit Quark',
      amount: 100,
      unit: 'g',
      unitExplicit: true
    });
  });
});
