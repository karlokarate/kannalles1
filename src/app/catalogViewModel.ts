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
  if (!image || !/^\d{8,14}$/.test(product.code)) return null;
  return `https://images.openfoodfacts.org/images/products/${imageProductPath(product.code)}/${image.key}.${image.revision}.${image.resolution}.jpg`;
}

const MINI_VARIANT = /\b(?:mini|minis|miniatur|bite|bites|snacksize|fun size)\b/;
const UNREQUESTED_VARIANT = /\b(?:dark|white|weiß|weiss|eis|eggs?|glace)\b/;

/**
 * Chooses a product only when the catalog proves a normal edible unit for a
 * sufficiently specific name. Numeric unit weight is intentionally not used:
 * a "Mini" must not beat the regular bar merely because it weighs less.
 */
export function selectDefaultCatalogCandidate(
  hits: readonly CatalogSearchHit[],
  query: string,
  eligible: readonly boolean[]
): CatalogSearchHit | null {
  const normalizedQuery = normalizedIdentityText(query);
  const tokens = normalizedQuery.split(' ').filter(Boolean);
  const eligibleHits = hits.filter((_, index) => eligible[index]);
  if (eligibleHits.length === 1) return eligibleHits[0];

  const strongMatch = tokens.length >= 2 ? eligibleHits
    .filter((hit) => {
      const name = normalizedIdentityText(hit.displayName);
      const proven = hit.unitEvidence.provenSmallestUnit;
      return tokens.every((token) => name.includes(token))
        && !MINI_VARIANT.test(name)
        && Boolean(hit.imageReference)
        && Boolean(proven && ['piece', 'bar', 'slice'].includes(proven.unitKind));
    })
    .sort((a, b) => {
      const aName = normalizedIdentityText(a.displayName);
      const bName = normalizedIdentityText(b.displayName);
      const score = (name: string) => (name === normalizedQuery ? 100 : 0)
        + (name.startsWith(normalizedQuery) ? 30 : 0)
        - (UNREQUESTED_VARIANT.test(name) && !UNREQUESTED_VARIANT.test(normalizedQuery) ? 80 : 0)
        - Math.max(0, name.length - normalizedQuery.length);
      return score(bName) - score(aName) || a.resultIndex - b.resultIndex;
    })[0] : null;

  // The catalog rank remains the authoritative fallback. This makes every
  // successful text search immediately useful while keeping all variants.
  return strongMatch ?? eligibleHits[0] ?? null;
}

export function inferredCalibrationUnit(product: CatalogProduct): Extract<RequestedUnit, 'piece' | 'bar' | 'slice' | 'portion'> {
  const proven = product.unitEvidence.provenSmallestUnit?.unitKind;
  if (proven === 'piece' || proven === 'bar' || proven === 'slice') return proven;
  const defaultUnit = product.unitEvidence.defaultUnitKind;
  if (calibratableRequestedUnit(defaultUnit)) return defaultUnit;
  const name = normalizedIdentityText(product.displayName);
  if (/\b(?:riegel|bar)\b/.test(name)) return 'bar';
  if (/\b(?:scheibe|scheiben|slice)\b/.test(name)) return 'slice';
  return 'piece';
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
