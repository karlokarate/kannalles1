import { clinicCatalogProducts } from '../lib/clinicCatalog';
import {
  expandGermanVulgarFractions,
  parseLeadingGermanQuantity
} from '../lib/input/germanQuantity';
import type { RequestedUnit } from '../lib/resolution/catalogResolution';

export interface ParsedCatalogQuery {
  raw: string;
  catalogQuery: string;
  barcode: string | null;
  amount: number;
  amountExplicit: boolean;
  unit: RequestedUnit;
  /**
   * A hard unit constraint from the input semantics. This is true for a unit
   * spoken by the user and for the generic portion default of compound meals.
   */
  unitExplicit: boolean;
}

export interface ParsedCatalogInputPart {
  source: string;
  parsed: ParsedCatalogQuery | null;
}

export interface ParseCatalogQueryOptions {
  implicitUnit?: RequestedUnit;
  requireImplicitUnit?: boolean;
}

const COMPOUND_PRODUCT_OPTIONS: Readonly<ParseCatalogQueryOptions> = Object.freeze({
  implicitUnit: 'portion',
  requireImplicitUnit: true
});

const UNIT_WORDS: Array<{ pattern: RegExp; unit: RequestedUnit }> = [
  { pattern: /^(?:stück(?:e)?|stueck(?:e)?|stk\.?|pieces?)\b/i, unit: 'piece' },
  { pattern: /^(?:riegel|bars?)\b/i, unit: 'bar' },
  { pattern: /^(?:scheiben?|slices?)\b/i, unit: 'slice' },
  { pattern: /^(?:portion(?:en)?|portions?)\b/i, unit: 'portion' },
  { pattern: /^(?:packung(?:en)?|paket(?:e)?|packs?)\b/i, unit: 'package' },
  { pattern: /^(?:kilogramm|kg)\b/i, unit: 'kg' },
  { pattern: /^(?:gramm|g)\b/i, unit: 'g' },
  { pattern: /^(?:milliliter|ml)\b/i, unit: 'ml' }
];

const DECIMAL_COMMA_SENTINEL = '\uE000';
const PRODUCT_SENTINEL_START = '\uE100';
const PRODUCT_SENTINEL_END = '\uE101';
const CONNECTOR_WORD = /\b(?:mit|und|plus|sowie)\b/i;
const CLINIC_CONNECTOR_PRODUCT_NAMES = clinicCatalogProducts()
  .map((product) => product.displayName)
  .filter((name) => CONNECTOR_WORD.test(name))
  .sort((left, right) => right.length - left.length || left.localeCompare(right, 'de-DE'));

export function normalizeCatalogQuery(value: string): string {
  return expandGermanVulgarFractions(value).normalize('NFKC').replace(/\s+/g, ' ').trim();
}

function protectDecimalCommas(value: string): string {
  return value.replace(/(\d),(?=\d)/g, `$1${DECIMAL_COMMA_SENTINEL}`);
}

function restoreDecimalCommas(value: string): string {
  return value.replaceAll(DECIMAL_COMMA_SENTINEL, ',');
}

function nameBoundary(value: string, index: number): boolean {
  if (index < 0 || index >= value.length) return true;
  return !/[\p{L}\p{N}]/u.test(value[index]);
}

function protectClinicProductSpans(value: string): { protectedValue: string; replacements: string[] } {
  let protectedValue = value;
  const replacements: string[] = [];

  for (const productName of CLINIC_CONNECTOR_PRODUCT_NAMES) {
    const needle = productName.toLocaleLowerCase('de-DE');
    let searchFrom = 0;
    while (searchFrom < protectedValue.length) {
      const lower = protectedValue.toLocaleLowerCase('de-DE');
      const index = lower.indexOf(needle, searchFrom);
      if (index < 0) break;
      const end = index + productName.length;
      if (!nameBoundary(protectedValue, index - 1) || !nameBoundary(protectedValue, end)) {
        searchFrom = index + 1;
        continue;
      }
      const replacementIndex = replacements.length;
      replacements.push(protectedValue.slice(index, end));
      const token = `${PRODUCT_SENTINEL_START}${replacementIndex}${PRODUCT_SENTINEL_END}`;
      protectedValue = `${protectedValue.slice(0, index)}${token}${protectedValue.slice(end)}`;
      searchFrom = index + token.length;
    }
  }

  return { protectedValue, replacements };
}

function restoreProductSpans(value: string, replacements: readonly string[]): string {
  return value.replace(/\uE100(\d+)\uE101/g, (_match, index: string) => replacements[Number(index)] ?? '');
}

export function parseProductList(rawInput: string): string[] {
  const normalized = normalizeCatalogQuery(rawInput);
  if (!normalized) return [];

  const decimalSafe = protectDecimalCommas(normalized);
  const { protectedValue, replacements } = protectClinicProductSpans(decimalSafe);
  return protectedValue
    .split(/\s*(?:[,;]|\b(?:mit|und|plus|sowie)\b)\s*/i)
    .map((part) => restoreProductSpans(restoreDecimalCommas(part), replacements))
    .map((part) => normalizeCatalogQuery(part))
    .filter(Boolean);
}

// Kept as a compatibility alias for persisted tests and older call sites.
export const parseSpokenProductList = parseProductList;

export function parseCatalogQuery(
  rawInput: string,
  options: ParseCatalogQueryOptions = {}
): ParsedCatalogQuery | null {
  const raw = normalizeCatalogQuery(rawInput);
  if (!raw) return null;

  const implicitUnit = options.implicitUnit ?? 'g';
  const requireImplicitUnit = options.requireImplicitUnit === true;
  const barcodeDigits = raw.replace(/\D/g, '');
  if (/^\d{8,14}$/.test(raw) && barcodeDigits.length === raw.length) {
    return {
      raw,
      catalogQuery: barcodeDigits,
      barcode: barcodeDigits,
      amount: 1,
      amountExplicit: false,
      unit: implicitUnit,
      unitExplicit: requireImplicitUnit
    };
  }

  let remainder = raw;
  let amount = 1;
  let amountExplicit = false;
  let unit: RequestedUnit = implicitUnit;
  let unitExplicit = requireImplicitUnit;

  const quantity = parseLeadingGermanQuantity(remainder);
  if (quantity) {
    amount = quantity.amount;
    amountExplicit = true;
    remainder = remainder.slice(quantity.consumedCharacters).trimStart();
  }

  for (const candidate of UNIT_WORDS) {
    const match = remainder.match(candidate.pattern);
    if (!match) continue;
    unit = candidate.unit;
    unitExplicit = true;
    remainder = remainder.slice(match[0].length).trimStart();
    break;
  }

  const catalogQuery = normalizeCatalogQuery(remainder);
  if (!catalogQuery) return null;
  return {
    raw,
    catalogQuery,
    barcode: null,
    amount,
    amountExplicit,
    unit,
    unitExplicit
  };
}

/**
 * Parses a complete product input once. When several products are named, each
 * segment without its own unit means one portion. Missing portion evidence is
 * therefore resolved through the generic calibration prompt instead of grams.
 */
export function parseCatalogInputParts(rawInput: string): ParsedCatalogInputPart[] {
  const sources = parseProductList(rawInput);
  const options = sources.length > 1 ? COMPOUND_PRODUCT_OPTIONS : undefined;
  return sources.map((source) => ({
    source,
    parsed: parseCatalogQuery(source, options)
  }));
}
