import type { FoodUnit, ParsedFoodRequest, ResolutionMode } from '../types';
import { normalizeText } from './format';
import { correctCommonFoodTypos } from './query';
import { preparationProfileFor } from './preparation';
import { extractOffBarcodeEvidence } from './barcode';
import { isPlausibleFoodAmount, MAX_AMOUNT_BY_UNIT } from './domainLimits';

export { isPlausibleFoodAmount } from './domainLimits';

const NUMBER_WORDS: Record<string, number> = {
  ein: 1,
  eine: 1,
  einen: 1,
  einem: 1,
  eins: 1,
  zwei: 2,
  drei: 3,
  vier: 4,
  fünf: 5,
  funf: 5,
  sechs: 6,
  sieben: 7,
  acht: 8,
  neun: 9,
  zehn: 10,
  elf: 11,
  zwölf: 12,
  zwolf: 12,
  dreizehn: 13,
  vierzehn: 14,
  fünfzehn: 15,
  funfzehn: 15,
  sechzehn: 16,
  siebzehn: 17,
  achtzehn: 18,
  neunzehn: 19,
  zwanzig: 20
};

const UNIT_ALIASES: Array<{ unit: FoodUnit; pattern: RegExp }> = [
  { unit: 'kg', pattern: /^(kg|kilogramm|kilo)$/i },
  { unit: 'g', pattern: /^(g|gramm|gram)$/i },
  { unit: 'ml', pattern: /^(ml|milliliter)$/i },
  { unit: 'bar', pattern: /^(riegel|bar|bars)$/i },
  { unit: 'slice', pattern: /^(scheibe|scheiben|slice|slices)$/i },
  { unit: 'portion', pattern: /^(portion|portionen|serving|servings)$/i },
  { unit: 'package', pattern: /^(packung|packungen|paket|beutel|tüte|tuete)$/i },
  { unit: 'piece', pattern: /^(stück|stuck|stueck|stücke|stucke|stuecke|piece|pieces)$/i }
];

const KNOWN_BRANDS = [
  'kinder',
  'ferrero',
  'haribo',
  'lorenz',
  'funny-frisch',
  'funny frisch',
  'nestle',
  'milka',
  'nutella',
  'bifi',
  'ritter sport',
  'mcdonalds',
  'burger king',
  'rewe',
  'ja!',
  'lidl',
  'aldi',
  'k-classic',
  'edeka',
  'griesson',
  'de beukelaer',
  'bahlsen',
  'oreo',
  '7 days'
];

const DISTINCT_PRODUCT_TERMS = [
  'kinder bueno',
  'schokobons',
  'schoko bons',
  'bifi',
  'nutella',
  'hanuta',
  'duplo',
  'knoppers',
  'milchschnitte',
  'pick up'
];

const NUMERIC_PRODUCT_PREFIXES = [
  '7 days',
  '5 minuten terrine',
  '3 glocken'
];

const STRICT_DECIMAL = /^[+-]?(?:\d+(?:[.,]\d+)?|[.,]\d+)$/;
const COMPACT_METRIC = /^([+-]?(?:\d+(?:[.,]\d+)?|[.,]\d+))(kg|g|ml)$/i;

function parseNumber(token: string | undefined): number | null {
  if (!token) return null;
  const numeric = STRICT_DECIMAL.test(token) ? Number(token.replace(',', '.')) : Number.NaN;
  if (Number.isFinite(numeric) && numeric > 0) return numeric;
  return NUMBER_WORDS[normalizeText(token)] ?? null;
}

function explicitNumericValue(token: string | undefined): number | null {
  if (!token || !STRICT_DECIMAL.test(token)) return null;
  const numeric = Number(token.replace(',', '.'));
  return Number.isFinite(numeric) ? numeric : null;
}

