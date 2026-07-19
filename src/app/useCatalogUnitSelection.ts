import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type SetStateAction
} from 'react';
import type { CatalogProduct } from '../lib/catalog/catalogDomain';
import type {
  CatalogUnitRequest,
  CatalogUnitResolution
} from '../lib/resolution/catalogResolution';

export interface CatalogUnitSelectionState {
  productKey: string | null;
  optionId: string | null;
}

export function catalogUnitSelectionProductKey(
  product: CatalogProduct | null
): string | null {
  return product ? `${String(product.productId)}|${product.code}` : null;
}

/**
 * Implicit unit requests always follow the resolver recommendation. A local UI
 * selection may be retained only for an explicitly chosen unit, on the same
 * product, and while the selected option still belongs to that unit.
 */
export function resolveCatalogUnitSelection(
  current: CatalogUnitSelectionState,
  productKey: string | null,
  resolution: CatalogUnitResolution | null,
  request: CatalogUnitRequest
): CatalogUnitSelectionState {
  if (!productKey || !resolution) {
    return { productKey, optionId: null };
  }

  const recommended = resolution.selectedOptionId;
  if (!request.unitExplicit || current.productKey !== productKey) {
    return { productKey, optionId: recommended };
  }

  const currentOption = resolution.options.find(
    (option) => option.id === current.optionId
  );
  return currentOption?.unit === request.unit
    ? { productKey, optionId: currentOption.id }
    : { productKey, optionId: recommended };
}

function sameSelection(
  left: CatalogUnitSelectionState,
  right: CatalogUnitSelectionState
): boolean {
  return left.productKey === right.productKey && left.optionId === right.optionId;
}

export function useCatalogUnitSelection(
  product: CatalogProduct | null,
  resolution: CatalogUnitResolution | null,
  request: CatalogUnitRequest
): readonly [string | null, Dispatch<SetStateAction<string | null>>] {
  const productKey = catalogUnitSelectionProductKey(product);
  const [stored, setStored] = useState<CatalogUnitSelectionState>({
    productKey: null,
    optionId: null
  });

  const effective = useMemo(
    () => resolveCatalogUnitSelection(stored, productKey, resolution, request),
    [productKey, request, resolution, stored]
  );

  useEffect(() => {
    setStored((current) => {
      const next = resolveCatalogUnitSelection(
        current,
        productKey,
        resolution,
        request
      );
      return sameSelection(current, next) ? current : next;
    });
  }, [productKey, request, resolution]);

  const setSelectedOptionId = useCallback<Dispatch<SetStateAction<string | null>>>(
    (action) => {
      setStored((current) => {
        const resolved = resolveCatalogUnitSelection(
          current,
          productKey,
          resolution,
          request
        );
        const nextOptionId = typeof action === 'function'
          ? (action as (value: string | null) => string | null)(resolved.optionId)
          : action;
        return { productKey, optionId: nextOptionId };
      });
    },
    [productKey, request, resolution]
  );

  return [effective.optionId, setSelectedOptionId] as const;
}
