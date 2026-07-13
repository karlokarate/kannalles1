import type {
  CatalogMeasure,
  CatalogNutritionBasis,
  CatalogProduct,
  CatalogUnitEvidence,
  CatalogUnitEvidenceSource,
  CatalogUnitKind
} from '../catalog/catalogDomain';

type CountedUnitKind = Extract<CatalogUnitKind, 'piece' | 'bar' | 'slice'>;

export type RequestedUnit =
  | 'g'
  | 'kg'
  | 'ml'
  | 'piece'
  | 'bar'
  | 'slice'
  | 'portion'
  | 'package';

export type CalibrationScope =
  | 'catalog-product'
  | 'barcode'
  | 'exact-product'
  | 'generic-food';

/** Identity matching is owned by the local user-data store. */
export interface MatchingUnitCalibration {
  calibrationId: string;
  scope: CalibrationScope;
  unit: Extract<RequestedUnit, 'piece' | 'bar' | 'slice' | 'portion'>;
  measuredCount: number;
  measuredTotalWeightG: number;
  updatedAt: string;
  active: boolean;
}

export interface CatalogUnitRequest {
  amount: number;
  unit: RequestedUnit;
  unitExplicit: boolean;
}

/** Catalog evidence values are Atlas' frozen vocabulary without aliases. */
export type ResolvedUnitSource =
  | CatalogUnitEvidenceSource
  | 'user_calibration'
  | 'product_quantity'
  | 'direct_mass'
  | 'direct_volume'
  | 'unresolved';

export interface ResolvedUnitOption {
  id: string;
  unit: RequestedUnit;
  label: string;
  basis: CatalogNutritionBasis;
  /** Grams for mass-based options and millilitres for volume-based options. */
  baseValue: number | null;
  source: ResolvedUnitSource;
  recommended: boolean;
  smallestEdibleUnit: boolean;
  priority: number;
  note: string;
}

export type CatalogUnitResolutionStatus =
  | 'resolved'
  | 'needs_unit_calibration'
  | 'not_calculable';

export interface CatalogUnitResolution {
  status: CatalogUnitResolutionStatus;
  selectedOptionId: string | null;
  options: ResolvedUnitOption[];
  reason:
    | 'explicit-unit-preserved'
    | 'smallest-proven-unit'
    | 'calibration-preferred'
    | 'manufacturer-serving'
    | 'product-quantity'
    | 'direct-basis'
    | 'countable-weight-missing'
    | 'requested-unit-unavailable';
}

export interface CatalogCarbohydrateCalculation {
  status: 'calculated' | 'needs_unit_calibration' | 'not_calculable';
  carbohydratesG: number | null;
  totalMassG: number | null;
  totalVolumeMl: number | null;
  amount: number;
  unit: RequestedUnit;
  unitBaseValue: number | null;
  provenance: {
    productId: number;
    optionId: string | null;
    source: ResolvedUnitSource | null;
    basis: CatalogNutritionBasis;
  };
}

export interface CatalogEligibility {
  eligible: boolean;
  errors: Array<'missing-name' | 'invalid-carbohydrates'>;
  warnings: Array<
    | 'quality-errors-present'
    | 'invalid-serving-ignored'
    | 'invalid-product-quantity-ignored'
    | 'invalid-unit-evidence-ignored'
  >;
}

const UNIT_LABELS: Record<RequestedUnit, string> = {
  g: 'Gramm',
  kg: 'Kilogramm',
  ml: 'Milliliter',
  piece: 'Stück',
  bar: 'Riegel',
  slice: 'Scheibe',
  portion: 'Portion',
  package: 'Packung'
};

const SCOPE_PRIORITY: Record<CalibrationScope, number> = {
  'catalog-product': 0,
  barcode: 1,
  'exact-product': 2,
  'generic-food': 3
};

const SOURCE_PRIORITY: Record<ResolvedUnitSource, number> = {
  user_calibration: 10,
  explicit_serving_count: 20,
  explicit_multipack_quantity: 30,
  manufacturer_serving: 60,
  product_quantity: 80,
  direct_mass: 100,
  direct_volume: 100,
  unresolved: 5
};

const MAX_REQUEST_AMOUNT = 10_000;
const MAX_COUNTED_UNIT_WEIGHT_G = 5_000;
const MAX_TOTAL_BASE_VALUE = 100_000;

