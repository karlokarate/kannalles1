import type {
  CalibrationDerivation,
  Countability,
  FoodUnit,
  PieceCalibrationV2,
  UnitOptionV2
} from './target-types';

export function deriveGroupCalibration(
  measuredCount: number,
  measuredTotalWeightG: number,
  requestedAmount: number,
  carbohydratesPer100g: number | null
): CalibrationDerivation {
  if (!Number.isInteger(measuredCount) || measuredCount < 2) {
    throw new Error('measuredCount must be an integer >= 2');
  }
  if (!Number.isFinite(measuredTotalWeightG) || measuredTotalWeightG <= 0) {
    throw new Error('measuredTotalWeightG must be > 0');
  }
  if (!Number.isFinite(requestedAmount) || requestedAmount <= 0) {
    throw new Error('requestedAmount must be > 0');
  }

  const unitWeightG = measuredTotalWeightG / measuredCount;
  const carbsPerUnitG = carbohydratesPer100g === null
    ? null
    : unitWeightG * carbohydratesPer100g / 100;
  const requestedTotalWeightG = requestedAmount * unitWeightG;
  const requestedTotalCarbsG = carbohydratesPer100g === null
    ? null
    : requestedTotalWeightG * carbohydratesPer100g / 100;

  return {
    measuredCount,
    measuredTotalWeightG,
    unitWeightG,
    carbsPerUnitG,
    requestedTotalWeightG,
    requestedTotalCarbsG
  };
}

export function chooseDefaultUnitOption(
  options: UnitOptionV2[],
  requestedUnit: FoodUnit,
  unitExplicit: boolean,
  countability: Countability
): UnitOptionV2 | null {
  const viable = options.filter((option) => {
    if (option.unitWeightG !== null) return true;
    return ['g', 'kg', 'ml'].includes(option.unit);
  });

  if (unitExplicit) {
    const exact = viable
      .filter((option) => option.unit === requestedUnit)
      .sort((a, b) => a.priority - b.priority)[0];
    return exact ?? null;
  }

  const smallest = viable
    .filter((option) => option.smallestEdibleUnit)
    .sort((a, b) => a.priority - b.priority)[0];
  if (smallest) return smallest;

  if (countability === 'countable') return null;

  return viable.sort((a, b) => a.priority - b.priority)[0] ?? null;
}

export function calibrationLookupKeys(input: {
  canonicalName: string;
  brandCanonical: string | null;
  barcode: string | null;
  unit: Extract<FoodUnit, 'piece' | 'bar' | 'slice' | 'portion'>;
  allowGenericScope: boolean;
}): string[] {
  const keys: string[] = [];
  if (input.barcode) keys.push(`barcode:${input.barcode}|${input.unit}`);
  keys.push(
    `exact:${input.canonicalName}|${input.brandCanonical ?? ''}|${input.unit}`
  );
  if (input.allowGenericScope) {
    keys.push(`generic:${input.canonicalName}|${input.unit}`);
  }
  return keys;
}

export function selectCalibration(
  calibrations: PieceCalibrationV2[]
): PieceCalibrationV2 | null {
  const active = calibrations.filter((item) => item.active);
  if (!active.length) return null;

  const scopeRank = { barcode: 0, exact_product: 1, generic_food: 2 } as const;
  return active.sort((a, b) => {
    const scope = scopeRank[a.scope] - scopeRank[b.scope];
    if (scope !== 0) return scope;
    const count = b.measurement.measuredCount - a.measurement.measuredCount;
    if (count !== 0) return count;
    return b.updatedAt.localeCompare(a.updatedAt);
  })[0];
}
