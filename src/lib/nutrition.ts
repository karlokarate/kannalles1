export type NutritionBasis = '100g' | '100ml';

export const MAX_CARBOHYDRATES_PER_100: Readonly<Record<NutritionBasis, number>> = {
  '100g': 100,
  // Dense syrups can contain more than 100 g of carbohydrate per 100 ml.
  // 200 remains a deliberately generous corruption ceiling, not a target.
  '100ml': 200
};

export function maximumCarbohydratesPer100(basis: NutritionBasis): number {
  return MAX_CARBOHYDRATES_PER_100[basis];
}

export function isValidCarbohydratesPer100(value: unknown, basis: NutritionBasis): value is number {
  return typeof value === 'number'
    && Number.isFinite(value)
    && value >= 0
    && value <= maximumCarbohydratesPer100(basis);
}
