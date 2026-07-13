import type {
  CalibrationScope,
  MatchingUnitCalibration,
  RequestedUnit
} from './catalogResolution';

export type CatalogCalibrationUnit = Extract<RequestedUnit, 'piece' | 'bar' | 'slice' | 'portion'>;

export interface CatalogCalibrationIdentity {
  catalogProductId: string | number | null;
  barcode: string | null;
  canonicalName: string;
  brandCanonical: string | null;
  genericFoodKey: string | null;
}

export interface CreateCatalogCalibrationInput {
  calibrationId: string;
  scope: CalibrationScope;
  identity: CatalogCalibrationIdentity;
  unit: CatalogCalibrationUnit;
  measuredCount: number;
  measuredTotalWeightG: number;
  smallestEdibleUnit: boolean;
  now: string;
}

/**
 * Catalog-native calibration record. Nutrition snapshots are deliberately absent:
 * measured weight is reusable evidence, carbohydrate values are not.
 */
export interface CatalogUnitCalibration {
  schemaVersion: 3;
  calibrationId: string;
  scope: CalibrationScope;
  scopeKey: string;
  identity: CatalogCalibrationIdentity;
  unit: CatalogCalibrationUnit;
  smallestEdibleUnit: boolean;
  measurement: {
    mode: 'single-unit' | 'group-weighing';
    measuredCount: number;
    measuredTotalWeightG: number;
  };
  derivedUnitWeightG: number;
  createdAt: string;
  updatedAt: string;
  active: boolean;
}

export interface CalibrationDerivation {
  measuredCount: number;
  measuredTotalWeightG: number;
  unitWeightG: number;
  carbsPerUnitG: number | null;
  requestedAmount: number;
  requestedTotalWeightG: number;
  requestedTotalCarbsG: number | null;
}

const MAX_MEASURED_COUNT = 10_000;
const MAX_UNIT_WEIGHT_G = 5_000;
const MAX_TOTAL_WEIGHT_G = 100_000;
const MAX_REQUESTED_AMOUNT = 10_000;

