import type {
  CalibrationScope,
  FoodUnit,
  LegacyPieceCalibration,
  PieceCalibration
} from '../types';
import { isOffBarcodeInput, normalizeOffBarcode } from './barcode';
import { createId, normalizeText, unitLabels } from './format';
import { isPlausibleCalibration, isPlausibleUnitWeight } from './domainLimits';
import { isValidCarbohydratesPer100 } from './nutrition';

export type CalibratableUnit = Extract<FoodUnit, 'piece' | 'bar' | 'slice' | 'portion'>;

export interface CalibrationLookupInput {
  productName: string;
  brand?: string | null;
  barcode?: string | null;
  unit: FoodUnit;
  allowGenericScope?: boolean;
}

export interface CreateCalibrationInput extends CalibrationLookupInput {
  displayName?: string;
  measuredCount: number;
  measuredTotalWeightG: number;
  carbohydratesPer100g?: number | null;
  scope?: CalibrationScope;
  smallestEdibleUnit?: boolean;
  now?: string;
}

export interface CalibrationDerivation {
  measuredCount: number;
  measuredTotalWeightG: number;
  unitWeightG: number;
  carbsPerUnitG: number | null;
  requestedTotalWeightG: number;
  requestedTotalCarbsG: number | null;
}

export function isCalibratableUnit(unit: FoodUnit): unit is CalibratableUnit {
  return ['piece', 'bar', 'slice', 'portion'].includes(unit);
}

export function canonicalFoodName(value: string): string {
  return normalizeText(value).replace(/[^a-z0-9äöüß]+/g, '-').replace(/^-|-$/g, '');
}

export function canonicalBrand(value: string | null | undefined): string | null {
  const canonical = canonicalFoodName(value ?? '');
  return canonical || null;
}

export function normalizeBarcode(value: string | null | undefined): string | null {
  return isOffBarcodeInput(value) ? normalizeOffBarcode(value) : null;
}

export function calibrationScopeKey(
  scope: CalibrationScope,
  input: Pick<CalibrationLookupInput, 'productName' | 'brand' | 'barcode' | 'unit'>
): string | null {
  if (!isCalibratableUnit(input.unit)) return null;
  const name = canonicalFoodName(input.productName);
  if (!name) return null;
  const barcode = normalizeBarcode(input.barcode);
  const brand = canonicalBrand(input.brand);

  if (scope === 'barcode') return barcode ? `barcode:${barcode}|${input.unit}` : null;
  if (scope === 'exact_product') return `exact:${name}|${brand ?? '-'}|${input.unit}`;
  return `generic:${name}|${input.unit}`;
}

/** Lookup keys from most to least specific, with strict unit isolation. */
export function calibrationLookupKeys(input: CalibrationLookupInput): string[] {
  if (!isCalibratableUnit(input.unit)) return [];
  const keys: string[] = [];
  const barcodeKey = calibrationScopeKey('barcode', input);
  const exactKey = calibrationScopeKey('exact_product', input);
  const genericKey = input.allowGenericScope ? calibrationScopeKey('generic_food', input) : null;
  if (barcodeKey) keys.push(barcodeKey);
  if (exactKey) keys.push(exactKey);
  if (genericKey) keys.push(genericKey);
  return keys;
}

export function deriveGroupCalibration(
  measuredCount: number,
  measuredTotalWeightG: number,
  requestedAmount: number,
  carbohydratesPer100g: number | null
): CalibrationDerivation | null {
  if (measuredCount < 2 || !isPlausibleCalibration(measuredCount, measuredTotalWeightG, requestedAmount)) return null;

  const unitWeightG = measuredTotalWeightG / measuredCount;
  const validCarbs = isValidCarbohydratesPer100(carbohydratesPer100g, '100g');
  const carbsPerUnitG = validCarbs ? unitWeightG * carbohydratesPer100g / 100 : null;
  const requestedTotalWeightG = requestedAmount * unitWeightG;
  const requestedTotalCarbsG = validCarbs
    ? requestedTotalWeightG * carbohydratesPer100g / 100
    : null;

  return {
    measuredCount,
    measuredTotalWeightG,
    unitWeightG,
    carbsPerUnitG,
    requestedTotalWeightG,
    requestedTotalCarbsG
  };
}

