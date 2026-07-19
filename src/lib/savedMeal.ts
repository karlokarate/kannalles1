import type { MealCalculationItem } from './mealCalculation';
import { totalMealCarbohydrates } from './mealCalculation';
import type { SavedMealCalculation } from './userDataStore';

/**
 * Serializes the exact current meal result without rounding. `performedAt`
 * becomes the persisted `createdAt` timestamp because schema v1 already stores
 * a complete ISO date-time there. Every recalculation supplies a fresh value.
 */
export function savedMealFromItems(
  id: string,
  items: readonly MealCalculationItem[],
  performedAt: string
): SavedMealCalculation {
  return {
    schemaVersion: 1,
    id,
    createdAt: performedAt,
    items: items.map((item) => ({
      id: item.id,
      productCode: item.product.code,
      productName: item.product.displayName,
      amount: item.request.amount,
      unit: item.calculation.unit,
      selectedOptionId: item.resolution.selectedOptionId
        ?? item.calculation.provenance.optionId
        ?? '',
      unitBaseValue: item.calculation.unitBaseValue ?? 1,
      carbohydratesG: item.calculation.carbohydratesG ?? 0
    })),
    totalCarbohydratesG: totalMealCarbohydrates(items)
  };
}

export function formatMealPerformedAt(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'Zeitpunkt unbekannt';
  return new Intl.DateTimeFormat('de-DE', {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(date);
}
