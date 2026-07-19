import type { CatalogProduct } from '../lib/catalog/catalogDomain';
import type { CatalogUnitRequest } from '../lib/resolution/catalogResolution';
import { isClinicCatalogProduct } from '../lib/clinicCatalog';
import {
  genericDefaultPortionGrams,
  isGenericCatalogProduct
} from '../lib/genericFoods';
import {
  catalogPersonalDefaultUnitRequest,
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

/** Product-specific defaults for a true bare-name selection without quantity. */
export function requestForBareCatalogProduct(
  product: CatalogProduct,
  mode: CatalogUnitRuntimeMode = 'standard'
): CatalogUnitRequest {
  const personal = catalogPersonalDefaultUnitRequest(product, 1, mode);
  if (personal) return personal;

  if (isGenericCatalogProduct(product)) {
    const defaultPortionGrams = genericDefaultPortionGrams(product);
    if (defaultPortionGrams !== null) {
      return { amount: defaultPortionGrams, unit: 'g', unitExplicit: true };
    }
  }
  if (isClinicCatalogProduct(product)) {
    return defaultClinicCatalogUnitRequest(product, mode);
  }
  return {
    amount: 1,
    unit: product.nutrition.basis === 'mass' ? 'g' : 'ml',
    unitExplicit: false
  };
}

/**
 * Applies product-specific defaults exactly once. A user-provided unit remains
 * authoritative. When only an amount was entered, the amount is combined with
 * the product's persisted personal standard unit before any catalog fallback.
 */
export function requestForInitialCatalogProduct(
  parsed: ParsedCatalogQuery,
  product: CatalogProduct,
  mode: CatalogUnitRuntimeMode = 'standard'
): CatalogUnitRequest {
  const parsedRequest = requestFromParsedCatalogInput(parsed);
  if (parsed.unitExplicit) return parsedRequest;

  const personal = catalogPersonalDefaultUnitRequest(
    product,
    parsedRequest.amount,
    mode
  );
  if (personal) return personal;

  return parsed.amountExplicit
    ? parsedRequest
    : requestForBareCatalogProduct(product, mode);
}

/**
 * Variant selection keeps the current amount as the request SSOT. Explicit
 * units are preserved by contract. Otherwise, the newly selected product's
 * personal standard unit wins before its nutrition-basis fallback.
 */
export function requestForCatalogVariant(
  current: CatalogUnitRequest,
  product: CatalogProduct,
  mode: CatalogUnitRuntimeMode = 'standard'
): CatalogUnitRequest {
  if (current.unitExplicit) return current;

  const personal = catalogPersonalDefaultUnitRequest(
    product,
    current.amount,
    mode
  );
  if (personal) return personal;

  const unit = product.nutrition.basis === 'mass' ? 'g' : 'ml';
  return current.unit === unit
    ? current
    : { ...current, unit, unitExplicit: false };
}
