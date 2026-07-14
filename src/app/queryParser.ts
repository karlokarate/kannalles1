import type { RequestedUnit } from '../lib/resolution/catalogResolution';

export interface ParsedCatalogQuery {
  raw: string;
  catalogQuery: string;
  barcode: string | null;
  amount: number;
  amountExplicit: boolean;
  unit: RequestedUnit;
  unitExplicit: boolean;
}

const UNIT_WORDS: Array<{ pattern: RegExp; unit: RequestedUnit }> = [
  { pattern: /^(?:stück|stueck|stk\.?|pieces?)\b/i, unit: 'piece' },
  { pattern: /^(?:riegel|bars?)\b/i, unit: 'bar' },
  { pattern: /^(?:scheiben?|slices?)\b/i, unit: 'slice' },
  { pattern: /^(?:portion(?:en)?|portions?)\b/i, unit: 'portion' },
  { pattern: /^(?:packung(?:en)?|paket(?:e)?|packs?)\b/i, unit: 'package' },
  { pattern: /^(?:kilogramm|kg)\b/i, unit: 'kg' },
  { pattern: /^(?:gramm|g)\b/i, unit: 'g' },
  { pattern: /^(?:milliliter|ml)\b/i, unit: 'ml' }
];

const SPOKEN_AMOUNTS: Readonly<Record<string, number>> = {
  ein: 1, eine: 1, einen: 1, einem: 1, einer: 1,
  zwei: 2, drei: 3, vier: 4, fünf: 5, fuenf: 5, sechs: 6,
  sieben: 7, acht: 8, neun: 9, zehn: 10, elf: 11, zwölf: 12, zwoelf: 12
};

function localizedNumber(value: string): number | null {
  const normalized = value.replace(/\s/g, '').replace(',', '.');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function normalizeCatalogQuery(value: string): string {
  return value.normalize('NFKC').replace(/\s+/g, ' ').trim();
}

export function parseSpokenProductList(rawInput: string): string[] {
  const normalized = normalizeCatalogQuery(rawInput);
  if (!normalized) return [];
  return normalized
    .split(/\s*(?:,|\b(?:mit|und|plus|sowie)\b)\s*/i)
    .map((part) => normalizeCatalogQuery(part))
    .filter(Boolean);
}

export function parseCatalogQuery(rawInput: string): ParsedCatalogQuery | null {
  const raw = normalizeCatalogQuery(rawInput);
  if (!raw) return null;

  const barcodeDigits = raw.replace(/\D/g, '');
  if (/^\d{8,14}$/.test(raw) && barcodeDigits.length === raw.length) {
    return {
      raw,
      catalogQuery: barcodeDigits,
      barcode: barcodeDigits,
      amount: 1,
      amountExplicit: false,
      unit: 'g',
      unitExplicit: false
    };
  }

  let remainder = raw;
  let amount = 1;
  let amountExplicit = false;
  let unit: RequestedUnit = 'g';
  let unitExplicit = false;

  const amountMatch = remainder.match(/^(\d+(?:[.,]\d+)?)\s*/);
  if (amountMatch) {
    const parsed = localizedNumber(amountMatch[1]);
    if (parsed !== null) {
      amount = parsed;
      amountExplicit = true;
      remainder = remainder.slice(amountMatch[0].length).trimStart();
    }
  } else {
    const spokenMatch = remainder.match(/^([a-zäöüß]+)\s+/i);
    const spokenAmount = spokenMatch ? SPOKEN_AMOUNTS[spokenMatch[1].toLocaleLowerCase('de-DE')] : undefined;
    if (spokenMatch && spokenAmount !== undefined) {
      amount = spokenAmount;
      amountExplicit = true;
      remainder = remainder.slice(spokenMatch[0].length).trimStart();
    }
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