function isFinitePositive(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function isCountedUnit(unit: CatalogUnitKind | RequestedUnit): unit is CountedUnitKind {
  return unit === 'piece' || unit === 'bar' || unit === 'slice';
}

function isCalibratableUnit(unit: RequestedUnit): unit is MatchingUnitCalibration['unit'] {
  return isCountedUnit(unit) || unit === 'portion';
}

function requestedUnitForCatalogKind(kind: CatalogUnitKind): RequestedUnit {
  if (kind === 'mass') return 'g';
  if (kind === 'volume') return 'ml';
  return kind;
}

function measureIsValid(
  measure: CatalogMeasure | null,
  expectedBasis?: CatalogNutritionBasis
): boolean {
  if (!measure || !isFinitePositive(measure.value) || measure.value > MAX_TOTAL_BASE_VALUE) {
    return false;
  }
  return expectedBasis === undefined || measure.basis === expectedBasis;
}

function unitEvidenceIsValid(
  evidence: CatalogUnitEvidence | null,
  expectedBasis: CatalogNutritionBasis
): boolean {
  if (!evidence || evidence.proven !== true || !measureIsValid(evidence, expectedBasis)) {
    return false;
  }
  if (evidence.kind === 'portion') {
    return evidence.source === 'manufacturer_serving'
      && evidence.value <= MAX_COUNTED_UNIT_WEIGHT_G;
  }
  return isCountedUnit(evidence.kind)
    && evidence.countability === 'countable'
    && evidence.source !== 'manufacturer_serving'
    && evidence.basis === 'mass'
    && evidence.value <= MAX_COUNTED_UNIT_WEIGHT_G;
}

function carbohydratesAreValid(value: number, basis: CatalogNutritionBasis): boolean {
  if (!Number.isFinite(value) || value < 0) return false;
  return basis === 'mass' ? value <= 100 : value <= 200;
}

export function catalogProductEligibility(product: CatalogProduct): CatalogEligibility {
  const errors: CatalogEligibility['errors'] = [];
  const warnings: CatalogEligibility['warnings'] = [];
  if (!product.displayName.trim()) errors.push('missing-name');
  if (!carbohydratesAreValid(product.carbohydratesPer100, product.nutritionBasis)) {
    errors.push('invalid-carbohydrates');
  }
  if (product.hasQualityErrors) warnings.push('quality-errors-present');
  if (product.manufacturerServing && !measureIsValid(product.manufacturerServing, product.nutritionBasis)) {
    warnings.push('invalid-serving-ignored');
  }
  if (product.productQuantity && !measureIsValid(product.productQuantity, product.nutritionBasis)) {
    warnings.push('invalid-product-quantity-ignored');
  }
  if (product.provenUnit && !unitEvidenceIsValid(product.provenUnit, product.nutritionBasis)) {
    warnings.push('invalid-unit-evidence-ignored');
  }
  return { eligible: errors.length === 0, errors, warnings };
}

/** Preserve SQLite order exactly; this layer only removes ineligible rows. */
export function filterEligibleCatalogProducts<T extends CatalogProduct>(products: readonly T[]): T[] {
  return products.filter((product) => catalogProductEligibility(product).eligible);
}

function deterministicId(
  unit: RequestedUnit,
  source: ResolvedUnitSource,
  baseValue: number | null
): string {
  return `${unit}:${source}:${baseValue === null ? 'unknown' : String(baseValue)}`;
}

function makeOption(
  input: Omit<ResolvedUnitOption, 'id' | 'label' | 'priority' | 'recommended'>
): ResolvedUnitOption {
  return {
    ...input,
    id: deterministicId(input.unit, input.source, input.baseValue),
    label: UNIT_LABELS[input.unit],
    priority: SOURCE_PRIORITY[input.source],
    recommended: false
  };
}

function calibrationWeight(calibration: MatchingUnitCalibration): number | null {
  if (!calibration.active) return null;
  if (!Number.isInteger(calibration.measuredCount) || calibration.measuredCount < 1) return null;
  if (!isFinitePositive(calibration.measuredTotalWeightG)) return null;
  const weight = calibration.measuredTotalWeightG / calibration.measuredCount;
  return weight <= MAX_COUNTED_UNIT_WEIGHT_G ? weight : null;
}

function selectCalibration(
  calibrations: readonly MatchingUnitCalibration[]
): MatchingUnitCalibration | null {
  return [...calibrations]
    .filter((item) => calibrationWeight(item) !== null)
    .sort((a, b) => {
      const scope = SCOPE_PRIORITY[a.scope] - SCOPE_PRIORITY[b.scope];
      if (scope !== 0) return scope;
      const sample = b.measuredCount - a.measuredCount;
      if (sample !== 0) return sample;
      return b.updatedAt.localeCompare(a.updatedAt);
    })[0] ?? null;
}

function addUnique(options: ResolvedUnitOption[], option: ResolvedUnitOption): void {
  const duplicate = options.some((candidate) =>
    candidate.unit === option.unit
    && candidate.source === option.source
    && candidate.basis === option.basis
    && candidate.baseValue === option.baseValue
  );
  if (!duplicate) options.push(option);
}

function unresolvedOption(
  unit: RequestedUnit,
  basis: CatalogNutritionBasis
): ResolvedUnitOption {
  return makeOption({
    unit,
    basis,
    baseValue: null,
    source: 'unresolved',
    smallestEdibleUnit: isCountedUnit(unit),
    note: isCountedUnit(unit)
      ? `Für ${UNIT_LABELS[unit]} liegt kein bewiesenes Einzelgewicht vor.`
      : `Für ${UNIT_LABELS[unit]} liegt keine passende strukturierte Mengenangabe vor.`
  });
}

function orderOptions(
  options: ResolvedUnitOption[],
  selected: ResolvedUnitOption | null
): ResolvedUnitOption[] {
  if (selected) selected.recommended = true;
  const group = (option: ResolvedUnitOption): number => {
    if (option.recommended) return -1;
    if (option.smallestEdibleUnit) return 0;
    if (option.unit === 'portion') return 1;
    if (option.unit === 'package') return 2;
    return 3;
  };
  return [...options].sort((a, b) =>
    group(a) - group(b)
    || a.priority - b.priority
    || (a.baseValue ?? Number.POSITIVE_INFINITY) - (b.baseValue ?? Number.POSITIVE_INFINITY)
    || a.id.localeCompare(b.id)
  );
}

export function resolveCatalogUnits(
  product: CatalogProduct,
  request: CatalogUnitRequest,
  calibrations: readonly MatchingUnitCalibration[] = []
): CatalogUnitResolution {
  const options: ResolvedUnitOption[] = [];
  const basis = product.nutritionBasis;

  const selectedCalibration = selectCalibration(calibrations);
  if (basis === 'mass' && selectedCalibration) {
    const value = calibrationWeight(selectedCalibration);
    if (value !== null) {
      addUnique(options, makeOption({
        unit: selectedCalibration.unit,
        basis: 'mass',
        baseValue: value,
        source: 'user_calibration',
        smallestEdibleUnit: isCountedUnit(selectedCalibration.unit),
        note: selectedCalibration.measuredCount >= 2
          ? `Persönlich kalibriert aus ${selectedCalibration.measuredCount} gemeinsam gewogenen Einheiten.`
          : 'Persönlich gemessenes Einzelgewicht.'
      }));
    }
  }

  if (unitEvidenceIsValid(product.provenUnit, basis) && product.provenUnit) {
    const unit = requestedUnitForCatalogKind(product.provenUnit.kind);
    addUnique(options, makeOption({
      unit,
      basis: product.provenUnit.basis,
      baseValue: product.provenUnit.value,
      source: product.provenUnit.source,
      smallestEdibleUnit: product.provenUnit.smallestEdibleUnit,
      note: 'Bewiesene Einheit aus strukturierten Katalogfeldern.'
    }));
  }

  if (measureIsValid(product.manufacturerServing, basis) && product.manufacturerServing) {
    addUnique(options, makeOption({
      unit: 'portion',
      basis,
      baseValue: product.manufacturerServing.value,
      source: 'manufacturer_serving',
      smallestEdibleUnit: false,
      note: 'Herstellerportion aus dem strukturierten Katalog.'
    }));
  }

  if (measureIsValid(product.productQuantity, basis) && product.productQuantity) {
    addUnique(options, makeOption({
      unit: 'package',
      basis,
      baseValue: product.productQuantity.value,
      source: 'product_quantity',
      smallestEdibleUnit: false,
      note: 'Gesamtmenge der Verkaufspackung.'
    }));
  }

  if (basis === 'mass') {
    addUnique(options, makeOption({
      unit: 'g', basis, baseValue: 1, source: 'direct_mass', smallestEdibleUnit: false,
      note: 'Direkte Gewichtsberechnung.'
    }));
    addUnique(options, makeOption({
      unit: 'kg', basis, baseValue: 1_000, source: 'direct_mass', smallestEdibleUnit: false,
      note: 'Direkte Gewichtsberechnung.'
    }));
  } else {
    addUnique(options, makeOption({
      unit: 'ml', basis, baseValue: 1, source: 'direct_volume', smallestEdibleUnit: false,
      note: 'Direkte Volumenberechnung.'
    }));
  }

  const requestedExisting = options.filter((option) => option.unit === request.unit);
  if (request.unitExplicit && requestedExisting.length === 0) {
    addUnique(options, unresolvedOption(request.unit, basis));
  }

  const implicitDefault = requestedUnitForCatalogKind(product.defaultUnitKind);
  if (!request.unitExplicit && !options.some((option) => option.unit === implicitDefault)) {
    addUnique(options, unresolvedOption(implicitDefault, basis));
  }

  let selected: ResolvedUnitOption | null = null;
  let reason: CatalogUnitResolution['reason'] = 'requested-unit-unavailable';

  if (request.unitExplicit) {
    selected = options
      .filter((option) => option.unit === request.unit)
      .sort((a, b) => a.priority - b.priority)[0] ?? null;
    reason = 'explicit-unit-preserved';
  } else if (isCountedUnit(implicitDefault) || implicitDefault === 'portion') {
    selected = options
      .filter((option) => option.unit === implicitDefault)
      .sort((a, b) => a.priority - b.priority)[0] ?? null;
    if (selected?.source === 'user_calibration') reason = 'calibration-preferred';
    else if (selected?.smallestEdibleUnit) reason = 'smallest-proven-unit';
    else if (selected?.source === 'manufacturer_serving') reason = 'manufacturer-serving';
  }

  selected ??= options
    .filter((option) => option.source === 'user_calibration' && option.smallestEdibleUnit)
    .sort((a, b) => a.priority - b.priority)[0] ?? null;
  if (selected?.source === 'user_calibration') reason = 'calibration-preferred';

  selected ??= options
    .filter((option) => option.smallestEdibleUnit && option.baseValue !== null)
    .sort((a, b) =>
      a.priority - b.priority
      || (a.baseValue ?? Number.POSITIVE_INFINITY) - (b.baseValue ?? Number.POSITIVE_INFINITY)
    )[0] ?? null;
  if (selected?.smallestEdibleUnit) reason = 'smallest-proven-unit';

  selected ??= options.find((option) => option.source === 'manufacturer_serving') ?? null;
  if (selected?.source === 'manufacturer_serving') reason = 'manufacturer-serving';

  selected ??= options.find((option) => option.source === 'product_quantity') ?? null;
  if (selected?.source === 'product_quantity') reason = 'product-quantity';

  selected ??= options.find((option) =>
    option.source === 'direct_mass' || option.source === 'direct_volume'
  ) ?? null;
  if (selected && (selected.source === 'direct_mass' || selected.source === 'direct_volume')) {
    reason = 'direct-basis';
  }

  const selectedNeedsCalibration = selected?.source === 'unresolved'
    && isCalibratableUnit(selected.unit);
  const status: CatalogUnitResolutionStatus = selectedNeedsCalibration
    ? 'needs_unit_calibration'
    : selected !== null && selected.baseValue !== null
      ? 'resolved'
      : 'not_calculable';
  if (selectedNeedsCalibration && selected && isCountedUnit(selected.unit)) {
    reason = 'countable-weight-missing';
  }

  const ordered = orderOptions(options, selected);
  return {
    status,
    selectedOptionId: selected?.id ?? null,
    options: ordered,
    reason
  };
}

export function calculateCatalogCarbohydrates(
  product: CatalogProduct,
  request: CatalogUnitRequest,
  resolution: CatalogUnitResolution
): CatalogCarbohydrateCalculation {
  if (!Number.isFinite(request.amount) || request.amount <= 0 || request.amount > MAX_REQUEST_AMOUNT) {
    throw new RangeError('amount must be finite, positive and within the calculation limit');
  }
  const selected = resolution.options.find((option) =>
    option.id === resolution.selectedOptionId
  ) ?? null;
  const baseValue = selected?.baseValue ?? null;
  const basis = product.nutritionBasis;
  const calculable = selected !== null
    && baseValue !== null
    && selected.basis === basis
    && carbohydratesAreValid(product.carbohydratesPer100, basis);

  const totalBase = calculable ? request.amount * baseValue : null;
  const carbohydratesG = totalBase === null
    ? null
    : totalBase * product.carbohydratesPer100 / 100;

  return {
    status: calculable
      ? 'calculated'
      : resolution.status === 'needs_unit_calibration'
        ? 'needs_unit_calibration'
        : 'not_calculable',
    carbohydratesG,
    totalMassG: calculable && basis === 'mass' ? totalBase : null,
    totalVolumeMl: calculable && basis === 'volume' ? totalBase : null,
    amount: request.amount,
    unit: selected?.unit ?? request.unit,
    unitBaseValue: baseValue,
    provenance: {
      productId: product.productId,
      optionId: selected?.id ?? null,
      source: selected?.source ?? null,
      basis
    }
  };
}
