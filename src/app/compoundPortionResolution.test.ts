import { describe, expect, it } from 'vitest';
import type { CatalogProduct } from '../lib/catalog/catalogDomain';
import {
  resolveCatalogUnitRuntime
} from './catalogUnitRuntime';
import { requestForInitialCatalogProduct } from './catalogInputRequest';
import {
  parseCatalogInputParts,
  type ParsedCatalogQuery
} from './queryParser';

function product(
  productId: number,
  displayName: string,
  servingGrams: number | null
): CatalogProduct {
  return {
    productId,
    code: `generic-test-${productId}`,
    displayName,
    brand: null,
    nutrition: {
      carbohydratesPer100: 50,
      basis: 'mass',
      source: 'as_sold'
    },
    unitEvidence: {
      manufacturerServing: servingGrams === null
        ? null
        : { baseValue: servingGrams, basis: 'mass' },
      productQuantity: null,
      provenSmallestUnit: null,
      defaultUnitKind: 'mass'
    },
    imageReference: null,
    hasQualityErrors: false,
    rankOrdinal: productId
  };
}

function parsedProducts(input: string): ParsedCatalogQuery[] {
  return parseCatalogInputParts(input)
    .map((part) => part.parsed)
    .filter((part): part is ParsedCatalogQuery => part !== null);
}

describe('generic compound portion resolution', () => {
  it('requires a portion for every unitless component, independent of product names', () => {
    const [first, second] = parsedProducts('ein halbes Produkt A mit Produkt B');
    if (!first || !second) throw new Error('two parsed products expected');

    const firstRequest = requestForInitialCatalogProduct(
      first,
      product(1, 'Produkt A', null),
      'smart'
    );
    const secondRequest = requestForInitialCatalogProduct(
      second,
      product(2, 'Produkt B', null),
      'smart'
    );

    expect(firstRequest).toEqual({ amount: 0.5, unit: 'portion', unitExplicit: true });
    expect(secondRequest).toEqual({ amount: 1, unit: 'portion', unitExplicit: true });
  });

  it('asks for grams per portion whenever exact portion evidence is missing', () => {
    const parsed = parsedProducts('ein halbes Produkt A mit Produkt B');
    expect(parsed).toHaveLength(2);

    for (const [index, query] of parsed.entries()) {
      const target = product(index + 1, `Produkt ${index + 1}`, null);
      const request = requestForInitialCatalogProduct(query, target, 'smart');
      const state = resolveCatalogUnitRuntime(target, request, 'smart');
      expect(state.resolution).toMatchObject({
        status: 'needs_unit_calibration',
        reason: 'explicit-unit-preserved'
      });
      expect(state.prompt).toMatchObject({
        unit: 'portion',
        requestedAmount: request.amount,
        mode: 'unit-weight',
        question: 'Wie viel Gramm wiegt eine Portion?'
      });
    }
  });

  it('uses a proven manufacturer portion immediately without asking again', () => {
    const part = parsedProducts('Produkt A mit Produkt B')[0];
    if (!part) throw new Error('parsed product expected');
    const target = product(1, 'Produkt A', 30);
    const request = requestForInitialCatalogProduct(part, target, 'smart');
    const state = resolveCatalogUnitRuntime(target, request, 'smart');

    expect(state.prompt).toBeNull();
    expect(state.resolution).toMatchObject({
      status: 'resolved',
      selectedOptionId: 'portion:manufacturer_serving:30'
    });
    expect(state.resolution.options[0]).toMatchObject({
      unit: 'portion',
      baseValue: 30,
      source: 'manufacturer_serving',
      recommended: true
    });
  });

  it('preserves explicit units instead of replacing them with a portion', () => {
    const [first, second] = parsedProducts('100 g Produkt A und 250 ml Produkt B');
    expect(first).toMatchObject({ amount: 100, unit: 'g', unitExplicit: true });
    expect(second).toMatchObject({ amount: 250, unit: 'ml', unitExplicit: true });
  });
});
