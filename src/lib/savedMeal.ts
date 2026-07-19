import type { MealCalculationItem } from './mealCalculation';
import { totalMealCarbohydrates } from './mealCalculation';
import type { SavedMealCalculation } from './userDataStore';

export interface SavedMealTimestamps {
  createdAt: string;
  performedAt: string;
}

/**
 * Serializes the exact current meal result without rounding. `createdAt`
 * identifies the local history record; `performedAt` identifies when the
 * represented calculation was actually carried out or recalculated.
 */
export function savedMealFromItems(
  id: string,
  items: readonly MealCalculationItem[],
  timestamps: SavedMealTimestamps
): SavedMealCalculation {
  return {
    schemaVersion: 2,
    id,
    createdAt: timestamps.createdAt,
    performedAt: timestamps.performedAt,
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
