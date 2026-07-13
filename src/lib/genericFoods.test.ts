import { describe, expect, it } from 'vitest';
import { genericCookedProductForQuery, genericProductByCode, isGenericCatalogProduct } from './genericFoods';

describe('bundled cooked generic defaults', () => {
  it.each([
    ['Nudeln', 'E401032', 28.68],
    ['Reis gekocht', 'C352032', 24.8],
    ['Kartoffeln', 'K110132', 15.832]
  ])('uses the established BLS cooked reference for %s', (query, code, carbs) => {
    const product = genericCookedProductForQuery(query);
    expect(product?.brand).toContain(code);
    expect(product?.nutrition).toMatchObject({ carbohydratesPer100: carbs, source: 'prepared' });
    expect(product && isGenericCatalogProduct(product)).toBe(true);
    expect(genericProductByCode(product?.code ?? '')).toEqual(product);
  });

  it('does not silently convert explicit raw or branded/specialty searches', () => {
    expect(genericCookedProductForQuery('trockener Reis')).toBeNull();
    expect(genericCookedProductForQuery('Instant Nudeln')).toBeNull();
    expect(genericCookedProductForQuery('Barilla Nudeln')).toBeNull();
  });
});
