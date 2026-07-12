export type FoodUnit =
  | 'g' | 'kg' | 'ml'
  | 'piece' | 'bar' | 'slice' | 'portion' | 'package';

export type Countability = 'countable' | 'non_countable' | 'unknown';

export type SearchOutcomeStatus =
  | 'resolved'
  | 'needs_product_choice'
  | 'needs_unit_calibration'
  | 'not_found'
  | 'temporarily_unavailable';

export type CalibrationScope = 'barcode' | 'exact_product' | 'generic_food';

export interface PieceCalibrationV2 {
  schemaVersion: 2;
  calibrationId: string;
  scope: CalibrationScope;
  scopeKey: string;
  product: {
    canonicalName: string;
    displayName: string;
    brandCanonical: string | null;
    barcode: string | null;
  };
  unit: {
    kind: Extract<FoodUnit, 'piece' | 'bar' | 'slice' | 'portion'>;
    label: string;
    smallestEdibleUnit: boolean;
  };
  measurement: {
    mode: 'single_unit' | 'group_weighing';
    measuredCount: number;
    measuredTotalWeightG: number;
  };
  derivedUnitWeightG: number;
  nutritionSnapshot?: {
    carbohydratesPer100g: number | null;
    derivedCarbsPerUnitG: number | null;
  };
  createdAt: string;
  updatedAt: string;
  active: boolean;
}

export type UnitOptionSource =
  | 'user-calibration'
  | 'explicit-single-unit'
  | 'explicit-multipack'
  | 'count-and-net-weight'
  | 'generic-consensus'
  | 'manufacturer-serving'
  | 'single-package'
  | 'package'
  | 'mass'
  | 'volume'
  | 'unresolved';

export interface UnitOptionV2 {
  id: string;
  unit: FoodUnit;
  label: string;
  unitWeightG: number | null;
  source: UnitOptionSource;
  confidence: 'high' | 'medium' | 'low' | 'missing';
  recommended: boolean;
  smallestEdibleUnit: boolean;
  priority: number;
}

export interface CalibrationDerivation {
  measuredCount: number;
  measuredTotalWeightG: number;
  unitWeightG: number;
  carbsPerUnitG: number | null;
  requestedTotalWeightG: number;
  requestedTotalCarbsG: number | null;
}
