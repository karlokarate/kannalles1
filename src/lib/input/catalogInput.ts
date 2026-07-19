import type { RequestedUnit } from '../resolution/catalogResolution';

/**
 * Single semantic result of one catalog input action. The canonical product
 * query and the user's quantity/unit intent travel together so later product
 * promotion or variant selection cannot reparse a stripped query and lose the
 * original amount.
 */
export interface CatalogInputIntent {
  raw: string;
  catalogQuery: string;
  barcode: string | null;
  amount: number;
  amountExplicit: boolean;
  unit: RequestedUnit;
  unitExplicit: boolean;
}

/** Explicitly creates the no-quantity intent used by catalog browsing. */
export function implicitCatalogInput(catalogQuery: string): CatalogInputIntent {
  return {
    raw: catalogQuery,
    catalogQuery,
    barcode: null,
    amount: 1,
    amountExplicit: false,
    unit: 'g',
    unitExplicit: false
  };
}