function isPositiveFinite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function canonicalToken(value: string): string {
  return value
    .normalize('NFKC')
    .trim()
    .toLocaleLowerCase('de-DE')
    .replace(/[^a-z0-9äöüß]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function normalizeNullableToken(value: string | null): string | null {
  if (value === null) return null;
  const normalized = canonicalToken(value);
  return normalized || null;
}

function normalizeBarcode(value: string | null): string | null {
  if (value === null) return null;
  const digits = value.replace(/\D/g, '');
  return digits.length >= 8 && digits.length <= 14 ? digits : null;
}

function normalizedIdentity(identity: CatalogCalibrationIdentity): CatalogCalibrationIdentity | null {
  const canonicalName = canonicalToken(identity.canonicalName);
  if (!canonicalName) return null;
  const catalogProductId = identity.catalogProductId === null
    ? null
    : String(identity.catalogProductId).trim() || null;
  return {
    catalogProductId,
    barcode: normalizeBarcode(identity.barcode),
    canonicalName,
    brandCanonical: normalizeNullableToken(identity.brandCanonical),
    genericFoodKey: normalizeNullableToken(identity.genericFoodKey)
  };
}

function validMeasurement(measuredCount: number, measuredTotalWeightG: number): boolean {
  if (!Number.isInteger(measuredCount) || measuredCount < 1 || measuredCount > MAX_MEASURED_COUNT) return false;
  if (!isPositiveFinite(measuredTotalWeightG) || measuredTotalWeightG > MAX_TOTAL_WEIGHT_G) return false;
  const unitWeight = measuredTotalWeightG / measuredCount;
  return unitWeight <= MAX_UNIT_WEIGHT_G;
}

function validCarbohydratesPer100(value: number | null): value is number {
  return value !== null && Number.isFinite(value) && value >= 0 && value <= 100;
}

function validTimestamp(value: string): boolean {
  return value.length > 0 && Number.isFinite(Date.parse(value));
}

export function catalogCalibrationScopeKey(
  scope: CalibrationScope,
  identity: CatalogCalibrationIdentity,
  unit: CatalogCalibrationUnit
): string | null {
  const normalized = normalizedIdentity(identity);
  if (!normalized) return null;
  if (scope === 'catalog-product') {
    return normalized.catalogProductId === null
      ? null
      : `catalog:${normalized.catalogProductId}|${unit}`;
  }
  if (scope === 'barcode') {
    return normalized.barcode === null ? null : `barcode:${normalized.barcode}|${unit}`;
  }
  if (scope === 'exact-product') {
    return `exact:${normalized.canonicalName}|${normalized.brandCanonical ?? '-'}|${unit}`;
  }
  return normalized.genericFoodKey === null
    ? null
    : `generic:${normalized.genericFoodKey}|${unit}`;
}

/** Lookup keys are strict by unit and ordered from product-specific to generic. */
export function catalogCalibrationLookupKeys(
  identity: CatalogCalibrationIdentity,
  unit: CatalogCalibrationUnit,
  allowGenericScope: boolean
): string[] {
  const keys: string[] = [];
  for (const scope of ['catalog-product', 'barcode', 'exact-product'] as const) {
    const key = catalogCalibrationScopeKey(scope, identity, unit);
    if (key) keys.push(key);
  }
  if (allowGenericScope) {
    const generic = catalogCalibrationScopeKey('generic-food', identity, unit);
    if (generic) keys.push(generic);
  }
  return keys;
}

export function deriveCatalogCalibration(
  measuredCount: number,
  measuredTotalWeightG: number,
  requestedAmount: number,
  currentCarbohydratesPer100g: number | null
): CalibrationDerivation | null {
  if (!validMeasurement(measuredCount, measuredTotalWeightG)) return null;
  if (!isPositiveFinite(requestedAmount) || requestedAmount > MAX_REQUESTED_AMOUNT) return null;

  const unitWeightG = measuredTotalWeightG / measuredCount;
  const requestedTotalWeightG = requestedAmount * unitWeightG;
  if (requestedTotalWeightG > MAX_TOTAL_WEIGHT_G) return null;
  const validCarbs = validCarbohydratesPer100(currentCarbohydratesPer100g);
  return {
    measuredCount,
    measuredTotalWeightG,
    unitWeightG,
    carbsPerUnitG: validCarbs ? unitWeightG * currentCarbohydratesPer100g / 100 : null,
    requestedAmount,
    requestedTotalWeightG,
    requestedTotalCarbsG: validCarbs
      ? requestedTotalWeightG * currentCarbohydratesPer100g / 100
      : null
  };
}

export function deriveGroupCalibration(
  measuredCount: number,
  measuredTotalWeightG: number,
  requestedAmount: number,
  currentCarbohydratesPer100g: number | null
): CalibrationDerivation | null {
  if (measuredCount < 2) return null;
  return deriveCatalogCalibration(
    measuredCount,
    measuredTotalWeightG,
    requestedAmount,
    currentCarbohydratesPer100g
  );
}

export function createCatalogCalibration(
  input: CreateCatalogCalibrationInput
): CatalogUnitCalibration | null {
  if (!input.calibrationId.trim() || !validTimestamp(input.now)) return null;
  if (!validMeasurement(input.measuredCount, input.measuredTotalWeightG)) return null;
  const identity = normalizedIdentity(input.identity);
  if (!identity) return null;
  const scopeKey = catalogCalibrationScopeKey(input.scope, identity, input.unit);
  if (!scopeKey) return null;

  return {
    schemaVersion: 3,
    calibrationId: input.calibrationId.trim(),
    scope: input.scope,
    scopeKey,
    identity,
    unit: input.unit,
    smallestEdibleUnit: input.smallestEdibleUnit && input.unit !== 'portion',
    measurement: {
      mode: input.measuredCount >= 2 ? 'group-weighing' : 'single-unit',
      measuredCount: input.measuredCount,
      measuredTotalWeightG: input.measuredTotalWeightG
    },
    derivedUnitWeightG: input.measuredTotalWeightG / input.measuredCount,
    createdAt: new Date(input.now).toISOString(),
    updatedAt: new Date(input.now).toISOString(),
    active: true
  };
}

function isCalibrationScope(value: unknown): value is CalibrationScope {
  return value === 'catalog-product'
    || value === 'barcode'
    || value === 'exact-product'
    || value === 'generic-food';
}

function isCalibrationUnit(value: unknown): value is CatalogCalibrationUnit {
  return value === 'piece' || value === 'bar' || value === 'slice' || value === 'portion';
}

/** Hard cutover: only schema v3 records are accepted; legacy records are not migrated here. */
export function normalizeCatalogCalibration(value: unknown): CatalogUnitCalibration | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<CatalogUnitCalibration>;
  if (candidate.schemaVersion !== 3
    || typeof candidate.calibrationId !== 'string'
    || !isCalibrationScope(candidate.scope)
    || !isCalibrationUnit(candidate.unit)
    || typeof candidate.smallestEdibleUnit !== 'boolean'
    || !candidate.identity
    || !candidate.measurement
    || typeof candidate.createdAt !== 'string'
    || typeof candidate.updatedAt !== 'string'
    || !validTimestamp(candidate.createdAt)
    || !validTimestamp(candidate.updatedAt)
    || typeof candidate.active !== 'boolean'
  ) return null;

  const identity = normalizedIdentity(candidate.identity);
  if (!identity) return null;
  const measuredCount = candidate.measurement.measuredCount;
  const measuredTotalWeightG = candidate.measurement.measuredTotalWeightG;
  if (!validMeasurement(measuredCount, measuredTotalWeightG)) return null;
  const scopeKey = catalogCalibrationScopeKey(candidate.scope, identity, candidate.unit);
  if (!scopeKey) return null;

  return {
    schemaVersion: 3,
    calibrationId: candidate.calibrationId.trim(),
    scope: candidate.scope,
    scopeKey,
    identity,
    unit: candidate.unit,
    smallestEdibleUnit: candidate.smallestEdibleUnit && candidate.unit !== 'portion',
    measurement: {
      mode: measuredCount >= 2 ? 'group-weighing' : 'single-unit',
      measuredCount,
      measuredTotalWeightG
    },
    derivedUnitWeightG: measuredTotalWeightG / measuredCount,
    createdAt: new Date(candidate.createdAt).toISOString(),
    updatedAt: new Date(candidate.updatedAt).toISOString(),
    active: candidate.active
  };
}

const SCOPE_PRIORITY: Record<CalibrationScope, number> = {
  'catalog-product': 0,
  barcode: 1,
  'exact-product': 2,
  'generic-food': 3
};

export function selectCatalogCalibration(
  records: readonly CatalogUnitCalibration[]
): CatalogUnitCalibration | null {
  return [...records]
    .filter((record) => record.active && validMeasurement(
      record.measurement.measuredCount,
      record.measurement.measuredTotalWeightG
    ))
    .sort((a, b) => {
      const scope = SCOPE_PRIORITY[a.scope] - SCOPE_PRIORITY[b.scope];
      if (scope !== 0) return scope;
      const sample = b.measurement.measuredCount - a.measurement.measuredCount;
      if (sample !== 0) return sample;
      return b.updatedAt.localeCompare(a.updatedAt);
    })[0] ?? null;
}

export function toMatchingUnitCalibration(
  record: CatalogUnitCalibration
): MatchingUnitCalibration {
  return {
    calibrationId: record.calibrationId,
    scope: record.scope,
    unit: record.unit,
    measuredCount: record.measurement.measuredCount,
    measuredTotalWeightG: record.measurement.measuredTotalWeightG,
    updatedAt: record.updatedAt,
    active: record.active
  };
}
