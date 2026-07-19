import type { CatalogProduct } from '../lib/catalog/catalogDomain';
import type { CatalogUnitRequest } from '../lib/resolution/catalogResolution';
import { isClinicCatalogProduct } from '../lib/clinicCatalog';
import { isGenericCatalogProduct } from '../lib/genericFoods';
import {
  defaultClinicCatalogUnitRequest,
  normalizeCatalogUnitRequest
} from './catalogUnitRuntime';
import type { CatalogUnitRuntimeMode } from './catalogUnitRuntime';
import type { ParsedCatalogQuery } from './queryParser';

/**
 * Single authority for turning a parsed user input into the request consumed by
 * unit resolution and carbohydrate calculation. Controllers may select or
 * reorder products, but they must not parse the canonical product query again.
 */
export function requestFromParsedCatalogInput(
  parsed: ParsedCatalogQuery
): CatalogUnitRequest {
  return normalizeCatalogUnitRequest({
    amount: parsed.amount,
    unit: parsed.unit,
    unitExplicit: parsed.unitExplicit
  });
}

/**
 * Applies product-specific defaults exactly once, when the original user input
 * contains neither an explicit amount nor an explicit unit. Any recognized
 * amount is preserved byte-for-byte through product lookup and favorite
 * promotion.
 */
export function requestForInitialCatalogProduct(
  parsed: ParsedCatalogQuery,
  product: CatalogProduct,
  mode: CatalogUnitRuntimeMode = 'standard'
): CatalogUnitRequest {
  const parsedRequest = requestFromParsedCatalogInput(parsed);
  if (parsed.amountExplicit || parsed.unitExplicit) return parsedRequest;
  if (isGenericCatalogProduct(product)) {
    return { amount: 200, unit: 'g', unitExplicit: true };
  }
  if (isClinicCatalogProduct(product)) {
    return defaultClinicCatalogUnitRequest(product, mode);
  }
  return parsedRequest;
}

/**
 * Variant selection keeps the current amount as the request SSOT. Explicit
 * units are preserved by contract; implicit units are reset only to the new
 * product's nutrition basis so the shared unit runtime can re-resolve serving
 * evidence for that product.
 */
export function requestForCatalogVariant(
  current: CatalogUnitRequest,
  product: CatalogProduct
): CatalogUnitRequest {
  if (current.unitExplicit) return current;
  const unit = product.nutrition.basis === 'mass' ? 'g' : 'ml';
  return current.unit === unit
    ? current
    : { ...current, unit, unitExplicit: false };
}
