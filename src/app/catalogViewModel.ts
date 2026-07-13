import type {
  CatalogProduct,
  CatalogSearchHit,
  CatalogUnitEvidenceSource
} from '../lib/catalog/catalogDomain';
import type {
  CatalogResolutionProduct,
  CatalogUnitEvidenceSource as ResolutionEvidenceSource,
  RequestedUnit,
  ResolvedUnitOption
} from '../lib/resolution/catalogResolution';

export interface AutoSelectionEligibility {
  eligible: boolean;
  exactNameMatch: boolean;
  barcodeMatch: boolean;
  reason: 'barcode' | 'exact-name' | 'single-eligible-result' | 'choice-required' | 'ineligible';
}

const COUNTED_KINDS = new Set(['piece', 'bar', 'slice', 'portion']);

function evidenceSource(source: CatalogUnitEvidenceSource): ResolutionEvidenceSource {
  if (source === 'explicit_serving_count') return 'explicit-serving-count';
  if (source === 'explicit_multipack_quantity') return 'explicit-multipack-quantity';
  return 'manufacturer-serving';
}

export function toResolutionProduct(product: CatalogProduct): CatalogResolutionProduct {
  const proven = product.provenUnit;
  return {
    id: product.productId,
    displayName: product.displayName,
    brand: product.brand,
    carbohydratesPer100: product.carbohydratesPer100,
    carbohydrateBasis: product.nutritionBasis,
    defaultUnitKind: product.defaultUnitKind,
    manufacturerServing: product.manufacturerServing
      ? { baseValue: product.manufacturerServing.value, basis: product.manufacturerServing.basis }
      : null,
    productQuantity: product.productQuantity
      ? { baseValue: product.productQuantity.value, basis: product.productQuantity.basis }
      : null,
    unitEvidence: proven && COUNTED_KINDS.has(proven.kind)
      ? {
          baseValue: proven.value,
          basis: proven.basis,
          unitKind: proven.kind as 'piece' | 'bar' | 'slice' | 'portion',
          source: evidenceSource(proven.source)
        }
      : null,
    hasQualityErrors: product.hasQualityErrors
  };
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
    case 'user-calibration':
      return 'user-calibration';
    case 'catalog-explicit-serving-count':
      return 'explicit-single-unit';
    case 'catalog-explicit-multipack':
      return 'explicit-multipack';
    case 'manufacturer-serving':
      return 'manufacturer-serving';
    case 'product-quantity':
      return 'package-quantity';
    case 'direct-mass':
      return 'direct-mass';
    case 'direct-volume':
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
