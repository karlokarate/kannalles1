export const SEARCH_FIELDS = [
  'code',
  'product_name',
  'product_name_de',
  'product_name_en',
  'generic_name',
  'generic_name_de',
  'generic_name_en',
  'brands',
  'quantity',
  'product_quantity',
  'product_quantity_unit',
  'serving_size',
  'serving_quantity',
  'countries_tags',
  'categories_tags',
  'nutriments',
  'image_front_url',
  'unique_scans_n',
  'completeness'
];

export const SEARCH_INDEX_FIELDS = [
  'code',
  'product_name',
  'product_name_de',
  'product_name_en',
  'generic_name',
  'generic_name_de',
  'generic_name_en',
  'brands',
  'quantity',
  'countries',
  'categories',
  'nutriments',
  'image_front_url',
  'unique_scans_n',
  'completeness',
  '_score'
];

export const PRODUCT_V2_FIELDS = [...SEARCH_FIELDS, 'nutrition_data_per', 'nutrition_data_prepared_per'];

// API >=3.5 moved nutrition data from flat `nutriments` to `nutrition`.
export const PRODUCT_V3_FIELDS = [
  'code',
  'product_name',
  'product_name_de',
  'product_name_en',
  'generic_name',
  'generic_name_de',
  'generic_name_en',
  'brands',
  'quantity',
  'product_quantity',
  'product_quantity_unit',
  'serving_size',
  'serving_quantity',
  'countries_tags',
  'categories_tags',
  'nutrition',
  'image_front_url',
  'data_quality_errors_tags'
];

function finiteNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value.replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function safeOffImageUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'images.openfoodfacts.org'
      ? url.toString()
      : undefined;
  } catch {
    return undefined;
  }
}

const PUBLIC_STRING_FIELDS = [
  'product_name',
  'product_name_de',
  'product_name_en',
  'generic_name',
  'generic_name_de',
  'generic_name_en',
  'quantity',
  'product_quantity_unit',
  'serving_size',
  'nutrition_data_per',
  'nutrition_data_prepared_per'
];
const PUBLIC_NUMBERISH_FIELDS = ['serving_quantity', 'product_quantity'];
const PUBLIC_NUMBER_FIELDS = ['unique_scans_n', 'completeness', '_score'];
const PUBLIC_TAG_FIELDS = ['countries_tags', 'categories_tags', 'data_quality_errors_tags'];
const PUBLIC_NUTRIMENT_FIELDS = [
  'carbohydrates_100g',
  'carbohydrates_100ml',
  'carbohydrates_serving',
  'carbohydrates_prepared_100g',
  'carbohydrates_prepared_100ml',
  'carbohydrates_prepared_serving'
];

function boundedString(value, maxLength = 500) {
  if (typeof value !== 'string') return undefined;
  const withoutControls = Array.from(value, (character) => {
    const code = character.codePointAt(0) ?? 0;
    return code <= 31 || code === 127 ? ' ' : character;
  }).join('');
  const normalized = withoutControls.replace(/\s+/g, ' ').trim();
  return normalized ? normalized.slice(0, maxLength) : undefined;
}

const MAX_CARBOHYDRATES_PER_100 = Object.freeze({
  '100g': 100,
  // Syrups may legitimately exceed 100 g/100 ml. This is a generous
  // corruption ceiling shared with the browser-side resolver.
  '100ml': 200
});

function validCarbohydrateValue(value, basis) {
  const number = finiteNumber(value);
  if (number === null || number < 0) return null;
  if (basis && number > MAX_CARBOHYDRATES_PER_100[basis]) return null;
  return number;
}

function nutrimentBasis(field) {
  if (field.endsWith('_100g')) return '100g';
  if (field.endsWith('_100ml')) return '100ml';
  return null;
}

function normalizeNutriments(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const normalized = {};
  for (const field of PUBLIC_NUTRIMENT_FIELDS) {
    const number = validCarbohydrateValue(value[field], nutrimentBasis(field));
    if (number !== null) normalized[field] = number;
  }
  return Object.keys(normalized).length ? normalized : undefined;
}

