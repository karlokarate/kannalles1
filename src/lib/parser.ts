import type { FoodUnit, ParsedFoodRequest, ResolutionMode } from '../types';
import { normalizeText } from './format';
import { correctCommonFoodTypos } from './query';
import { preparationProfileFor } from './preparation';

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
  'oreo'
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

function parseNumber(token: string | undefined): number | null {
  if (!token) return null;
  const numeric = Number(token.replace(',', '.'));
  if (Number.isFinite(numeric) && numeric > 0) return numeric;
  return NUMBER_WORDS[normalizeText(token)] ?? null;
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
  const barcodeMatch = raw.match(/(?:^|\s)(\d{8,14})(?:$|\s)/);
  const barcode = barcodeMatch?.[1] ?? null;

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

  if (barcode && normalizeText(raw).replace(barcode, '').trim().length === 0) {
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

  const normalized = raw.replace(/\s+/g, ' ').trim();
  const tokens = normalized.split(' ');
  const parsedLeadingAmount = parseNumber(tokens[0]);
  let amount = parsedLeadingAmount;
  let unit = parseUnit(tokens[1]);
  let consumed = 0;
  let valueExplicit = parsedLeadingAmount !== null;
  let unitExplicit = unit !== null;

  if (amount !== null) {
    consumed = 1;
    if (unit) consumed = 2;
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
  if (!productName) productName = normalized;
  productName = correctCommonFoodTypos(productName);

  // A bare count such as “14 Salzstangen” means pieces. A product-only query
  // intentionally stays unit-neutral so the product DTO can choose the safest
  // manufacturer portion or smallest explicit unit.
  if (!unit) {
    unit = valueExplicit ? 'piece' : 'portion';
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
