import type {
  CatalogProduct,
  CatalogSearchHit
} from '../lib/catalog/catalogDomain';
import type {
  RequestedUnit,
  ResolvedUnitOption
} from '../lib/resolution/catalogResolution';

export interface AutoSelectionEligibility {
  eligible: boolean;
  exactNameMatch: boolean;
  barcodeMatch: boolean;
  reason: 'barcode' | 'exact-name' | 'single-eligible-result' | 'choice-required' | 'ineligible';
}

function imageProductPath(code: string): string {
  if (code.length <= 8) return code;
  return [code.slice(0, 3), code.slice(3, 6), code.slice(6, 9), code.slice(9)].join('/');
}

/** Optional network image composition stays above the SQLite projection boundary. */
export function catalogProductImageUrl(product: CatalogProduct): string | null {
  const image = product.imageReference;
  if (!image) return null;
  return `https://images.openfoodfacts.org/images/products/${imageProductPath(product.code)}/${image.key}.${image.revision}.${image.resolution}.jpg`;
}

export function normalizedIdentityText(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('de-DE')
    .replace(/[^a-z0-9äöüß]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export function autoSelectionEligibility(
  hit: CatalogSearchHit,
  query: string,
  eligible: boolean,
  eligibleCount: number
): AutoSelectionEligibility {
  const barcodeMatch = /^\d{8,14}$/.test(query) && hit.code === query;
  const exactNameMatch = normalizedIdentityText(hit.displayName) === normalizedIdentityText(query);
  if (!eligible) return { eligible: false, barcodeMatch, exactNameMatch, reason: 'ineligible' };
  if (barcodeMatch) return { eligible: true, barcodeMatch, exactNameMatch, reason: 'barcode' };
  if (eligibleCount === 1) {
    return {
      eligible: true,
      barcodeMatch,
      exactNameMatch,
      reason: exactNameMatch ? 'exact-name' : 'single-eligible-result'
    };
  }
  return { eligible: false, barcodeMatch, exactNameMatch, reason: 'choice-required' };
}

export function unitLabel(unit: RequestedUnit): string {
  const labels: Record<RequestedUnit, string> = {
    g: 'Gramm',
    kg: 'Kilogramm',
    ml: 'Milliliter',
    piece: 'Stück',
    bar: 'Riegel',
    slice: 'Scheibe',
    portion: 'Portion',
    package: 'Packung'
  };
  return labels[unit];
}

export function semanticUnitProvenance(option: ResolvedUnitOption): string {
  switch (option.source) {
    case 'user_calibration':
      return 'user-calibration';
    case 'explicit_serving_count':
      return 'explicit-single-unit';
    case 'explicit_multipack_quantity':
      return 'explicit-multipack';
    case 'manufacturer_serving':
      return 'manufacturer-serving';
    case 'product_quantity':
      return 'package-quantity';
    case 'direct_mass':
      return 'direct-mass';
    case 'direct_volume':
      return 'direct-volume';
    case 'unresolved':
      return 'missing-weight';
  }
}

export function calibratableRequestedUnit(
  value: RequestedUnit | string
): value is Extract<RequestedUnit, 'piece' | 'bar' | 'slice' | 'portion'> {
  return value === 'piece' || value === 'bar' || value === 'slice' || value === 'portion';
}