function normalizePublicProduct(product) {
  if (!product || typeof product !== 'object' || Array.isArray(product)) return undefined;
  const normalized = {};
  const code = String(product.code ?? '').replace(/\D/g, '');
  if (/^\d{7,14}$/.test(code)) normalized.code = code;
  for (const field of PUBLIC_STRING_FIELDS) {
    const value = boundedString(product[field]);
    if (value !== undefined) normalized[field] = value;
  }
  if (typeof product.brands === 'string') {
    const brands = boundedString(product.brands);
    if (brands) normalized.brands = brands;
  } else if (Array.isArray(product.brands)) {
    const brands = product.brands.map((item) => boundedString(item, 120)).filter(Boolean).slice(0, 30);
    if (brands.length) normalized.brands = brands;
  }
  for (const field of PUBLIC_NUMBERISH_FIELDS) {
    const value = finiteNumber(product[field]);
    if (value !== null) normalized[field] = value;
  }
  for (const field of PUBLIC_NUMBER_FIELDS) {
    const value = finiteNumber(product[field]);
    if (value !== null) normalized[field] = value;
  }
  for (const field of PUBLIC_TAG_FIELDS) {
    if (!Array.isArray(product[field])) continue;
    const tags = product[field]
      .map((item) => boundedString(item, 160))
      .filter(Boolean)
      .slice(0, 100);
    if (tags.length) normalized[field] = tags;
  }
  const nutriments = normalizeNutriments(product.nutriments);
  if (nutriments) normalized.nutriments = nutriments;
  const image = safeOffImageUrl(product.image_front_url);
  if (image) normalized.image_front_url = image;
  return normalized;
}

function grams(value, unit) {
  const number = finiteNumber(value);
  if (number === null) return null;
  switch (String(unit || '').trim().toLocaleLowerCase('en-US')) {
    case 'g': return number;
    case 'kg': return number * 1_000;
    case 'mg': return number / 1_000;
    case 'µg':
    case 'ug': return number / 1_000_000;
    default: return null;
  }
}

function carbohydrateValue(set) {
  const nutrient = set?.nutrients?.carbohydrates ?? set?.nutrients?.['carbohydrates-total'];
  if (!nutrient || typeof nutrient !== 'object') return null;
  // `value` is expressed for the set's `per` basis. `value_computed` is a
  // derived alternative and is used only when the primary value is absent.
  return grams(nutrient.value ?? nutrient.value_computed, nutrient.unit);
}

function basisSuffix(set) {
  const per = String(set?.per ?? '').toLocaleLowerCase('en-US').replace(/\s+/g, '');
  if (per === '100g' || per === '100ml' || per === 'serving') return per;
  const quantity = finiteNumber(set?.per_quantity);
  const unit = String(set?.per_unit ?? '').toLocaleLowerCase('en-US');
  if (quantity === 100 && (unit === 'g' || unit === 'ml')) return `100${unit}`;
  return null;
}

function isPrepared(set) {
  const preparation = String(set?.preparation ?? '').toLocaleLowerCase('en-US');
  return preparation && !['as_sold', 'sold', 'unprepared'].includes(preparation);
}

function nutritionSets(nutrition) {
  if (!nutrition || typeof nutrition !== 'object') return [];
  const aggregate = nutrition.aggregated_set;
  const aggregates = Array.isArray(aggregate) ? aggregate : aggregate ? [aggregate] : [];
  const inputs = Array.isArray(nutrition.input_sets) ? nutrition.input_sets : [];
  return [...aggregates, ...inputs];
}

export function nutritionToNutriments(nutrition) {
  const mapped = {};
  for (const set of nutritionSets(nutrition)) {
    const suffix = basisSuffix(set);
    const rawValue = carbohydrateValue(set);
    const value = validCarbohydrateValue(rawValue, suffix === '100g' || suffix === '100ml' ? suffix : null);
    if (!suffix || value === null) continue;
    const key = `carbohydrates_${isPrepared(set) ? 'prepared_' : ''}${suffix}`;
    // Aggregated values precede raw input sets and therefore win.
    if (mapped[key] === undefined) mapped[key] = value;
  }
  return mapped;
}

