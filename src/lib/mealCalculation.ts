import type { CatalogProduct } from './catalog/catalogDomain';
import {
  calculateCatalogCarbohydrates,
  type CatalogCarbohydrateCalculation,
  type CatalogUnitRequest,
  type CatalogUnitResolution
} from './resolution/catalogResolution';

export interface MealCalculationItem {
  id: string;
  product: CatalogProduct;
  request: CatalogUnitRequest;
  resolution: CatalogUnitResolution;
  calculation: CatalogCarbohydrateCalculation;
}

export function createMealCalculationItem(
  id: string,
  product: CatalogProduct,
  request: CatalogUnitRequest,
  resolution: CatalogUnitResolution,
  selectedOptionId: string | null
): MealCalculationItem | null {
  const effectiveResolution = { ...resolution, selectedOptionId };
  const calculation = calculateCatalogCarbohydrates(product, request, effectiveResolution);
  if (calculation.status !== 'calculated' || calculation.carbohydratesG === null) return null;
  return { id, product, request: { ...request }, resolution: effectiveResolution, calculation };
}

export function updateMealCalculationItem(
  item: MealCalculationItem,
  amount: number,
  selectedOptionId = item.resolution.selectedOptionId
): MealCalculationItem {
  if (!Number.isFinite(amount) || amount <= 0 || amount > 10_000) return item;
  const selected = item.resolution.options.find((option) => option.id === selectedOptionId);
  if (!selected || selected.baseValue === null) return item;
  const request: CatalogUnitRequest = { amount, unit: selected.unit, unitExplicit: true };
  return createMealCalculationItem(item.id, item.product, request, item.resolution, selectedOptionId) ?? item;
}

export function totalMealCarbohydrates(items: readonly MealCalculationItem[]): number {
  return items.reduce((total, item) => total + (item.calculation.carbohydratesG ?? 0), 0);
}
