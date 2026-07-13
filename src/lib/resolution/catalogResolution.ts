export type CatalogBasis = 'mass' | 'volume';

export type CatalogCountedUnitKind = 'piece' | 'bar' | 'slice';

export type CatalogUnitKind =
  | 'none'
  | 'mass'
  | 'volume'
  | 'portion'
  | CatalogCountedUnitKind
  | 'package';

export type RequestedUnit =
  | 'g'
  | 'kg'
  | 'ml'
  | 'piece'
  | 'bar'
  | 'slice'
  | 'portion'
  | 'package';

export type CatalogUnitEvidenceSource =
  | 'manufacturer-serving'
  | 'explicit-serving-count'
  | 'explicit-multipack-quantity';

export interface CatalogMeasure {
  baseValue: number;
  basis: CatalogBasis;
}

/**
 * Structured evidence decoded from the production SQLite catalog.
 * No source text is parsed in this layer.
 */
export interface StructuredCatalogUnitEvidence extends CatalogMeasure {
  unitKind: Exclude<CatalogUnitKind, 'none' | 'mass' | 'volume' | 'package'>;
  source: CatalogUnitEvidenceSource;
}

export interface CatalogResolutionProduct {
  id: string | number;
  displayName: string;
  brand: string | null;
  carbohydratesPer100: number;
  carbohydrateBasis: CatalogBasis;
  defaultUnitKind: CatalogUnitKind;
  manufacturerServing: CatalogMeasure | null;
  productQuantity: CatalogMeasure | null;
  unitEvidence: StructuredCatalogUnitEvidence | null;
  hasQualityErrors?: boolean;
}

export type CalibrationScope =
  | 'catalog-product'
  | 'barcode'
  | 'exact-product'
  | 'generic-food';

/**
 * A calibration must already be identity-matched by the local user-data store.
 * Only its measured weight is consumed; stored carbohydrate snapshots are never
 * accepted as calculation authority.
 */
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

export type ResolvedUnitSource =
  | 'user-calibration'
  | 'catalog-explicit-serving-count'
  | 'catalog-explicit-multipack'
  | 'manufacturer-serving'
  | 'product-quantity'
  | 'direct-mass'
  | 'direct-volume'
  | 'unresolved';

export interface ResolvedUnitOption {
  id: string;
  unit: RequestedUnit;
  label: string;
  basis: CatalogBasis;
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
    productId: string;
    optionId: string | null;
    source: ResolvedUnitSource | null;
    basis: CatalogBasis;
  };
}

export interface CatalogEligibility {
  eligible: boolean;
  errors: Array<'missing-name' | 'invalid-carbohydrates'>;
  warnings: Array<'quality-errors-present' | 'invalid-serving-ignored' | 'invalid-product-quantity-ignored' | 'invalid-unit-evidence-ignored'>;
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
  'user-calibration': 10,
  'catalog-explicit-serving-count': 20,
  'catalog-explicit-multipack': 30,
  'manufacturer-serving': 60,
  'product-quantity': 80,
  'direct-mass': 100,
  'direct-volume': 100,
  unresolved: 5
};

const MAX_REQUEST_AMOUNT = 10_000;
const MAX_COUNTED_UNIT_WEIGHT_G = 5_000;
const MAX_TOTAL_BASE_VALUE = 100_000;