function nutritionBasis(nutrition, prepared) {
  const set = nutritionSets(nutrition).find((candidate) => Boolean(isPrepared(candidate)) === prepared);
  return set ? basisSuffix(set) ?? undefined : undefined;
}

export function adaptV3ProductResponse(data) {
  const raw = data && typeof data === 'object' ? data : {};
  const rawProduct = raw.product && typeof raw.product === 'object'
    ? raw.product
    : undefined;
  const normalizedProduct = normalizePublicProduct(rawProduct);
  const mappedNutriments = rawProduct ? nutritionToNutriments(rawProduct.nutrition) : {};
  const product = rawProduct
    ? {
        ...normalizedProduct,
        nutriments: { ...(normalizedProduct?.nutriments || {}), ...mappedNutriments },
        nutrition_data_per: normalizedProduct?.nutrition_data_per ?? nutritionBasis(rawProduct.nutrition, false),
        nutrition_data_prepared_per:
          normalizedProduct?.nutrition_data_prepared_per ?? nutritionBasis(rawProduct.nutrition, true)
      }
    : undefined;
  const status = raw.status === undefined ? (product ? 'success' : 'failure') : String(raw.status);
  const code = String(raw.code ?? product?.code ?? '').replace(/\D/g, '');
  return {
    status,
    ...(/^\d{7,14}$/.test(code) ? { code } : {}),
    ...(product ? { product } : {})
  };
}

export function adaptV2ProductResponse(data) {
  const raw = data && typeof data === 'object' ? data : {};
  const product = normalizePublicProduct(raw.product);
  const status = raw.status === undefined ? (product ? 'success' : 'failure') : String(raw.status);
  const code = String(raw.code ?? product?.code ?? '').replace(/\D/g, '');
  return {
    status,
    ...(/^\d{7,14}$/.test(code) ? { code } : {}),
    ...(product ? { product } : {})
  };
}

export function mergeProductResponses(v3Data, v2Data) {
  const v3 = adaptV3ProductResponse(v3Data);
  const v2 = adaptV2ProductResponse(v2Data);
  const v3Product = v3.product;
  const v2Product = v2.product;
  const product = v3Product || v2Product
    ? {
        ...(v2Product || {}),
        ...(v3Product || {}),
        nutriments: { ...(v2Product?.nutriments || {}), ...(v3Product?.nutriments || {}) }
      }
    : undefined;
  return {
    ...v2,
    ...v3,
    status: String(v3.status ?? v2.status ?? (product ? 'success' : 'failure')),
    ...(product ? { product } : {})
  };
}

export function hasCarbohydrateData(product) {
  const nutrients = product?.nutriments || {};
  if (
    validCarbohydrateValue(nutrients.carbohydrates_100g, '100g') !== null
    || validCarbohydrateValue(nutrients.carbohydrates_prepared_100g, '100g') !== null
    || validCarbohydrateValue(nutrients.carbohydrates_100ml, '100ml') !== null
    || validCarbohydrateValue(nutrients.carbohydrates_prepared_100ml, '100ml') !== null
  ) return true;

  const serving = servingMeasurement(product);
  if (!serving) return false;
  const maximum = MAX_CARBOHYDRATES_PER_100[serving.basis];
  return [nutrients.carbohydrates_serving, nutrients.carbohydrates_prepared_serving]
    .some((rawValue) => {
      const value = validCarbohydrateValue(rawValue, null);
      return value !== null && (value * 100) / serving.amount <= maximum;
    });
}