function withoutBarcodeEvidence(raw: string, start: number, end: number): string {
  return `${raw.slice(0, start)} ${raw.slice(end)}`
    .replace(/\b(?:barcode|ean|upc|gtin)\b\s*[:#-]?/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseUnit(token: string | undefined): FoodUnit | null {
  if (!token) return null;
  for (const entry of UNIT_ALIASES) {
    if (entry.pattern.test(token)) return entry.unit;
  }
  return null;
}

function inferMode(productName: string, unit: FoodUnit, barcode: string | null): ResolutionMode {
  if (barcode) return 'barcode';
  const normalized = normalizeText(productName);
  if (preparationProfileFor(normalized)) return 'generic_category';
  if (KNOWN_BRANDS.some((brand) => normalized.includes(brand))) return 'exact_product';
  if (DISTINCT_PRODUCT_TERMS.some((term) => normalized.includes(term))) return 'exact_product';
  if (unit === 'bar' && normalized.split(' ').length >= 2) return 'exact_product';
  return 'generic_category';
}

export function parseFoodRequestLocal(rawInput: string): ParsedFoodRequest {
  const raw = rawInput.trim();
  const barcodeEvidence = extractOffBarcodeEvidence(raw);
  const barcode = barcodeEvidence?.normalized ?? null;

  if (!raw) {
    return {
      status: 'needs_clarification',
      rawInput,
      product: { name: '', brand: null, variant: null },
      amount: { value: 1, unit: 'portion', valueExplicit: false, unitExplicit: false },
      resolutionMode: 'generic_category',
      barcode,
      clarificationQuestion: 'Welches Lebensmittel und welche Menge möchtest du berechnen?',
      parser: 'local'
    };
  }

  const inputWithoutBarcode = barcodeEvidence
    ? withoutBarcodeEvidence(raw, barcodeEvidence.start, barcodeEvidence.end)
    : raw;

  if (barcode && !inputWithoutBarcode) {
    return {
      status: 'parsed',
      rawInput: raw,
      product: { name: 'Produkt per Barcode', brand: null, variant: null },
      amount: { value: 1, unit: 'package', valueExplicit: false, unitExplicit: false },
      resolutionMode: 'barcode',
      barcode,
      clarificationQuestion: null,
      parser: 'local'
    };
  }

  const normalized = inputWithoutBarcode.replace(/\s+/g, ' ').trim();
  const tokens = normalized.split(' ');
  const protectedNumericProduct = NUMERIC_PRODUCT_PREFIXES.some((prefix) =>
    normalizeText(normalized) === prefix || normalizeText(normalized).startsWith(`${prefix} `)
  );
  const compact = protectedNumericProduct ? null : tokens[0]?.match(COMPACT_METRIC) ?? null;
  const explicitNumeric = compact
    ? explicitNumericValue(compact[1])
    : protectedNumericProduct
      ? null
      : explicitNumericValue(tokens[0]);
  const parsedLeadingAmount = protectedNumericProduct ? null : parseNumber(compact?.[1] ?? tokens[0]);
  let amount = explicitNumeric ?? parsedLeadingAmount;
  let unit = compact ? parseUnit(compact[2]) : parseUnit(tokens[1]);
  let consumed = 0;
  let valueExplicit = amount !== null;
  let unitExplicit = unit !== null;

  if (amount !== null) {
    consumed = compact ? 1 : 1 + (unit ? 1 : 0);
  }

  if (amount === null) {
    amount = 1;
    unit = null;
    valueExplicit = false;
  }

  if (!unit) {
    const firstUnitIndex = tokens.findIndex((token, index) => index <= 2 && parseUnit(token) !== null);
    if (firstUnitIndex >= 0) {
      unit = parseUnit(tokens[firstUnitIndex]);
      unitExplicit = true;
      consumed = Math.max(consumed, firstUnitIndex + 1);
    }
  }

  let productName = tokens.slice(consumed).join(' ').trim();
  if (!productName && barcode) productName = 'Produkt per Barcode';
  if (!productName && consumed === 0) productName = normalized;
  productName = correctCommonFoodTypos(productName);

  // A bare count such as “14 Salzstangen” means pieces. A product-only query
  // intentionally stays unit-neutral so the product DTO can choose the safest
  // manufacturer portion or smallest explicit unit.
  if (!unit) {
    unit = valueExplicit ? 'piece' : 'portion';
  }

  if (valueExplicit && !isPlausibleFoodAmount(amount, unit)) {
    const maximum = MAX_AMOUNT_BY_UNIT[unit];
    const nonPositive = !Number.isFinite(amount) || amount <= 0;
    return {
      status: 'needs_clarification',
      rawInput: raw,
      product: { name: productName, brand: null, variant: null },
      amount: { value: 1, unit, valueExplicit: false, unitExplicit },
      resolutionMode: barcode ? 'barcode' : 'generic_category',
      barcode,
      clarificationQuestion: nonPositive
        ? 'Die Menge muss größer als 0 sein. Bitte korrigiere die Mengenangabe.'
        : `Die Menge ist ungewöhnlich groß. Bitte prüfe sie (maximal ${maximum} ${unit} pro Berechnung).`,
      parser: 'local'
    };
  }

  const lowered = normalizeText(productName);
  const brand = KNOWN_BRANDS.find((candidate) => lowered.includes(candidate)) ?? null;
  const variant = ['white', 'weiss', 'weiß', 'mini', 'dark', 'vollkorn', 'vegan', 'protein']
    .find((candidate) => lowered.includes(normalizeText(candidate))) ?? null;

  return {
    status: productName ? 'parsed' : 'needs_clarification',
    rawInput: raw,
    product: { name: productName, brand, variant },
    amount: {
      value: amount,
      unit,
      valueExplicit,
      unitExplicit
    },
    resolutionMode: inferMode(productName, unit, barcode),
    barcode,
    clarificationQuestion: productName ? null : 'Welches Lebensmittel meinst du?',
    parser: 'local'
  };
}