function isFinitePositive(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function isCountedUnit(unit: CatalogUnitKind | RequestedUnit): unit is CatalogCountedUnitKind {
  return unit === 'piece' || unit === 'bar' || unit === 'slice';
}

function isCalibratableUnit(unit: RequestedUnit): unit is MatchingUnitCalibration['unit'] {
  return isCountedUnit(unit) || unit === 'portion';
}

function requestedUnitForCatalogKind(kind: CatalogUnitKind): RequestedUnit | null {
  if (kind === 'mass') return 'g';
  if (kind === 'volume') return 'ml';
  if (kind === 'none') return null;
  return kind;
}

function measureIsValid(measure: CatalogMeasure | null, expectedBasis?: CatalogBasis): boolean {
  if (!measure || !isFinitePositive(measure.baseValue) || measure.baseValue > MAX_TOTAL_BASE_VALUE) return false;
  return expectedBasis === undefined || measure.basis === expectedBasis;
}

function unitEvidenceIsValid(evidence: StructuredCatalogUnitEvidence | null, expectedBasis: CatalogBasis): boolean {
  if (!evidence || !measureIsValid(evidence, expectedBasis)) return false;
  if (evidence.unitKind === 'portion') {
    return evidence.source === 'manufacturer-serving'
      && evidence.baseValue <= MAX_COUNTED_UNIT_WEIGHT_G;
  }
  return isCountedUnit(evidence.unitKind)
    && evidence.source !== 'manufacturer-serving'
    && evidence.basis === 'mass'
    && evidence.baseValue <= MAX_COUNTED_UNIT_WEIGHT_G;
}

function carbohydratesAreValid(value: number, basis: CatalogBasis): boolean {
  if (!Number.isFinite(value) || value < 0) return false;
  return basis === 'mass' ? value <= 100 : value <= 200;
}

export function catalogProductEligibility(product: CatalogResolutionProduct): CatalogEligibility {
  const errors: CatalogEligibility['errors'] = [];
  const warnings: CatalogEligibility['warnings'] = [];
  if (!product.displayName.trim()) errors.push('missing-name');
  if (!carbohydratesAreValid(product.carbohydratesPer100, product.carbohydrateBasis)) {
    errors.push('invalid-carbohydrates');
  }
  if (product.hasQualityErrors) warnings.push('quality-errors-present');
  if (product.manufacturerServing && !measureIsValid(product.manufacturerServing, product.carbohydrateBasis)) {
    warnings.push('invalid-serving-ignored');
  }
  if (product.productQuantity && !measureIsValid(product.productQuantity, product.carbohydrateBasis)) {
    warnings.push('invalid-product-quantity-ignored');
  }
  if (product.unitEvidence && !unitEvidenceIsValid(product.unitEvidence, product.carbohydrateBasis)) {
    warnings.push('invalid-unit-evidence-ignored');
  }
  return { eligible: errors.length === 0, errors, warnings };
}

/** Preserve the SQLite order exactly; this layer only removes ineligible rows. */
export function filterEligibleCatalogProducts<T extends CatalogResolutionProduct>(products: readonly T[]): T[] {
  return products.filter((product) => catalogProductEligibility(product).eligible);
}

function deterministicId(unit: RequestedUnit, source: ResolvedUnitSource, baseValue: number | null): string {
  const value = baseValue === null ? 'unknown' : String(baseValue);
  return `${unit}:${source}:${value}`;
}

function makeOption(input: Omit<ResolvedUnitOption, 'id' | 'label' | 'priority' | 'recommended'>): ResolvedUnitOption {
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

function selectCalibration(calibrations: readonly MatchingUnitCalibration[]): MatchingUnitCalibration | null {
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

function sourceForCatalogEvidence(source: CatalogUnitEvidenceSource): ResolvedUnitSource {
  if (source === 'explicit-serving-count') return 'catalog-explicit-serving-count';
  if (source === 'explicit-multipack-quantity') return 'catalog-explicit-multipack';
  return 'manufacturer-serving';
}

function unresolvedOption(unit: RequestedUnit, basis: CatalogBasis): ResolvedUnitOption {
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

function orderOptions(options: ResolvedUnitOption[], selected: ResolvedUnitOption | null): ResolvedUnitOption[] {
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
  product: CatalogResolutionProduct,
  request: CatalogUnitRequest,
  calibrations: readonly MatchingUnitCalibration[] = []
): CatalogUnitResolution {
  const options: ResolvedUnitOption[] = [];
  const basis = product.carbohydrateBasis;

  const selectedCalibration = selectCalibration(calibrations);
  if (basis === 'mass' && selectedCalibration) {
    const value = calibrationWeight(selectedCalibration);
    if (value !== null) {
      addUnique(options, makeOption({
        unit: selectedCalibration.unit,
        basis: 'mass',
        baseValue: value,
        source: 'user-calibration',
        smallestEdibleUnit: isCountedUnit(selectedCalibration.unit),
        note: selectedCalibration.measuredCount >= 2
          ? `Persönlich kalibriert aus ${selectedCalibration.measuredCount} gemeinsam gewogenen Einheiten.`
          : 'Persönlich gemessenes Einzelgewicht.'
      }));
    }
  }

  if (unitEvidenceIsValid(product.unitEvidence, basis) && product.unitEvidence) {
    const unit = requestedUnitForCatalogKind(product.unitEvidence.unitKind);
    if (unit) {
      addUnique(options, makeOption({
        unit,
        basis: product.unitEvidence.basis,
        baseValue: product.unitEvidence.baseValue,
        source: sourceForCatalogEvidence(product.unitEvidence.source),
        smallestEdibleUnit: isCountedUnit(unit),
        note: 'Bewiesene kleinste Einheit aus strukturierten Katalogfeldern.'
      }));
    }
  }

  if (measureIsValid(product.manufacturerServing, basis) && product.manufacturerServing) {
    addUnique(options, makeOption({
      unit: 'portion',
      basis,
      baseValue: product.manufacturerServing.baseValue,
      source: 'manufacturer-serving',
      smallestEdibleUnit: false,
      note: 'Herstellerportion aus dem strukturierten Katalog.'
    }));
  }

  if (measureIsValid(product.productQuantity, basis) && product.productQuantity) {
    addUnique(options, makeOption({
      unit: 'package',
      basis,
      baseValue: product.productQuantity.baseValue,
      source: 'product-quantity',
      smallestEdibleUnit: false,
      note: 'Gesamtmenge der Verkaufspackung.'
    }));
  }

  if (basis === 'mass') {
    addUnique(options, makeOption({ unit: 'g', basis, baseValue: 1, source: 'direct-mass', smallestEdibleUnit: false, note: 'Direkte Gewichtsberechnung.' }));
    addUnique(options, makeOption({ unit: 'kg', basis, baseValue: 1_000, source: 'direct-mass', smallestEdibleUnit: false, note: 'Direkte Gewichtsberechnung.' }));
  } else {
    addUnique(options, makeOption({ unit: 'ml', basis, baseValue: 1, source: 'direct-volume', smallestEdibleUnit: false, note: 'Direkte Volumenberechnung.' }));
  }

  const requestedUnit = request.unit;
  const requestedExisting = options.filter((option) => option.unit === requestedUnit);
  if (request.unitExplicit && requestedExisting.length === 0) {
    addUnique(options, unresolvedOption(requestedUnit, basis));
  }

  const implicitDefault = requestedUnitForCatalogKind(product.defaultUnitKind);
  if (!request.unitExplicit && implicitDefault && !options.some((option) => option.unit === implicitDefault)) {
    addUnique(options, unresolvedOption(implicitDefault, basis));
  }

  let selected: ResolvedUnitOption | null = null;
  let reason: CatalogUnitResolution['reason'] = 'requested-unit-unavailable';

  if (request.unitExplicit) {
    selected = options
      .filter((option) => option.unit === requestedUnit)
      .sort((a, b) => a.priority - b.priority)[0] ?? null;
    reason = 'explicit-unit-preserved';
  } else if (implicitDefault && (isCountedUnit(implicitDefault) || implicitDefault === 'portion')) {
    selected = options
      .filter((option) => option.unit === implicitDefault)
      .sort((a, b) => a.priority - b.priority)[0] ?? null;
    if (selected?.source === 'user-calibration') reason = 'calibration-preferred';
    else if (selected?.smallestEdibleUnit) reason = 'smallest-proven-unit';
    else if (selected?.source === 'manufacturer-serving') reason = 'manufacturer-serving';
  }

  selected ??= options
    .filter((option) => option.source === 'user-calibration' && option.smallestEdibleUnit)
    .sort((a, b) => a.priority - b.priority)[0] ?? null;
  if (selected?.source === 'user-calibration') reason = 'calibration-preferred';

  selected ??= options
    .filter((option) => option.smallestEdibleUnit && option.baseValue !== null)
    .sort((a, b) => a.priority - b.priority || (a.baseValue ?? Infinity) - (b.baseValue ?? Infinity))[0] ?? null;
  if (selected?.smallestEdibleUnit) reason = 'smallest-proven-unit';

  selected ??= options.find((option) => option.source === 'manufacturer-serving') ?? null;
  if (selected?.source === 'manufacturer-serving') reason = 'manufacturer-serving';

  selected ??= options.find((option) => option.source === 'product-quantity') ?? null;
  if (selected?.source === 'product-quantity') reason = 'product-quantity';

  selected ??= options.find((option) => option.source === 'direct-mass' || option.source === 'direct-volume') ?? null;
  if (selected && (selected.source === 'direct-mass' || selected.source === 'direct-volume')) reason = 'direct-basis';

  const selectedNeedsCalibration = selected?.source === 'unresolved' && isCalibratableUnit(selected.unit);
  const status: CatalogUnitResolutionStatus = selectedNeedsCalibration
    ? 'needs_unit_calibration'
    : selected !== null && selected.baseValue !== null
      ? 'resolved'
      : 'not_calculable';
  if (selectedNeedsCalibration && selected && isCountedUnit(selected.unit)) reason = 'countable-weight-missing';

  const ordered = orderOptions(options, selected);
  return {
    status,
    selectedOptionId: selected?.id ?? null,
    options: ordered,
    reason
  };
}

export function calculateCatalogCarbohydrates(
  product: CatalogResolutionProduct,
  request: CatalogUnitRequest,
  resolution: CatalogUnitResolution
): CatalogCarbohydrateCalculation {
  if (!Number.isFinite(request.amount) || request.amount <= 0 || request.amount > MAX_REQUEST_AMOUNT) {
    throw new RangeError('amount must be finite, positive and within the calculation limit');
  }
  const selected = resolution.options.find((option) => option.id === resolution.selectedOptionId) ?? null;
  const baseValue = selected?.baseValue ?? null;
  const basis = product.carbohydrateBasis;
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
      productId: String(product.id),
      optionId: selected?.id ?? null,
      source: selected?.source ?? null,
      basis
    }
  };
}