export function createPieceCalibration(input: CreateCalibrationInput): PieceCalibration | null {
  if (!isCalibratableUnit(input.unit)) return null;
  const measuredCount = input.measuredCount;
  const measuredTotalWeightG = input.measuredTotalWeightG;
  if (!isPlausibleCalibration(measuredCount, measuredTotalWeightG)) return null;

  const barcode = normalizeBarcode(input.barcode);
  const inferredScope: CalibrationScope = input.scope
    ?? (barcode ? 'barcode' : 'exact_product');
  const scope = inferredScope === 'barcode' && !barcode ? 'exact_product' : inferredScope;
  const scopeKey = calibrationScopeKey(scope, { ...input, barcode });
  if (!scopeKey) return null;

  const canonicalName = canonicalFoodName(input.productName);
  if (!canonicalName) return null;
  const now = input.now ?? new Date().toISOString();
  const derivedUnitWeightG = measuredTotalWeightG / measuredCount;
  const carbsPer100g = input.carbohydratesPer100g ?? null;
  const validCarbs = isValidCarbohydratesPer100(carbsPer100g, '100g');

  return {
    schemaVersion: 2,
    calibrationId: createId(),
    scope,
    scopeKey,
    product: {
      canonicalName,
      displayName: input.displayName?.trim() || input.productName.trim(),
      brandCanonical: canonicalBrand(input.brand),
      barcode
    },
    unit: {
      kind: input.unit,
      label: unitLabels[input.unit],
      smallestEdibleUnit: input.smallestEdibleUnit ?? input.unit !== 'portion'
    },
    measurement: {
      mode: measuredCount > 1 ? 'group_weighing' : 'single_unit',
      measuredCount,
      measuredTotalWeightG
    },
    derivedUnitWeightG,
    nutritionSnapshot: {
      carbohydratesPer100g: validCarbs ? carbsPer100g : null,
      derivedCarbsPerUnitG: validCarbs ? derivedUnitWeightG * carbsPer100g / 100 : null
    },
    createdAt: now,
    updatedAt: now,
    active: true
  };
}

function validIso(value: unknown, fallback: string): string {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) return fallback;
  return new Date(value).toISOString();
}

function isLegacyCalibration(value: unknown): value is LegacyPieceCalibration {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<LegacyPieceCalibration>;
  return typeof candidate.key === 'string'
    && typeof candidate.productName === 'string'
    && typeof candidate.unit === 'string'
    && typeof candidate.weightG === 'number'
    && Number.isFinite(candidate.weightG)
    && candidate.weightG > 0;
}

function isCalibrationScope(value: unknown): value is CalibrationScope {
  return value === 'barcode' || value === 'exact_product' || value === 'generic_food';
}

function isV2Calibration(value: unknown): value is PieceCalibration {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<PieceCalibration>;
  const product = candidate.product as Partial<PieceCalibration['product']> | undefined;
  const unit = candidate.unit as Partial<PieceCalibration['unit']> | undefined;
  const measurement = candidate.measurement as Partial<PieceCalibration['measurement']> | undefined;
  return candidate.schemaVersion === 2
    && typeof candidate.calibrationId === 'string'
    && candidate.calibrationId.length > 0
    && isCalibrationScope(candidate.scope)
    && typeof candidate.scopeKey === 'string'
    && Boolean(product)
    && typeof product?.displayName === 'string'
    && typeof product?.canonicalName === 'string'
    && Boolean(unit)
    && typeof unit?.kind === 'string'
    && Boolean(measurement)
    && Number.isInteger(measurement?.measuredCount)
    && typeof measurement?.measuredTotalWeightG === 'number'
    && Number.isFinite(measurement.measuredTotalWeightG)
    && isPlausibleCalibration(measurement.measuredCount ?? Number.NaN, measurement.measuredTotalWeightG)
    && typeof candidate.derivedUnitWeightG === 'number'
    && Number.isFinite(candidate.derivedUnitWeightG)
    && isPlausibleUnitWeight(candidate.derivedUnitWeightG);
}

