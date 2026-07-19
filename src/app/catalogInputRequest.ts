import type { CatalogProduct } from '../lib/catalog/catalogDomain';
import type { CatalogInputIntent } from '../lib/input/catalogInput';
import {
  genericDefaultPortionGrams,
  isGenericCatalogProduct
} from '../lib/genericFoods';
import { isClinicCatalogProduct } from '../lib/clinicCatalog';
import type { CatalogUnitRequest } from '../lib/resolution/catalogResolution';
import {
  defaultClinicCatalogUnitRequest,
  normalizeCatalogUnitRequest,
  type CatalogUnitRuntimeMode
} from './catalogUnitRuntime';

/**
 * Single source of truth for converting recognized input semantics into the
 * request used by calculator, favorites, variant changes and multi-product
 * meals. Explicit user amount/unit always survives product selection.
 */
export function catalogRequestForInput(
  input: CatalogInputIntent,
  product: CatalogProduct | null = null,
  mode: CatalogUnitRuntimeMode = 'standard'
): CatalogUnitRequest {
  const recognized = normalizeCatalogUnitRequest({
    amount: input.amount,
    unit: input.unit,
    unitExplicit: input.unitExplicit
  });

  if (!product || input.amountExplicit || input.unitExplicit) return recognized;

  if (isGenericCatalogProduct(product)) {
    const defaultPortionGrams = genericDefaultPortionGrams(product);
    if (defaultPortionGrams !== null) {
      return { amount: defaultPortionGrams, unit: 'g', unitExplicit: true };
    }
  }

  if (isClinicCatalogProduct(product)) {
    return defaultClinicCatalogUnitRequest(product, mode);
  }

  return recognized;
}