function servingMeasurement(product) {
  const text = String(product?.serving_size || '').trim();
  if (!text) return null;
  const matches = [...text.matchAll(/(?:^|[^\d])([0-9]+(?:[.,][0-9]+)?)\s*(mg|kg|g|ml|cl|l)\b/giu)];
  if (matches.length !== 1) return null;
  const value = finiteNumber(matches[0][1]);
  const unit = matches[0][2].toLocaleLowerCase('en-US');
  if (value === null || value <= 0) return null;
  const mass = { mg: value / 1_000, g: value, kg: value * 1_000 };
  const volume = { ml: value, cl: value * 10, l: value * 1_000 };
  const amount = mass[unit] ?? volume[unit];
  const basis = Object.hasOwn(mass, unit) ? '100g' : '100ml';
  if (!Number.isFinite(amount) || amount <= 0) return null;

  // OFF's serving_quantity is a normalized numeric companion to serving_size.
  // When both are present, disagreement means the dimensional evidence is not
  // safe enough to suppress v2 enrichment.
  const declaredQuantity = finiteNumber(product?.serving_quantity);
  if (declaredQuantity !== null) {
    if (declaredQuantity <= 0) return null;
    const tolerance = Math.max(0.01, amount * 0.005);
    if (Math.abs(declaredQuantity - amount) > tolerance) return null;
  }
  return { amount, basis };
}

export function normalizeIndexSearch(data, query, source) {
  const raw = data && typeof data === 'object' ? data : {};
  const rawHits = Array.isArray(raw.hits) ? raw.hits : Array.isArray(raw.products) ? raw.products : [];
  const taxonomyTags = (value) => Array.isArray(value)
    ? value
      .map((item) => typeof item === 'string' ? item : item?.id ?? item?.tag)
      .map((item) => boundedString(item, 160))
      .filter(Boolean)
      .slice(0, 100)
    : undefined;
  const hits = rawHits.map((hit) => {
    const normalized = normalizePublicProduct(hit);
    if (!normalized?.code) return null;
    return {
      ...normalized,
      ...(hit.categories_tags === undefined && taxonomyTags(hit.categories)
        ? { categories_tags: taxonomyTags(hit.categories) }
        : {}),
      ...(hit.countries_tags === undefined && taxonomyTags(hit.countries)
        ? { countries_tags: taxonomyTags(hit.countries) }
        : {})
    };
  }).filter(Boolean);
  return {
    hits,
    count: Math.max(0, Math.round(finiteNumber(raw.count) ?? hits.length)),
    ...(finiteNumber(raw.page) !== null ? { page: Math.max(1, Math.round(finiteNumber(raw.page))) } : {}),
    ...(finiteNumber(raw.page_size) !== null
      ? { page_size: Math.max(1, Math.min(20, Math.round(finiteNumber(raw.page_size)))) }
      : {}),
    ...(finiteNumber(raw.page_count) !== null
      ? { page_count: Math.max(0, Math.round(finiteNumber(raw.page_count))) }
      : {}),
    ...(finiteNumber(raw.took) !== null ? { took: Math.max(0, finiteNumber(raw.took)) } : {}),
    ...(typeof raw.timed_out === 'boolean' ? { timed_out: raw.timed_out } : {}),
    source,
    query_used: query
  };
}

export function normalizeLegacySearch(data, query) {
  const raw = data && typeof data === 'object' ? data : {};
  const hits = Array.isArray(raw.products)
    ? raw.products.map(normalizePublicProduct).filter((hit) => hit?.code)
    : [];
  return {
    hits,
    count: Math.max(0, Math.round(finiteNumber(raw.count) ?? hits.length)),
    ...(finiteNumber(raw.page) !== null ? { page: Math.max(1, Math.round(finiteNumber(raw.page))) } : {}),
    ...(finiteNumber(raw.page_size) !== null
      ? { page_size: Math.max(1, Math.min(20, Math.round(finiteNumber(raw.page_size)))) }
      : {}),
    ...(finiteNumber(raw.page_count) !== null
      ? { page_count: Math.max(0, Math.round(finiteNumber(raw.page_count))) }
      : {}),
    source: 'open-food-facts-legacy',
    query_used: query
  };
}