/** Migrates one legacy calibration record without changing the proven weight. */
export function normalizeStoredCalibration(value: unknown): PieceCalibration | null {
  const unwrapped = value && typeof value === 'object' && 'value' in value
    ? (value as { value?: unknown }).value
    : value;
  if (isV2Calibration(unwrapped)) {
    if (!isCalibratableUnit(unwrapped.unit.kind)) return null;
    const fallbackTime = new Date().toISOString();
    const canonicalName = canonicalFoodName(
      unwrapped.product.canonicalName || unwrapped.product.displayName
    );
    if (!canonicalName) return null;
    const barcode = normalizeBarcode(unwrapped.product.barcode);
    const brandCanonical = canonicalBrand(unwrapped.product.brandCanonical);
    const scope: CalibrationScope = unwrapped.scope === 'barcode' && !barcode
      ? 'exact_product'
      : unwrapped.scope;
    const scopeKey = calibrationScopeKey(scope, {
      productName: canonicalName,
      brand: brandCanonical,
      barcode,
      unit: unwrapped.unit.kind
    });
    if (!scopeKey) return null;

    const carbohydratesPer100g = unwrapped.nutritionSnapshot?.carbohydratesPer100g;
    const snapshotCarbs = isValidCarbohydratesPer100(carbohydratesPer100g, '100g')
      ? carbohydratesPer100g
      : null;
    const measuredCount = unwrapped.measurement.measuredCount;
    const derivedUnitWeightG = unwrapped.measurement.measuredTotalWeightG / measuredCount;
    const snapshotPerUnit = snapshotCarbs === null
      ? null
      : derivedUnitWeightG * snapshotCarbs / 100;

    return {
      ...unwrapped,
      scope,
      scopeKey,
      product: {
        ...unwrapped.product,
        canonicalName,
        displayName: unwrapped.product.displayName.trim() || canonicalName,
        brandCanonical,
        barcode
      },
      unit: {
        ...unwrapped.unit,
        kind: unwrapped.unit.kind,
        label: unwrapped.unit.label?.trim() || unitLabels[unwrapped.unit.kind],
        smallestEdibleUnit: unwrapped.unit.smallestEdibleUnit ?? unwrapped.unit.kind !== 'portion'
      },
      measurement: {
        ...unwrapped.measurement,
        mode: measuredCount >= 2 ? 'group_weighing' : 'single_unit',
        measuredCount,
        measuredTotalWeightG: unwrapped.measurement.measuredTotalWeightG
      },
      derivedUnitWeightG,
      nutritionSnapshot: {
        carbohydratesPer100g: snapshotCarbs,
        derivedCarbsPerUnitG: snapshotPerUnit
      },
      createdAt: validIso(unwrapped.createdAt, fallbackTime),
      updatedAt: validIso(unwrapped.updatedAt, fallbackTime),
      active: unwrapped.active !== false
    };
  }
  if (!isLegacyCalibration(unwrapped) || !isCalibratableUnit(unwrapped.unit)) return null;

  const updatedAt = validIso(unwrapped.updatedAt, new Date().toISOString());
  const measuredCount = Number.isInteger(unwrapped.measuredPieces) && (unwrapped.measuredPieces ?? 0) > 0
    ? Math.trunc(unwrapped.measuredPieces as number)
    : 1;
  const measuredTotalWeightG = typeof unwrapped.measuredTotalWeightG === 'number'
    && Number.isFinite(unwrapped.measuredTotalWeightG)
    && unwrapped.measuredTotalWeightG > 0
    ? unwrapped.measuredTotalWeightG
    : unwrapped.weightG * measuredCount;
  const barcode = normalizeBarcode(unwrapped.barcode);
  const scope: CalibrationScope = barcode ? 'barcode' : 'exact_product';
  const migrated = createPieceCalibration({
    productName: unwrapped.productName,
    displayName: unwrapped.productName,
    barcode,
    brand: null,
    unit: unwrapped.unit,
    measuredCount,
    measuredTotalWeightG,
    scope,
    now: updatedAt
  });
  if (!migrated) return null;
  return {
    ...migrated,
    calibrationId: `migrated-${canonicalFoodName(unwrapped.key) || createId()}`,
    createdAt: updatedAt,
    updatedAt
  };
}

const scopePriority: Record<CalibrationScope, number> = {
  barcode: 0,
  exact_product: 1,
  generic_food: 2
};

/** Resolve conflicts by scope specificity, sample size, then recency. */
export function selectCalibration(records: PieceCalibration[]): PieceCalibration | null {
  return [...records]
    .filter((record) => record.active && record.derivedUnitWeightG > 0)
    .sort((a, b) => {
      const scopeDelta = scopePriority[a.scope] - scopePriority[b.scope];
      if (scopeDelta !== 0) return scopeDelta;
      const countDelta = b.measurement.measuredCount - a.measurement.measuredCount;
      if (countDelta !== 0) return countDelta;
      return b.updatedAt.localeCompare(a.updatedAt);
    })[0] ?? null;
}

export function calibrationWeight(calibration: PieceCalibration | null | undefined): number | null {
  const value = calibration?.derivedUnitWeightG;
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}
