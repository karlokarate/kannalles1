import type { FoodUnit } from '../types';

export const unitLabels: Record<FoodUnit, string> = {
  g: 'g',
  kg: 'kg',
  ml: 'ml',
  piece: 'Stück',
  bar: 'Riegel',
  slice: 'Scheibe',
  portion: 'Portion',
  package: 'Packung'
};

export function formatNumber(value: number | null, decimals = 1): string {
  if (value === null || !Number.isFinite(value)) return '–';
  return new Intl.NumberFormat('de-DE', {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals
  }).format(value);
}

/** Parse a browser-independent German or invariant decimal without grouping. */
export function parseLocalizedDecimal(value: string): number | null {
  const normalized = value.trim().replace(',', '.');
  if (!normalized || !/^\d+(?:\.\d*)?$/.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

export function normalizeText(value: unknown): string {
  if (Array.isArray(value)) return value.map(normalizeText).filter(Boolean).join(', ');
  if (typeof value !== 'string') return '';
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ß/g, 'ss')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export function displayBrand(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value.map((item) => item.trim()).filter(Boolean).join(', ') || null;
  return value?.trim() || null;
}

export function displayProductName(product: {
  product_name_de?: string;
  product_name?: string;
  generic_name_de?: string;
  generic_name?: string;
}): string {
  return (
    product.product_name_de?.trim() ||
    product.product_name?.trim() ||
    product.generic_name_de?.trim() ||
    product.generic_name?.trim() ||
    'Unbekanntes Produkt'
  );
}

export function createId(prefix = 'result'): string {
  try {
    return `${prefix}-${crypto.randomUUID()}`;
  } catch {
    return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }
}
