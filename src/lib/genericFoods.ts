import type { CatalogProduct, CatalogSearchHit } from './catalog/catalogDomain';

export const GENERIC_PRODUCT_CODE_PREFIX = 'generic:';

interface GenericFoodDefinition {
  id: string;
  productId: number;
  label: string;
  blsCode: string;
  carbohydratesPer100g: number;
  query: RegExp;
}

const GENERIC_FOODS: readonly GenericFoodDefinition[] = [
  { id: 'pasta-cooked', productId: -401032, label: 'Nudeln, gekocht', blsCode: 'E401032', carbohydratesPer100g: 28.68, query: /^(?:nudeln?|pasta|spaghetti|macaroni|maccheroni)(?:\s+(?:gekocht|zubereitet|verzehrfertig))?$/ },
  { id: 'rice-cooked', productId: -352032, label: 'Reis, gekocht', blsCode: 'C352032', carbohydratesPer100g: 24.8, query: /^(?:reis|rice)(?:\s+(?:gekocht|zubereitet|verzehrfertig))?$/ },
  { id: 'potatoes-boiled', productId: -110132, label: 'Kartoffeln, gekocht', blsCode: 'K110132', carbohydratesPer100g: 15.832, query: /^(?:kartoffeln?)(?:\s+(?:gekocht|zubereitet|verzehrfertig))?$/ }
];

function normalize(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase('de-DE').replace(/[^a-z0-9äöüß]+/g, ' ').trim().replace(/\s+/g, ' ');
}

function toProduct(food: GenericFoodDefinition): CatalogProduct {
  return {
    productId: food.productId,
    code: `${GENERIC_PRODUCT_CODE_PREFIX}${food.id}`,
    displayName: food.label,
    brand: `BLS 4.0 · ${food.blsCode} · MRI 2025`,
    nutrition: { carbohydratesPer100: food.carbohydratesPer100g, basis: 'mass', source: 'prepared' },
    unitEvidence: { manufacturerServing: null, productQuantity: null, provenSmallestUnit: null, defaultUnitKind: 'mass' },
    imageReference: null,
    hasQualityErrors: false,
    rankOrdinal: 0
  };
}

/** Built-in, transparent cooked defaults carried forward from main's BLS reference path. */
export function genericCookedProductForQuery(query: string): CatalogProduct | null {
  const normalized = normalize(query);
  if (/\b(?:roh|rohe|roher|ungekocht|trocken|trockene|trockener|tiefgefroren|gefroren)\b/.test(normalized)) return null;
  const food = GENERIC_FOODS.find((candidate) => candidate.query.test(normalized));
  return food ? toProduct(food) : null;
}

export function genericProductByCode(code: string): CatalogProduct | null {
  const food = GENERIC_FOODS.find((candidate) => `${GENERIC_PRODUCT_CODE_PREFIX}${candidate.id}` === code);
  return food ? toProduct(food) : null;
}

export function isGenericCatalogProduct(product: CatalogProduct): boolean {
  return product.code.startsWith(GENERIC_PRODUCT_CODE_PREFIX);
}

export function asGenericSearchHit(product: CatalogProduct): CatalogSearchHit {
  return { ...product, resultIndex: 0 };
}
