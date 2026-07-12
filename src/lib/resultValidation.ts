import {
  ApiResponseMeta as GeneratedApiResponseMetaSchema,
  SearchHit as GeneratedSearchHitSchema
} from '../generated/gateway.zod';
import type {
  ApiResponseMeta,
  CalculationResult,
  Confidence,
  FoodUnit,
  ParsedFoodRequest,
  PortionOption,
  PortionSource,
  ProductSummary,
  SearchHit
} from '../types';
import { unitLabels } from './format';
import { isValidCarbohydratesPer100 } from './nutrition';
import { isOffBarcodeInput, normalizeOffBarcode } from './barcode';
import {
  isPlausibleFoodAmount,
  isPlausibleUnitWeightForUnit,
  MAX_TOTAL_MASS_G,
  MAX_TOTAL_VOLUME_ML
} from './domainLimits';

const FOOD_UNITS = new Set<FoodUnit>([
  'g', 'kg', 'ml', 'piece', 'bar', 'slice', 'portion', 'package'
]);
const CONFIDENCE = new Set<Confidence>(['high', 'medium', 'low', 'missing']);
const PORTION_SOURCES = new Set<PortionSource>([
  'user-calibration',
  'explicit-unit',
  'explicit-multipack',
  'count-and-net-weight',
  'manufacturer-serving',
  'single-package',
  'package',
  'mass',
  'volume',
  'manual',
  'generic-consensus',
  'unresolved'
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isNullableFinite(
  value: unknown,
  minimum = 0,
  strictlyPositive = false,
  maximum = Number.POSITIVE_INFINITY
): value is number | null {
  return value === null || (
    isFiniteNumber(value)
    && (strictlyPositive ? value > minimum : value >= minimum)
    && value <= maximum
  );
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function isFoodUnit(value: unknown): value is FoodUnit {
  return typeof value === 'string' && FOOD_UNITS.has(value as FoodUnit);
}

function isConfidence(value: unknown): value is Confidence {
  return typeof value === 'string' && CONFIDENCE.has(value as Confidence);
}

export function isParsedFoodRequest(value: unknown): value is ParsedFoodRequest {
  if (!isRecord(value) || !isRecord(value.product) || !isRecord(value.amount)) return false;
  return ['parsed', 'needs_clarification', 'unsupported'].includes(String(value.status))
    && typeof value.rawInput === 'string'
    && value.rawInput.length <= 500
    && typeof value.product.name === 'string'
    && value.product.name.length <= 160
    && isNullableString(value.product.brand)
    && isNullableString(value.product.variant)
    && isFiniteNumber(value.amount.value)
    && isFoodUnit(value.amount.unit)
    && isPlausibleFoodAmount(value.amount.value, value.amount.unit)
    && (value.amount.valueExplicit === undefined || typeof value.amount.valueExplicit === 'boolean')
    && (value.amount.unitExplicit === undefined || typeof value.amount.unitExplicit === 'boolean')
    && ['generic_category', 'exact_product', 'barcode'].includes(String(value.resolutionMode))
    && isNullableString(value.barcode)
    && (value.barcode === null || (isOffBarcodeInput(value.barcode) && normalizeOffBarcode(value.barcode) !== null))
    && isNullableString(value.clarificationQuestion)
    && (value.parser === 'local' || value.parser === 'openai');
}

function safeOffImageUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:'
      && url.hostname === 'images.openfoodfacts.org'
      && !url.username
      && !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}

function parseProductSummary(value: unknown): ProductSummary | null {
  if (!isRecord(value)
    || !isNullableString(value.barcode)
    || (value.barcode !== null && !isOffBarcodeInput(value.barcode))
    || typeof value.name !== 'string'
    || !isNullableString(value.brand)
    || !isNullableString(value.imageUrl)
    || !isNullableString(value.packageDescription)
    || !isNullableFinite(value.packageWeightG, 0, true, 100_000)
    || !isNullableString(value.servingDescription)
    || !isNullableFinite(value.servingWeightG, 0, true, 10_000)
    || !Array.isArray(value.categories)
    || !value.categories.every((item) => typeof item === 'string')) return null;
  return {
    ...(value as unknown as ProductSummary),
    imageUrl: safeOffImageUrl(value.imageUrl)
  };
}

export function parseSearchHits(value: unknown): SearchHit[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate) => {
    const record = isRecord(candidate) ? candidate : null;
    if (!record) return [];
    const { api_meta: rawMeta, ...wireHit } = record;
    const parsed = GeneratedSearchHitSchema.safeParse(wireHit);
    if (!parsed.success) return [];
    const parsedMeta = GeneratedApiResponseMetaSchema.safeParse(rawMeta);
    const hit: SearchHit = {
      ...(parsed.data as SearchHit),
      ...(parsedMeta.success ? { api_meta: parsedMeta.data as ApiResponseMeta } : {})
    };
    const image = safeOffImageUrl(hit.image_front_url);
    if (image) return [{ ...hit, image_front_url: image }];
    const { image_front_url: _unsafeImage, ...safe } = hit;
    return [safe];
  });
}

function parsePortionOption(value: unknown): PortionOption | null {
  if (!isRecord(value)
    || typeof value.id !== 'string'
    || !isFoodUnit(value.unit)
    || typeof value.label !== 'string'
    || !(value.weightG === null || (
      isFiniteNumber(value.weightG) && isPlausibleUnitWeightForUnit(value.weightG, value.unit)
    ))
    || !isNullableFinite(value.volumeMl, 0, true, MAX_TOTAL_VOLUME_ML)
    || typeof value.source !== 'string'
    || !PORTION_SOURCES.has(value.source as PortionSource)
    || !isConfidence(value.confidence)
    || typeof value.note !== 'string'
    || typeof value.recommended !== 'boolean'
    || (value.smallestEdibleUnit !== undefined && typeof value.smallestEdibleUnit !== 'boolean')
    || (value.priority !== undefined && !isFiniteNumber(value.priority))) return null;
  return value as unknown as PortionOption;
}

function fallbackPortionOption(unit: FoodUnit, unitWeightG: number | null, confidence: Confidence): PortionOption {
  const source: PortionSource = ['g', 'kg'].includes(unit) ? 'mass' : unit === 'ml' ? 'volume' : 'manual';
  return {
    id: `${unit}:${unitWeightG ?? 'variable'}:migration`,
    unit,
    label: unitLabels[unit],
    weightG: unit === 'g' ? 1 : unit === 'kg' ? 1000 : unitWeightG,
    volumeMl: unit === 'ml' ? 1 : null,
    source,
    confidence: unitWeightG !== null || ['g', 'kg', 'ml'].includes(unit) ? confidence : 'missing',
    note: 'Aus einem älteren lokalen Eintrag übernommen.',
    recommended: true
  };
}

function parseMiddleRange(value: unknown): CalculationResult['middleRange'] | undefined {
  if (value === null) return null;
  if (!isRecord(value)
    || !isFiniteNumber(value.from)
    || !isFiniteNumber(value.to)
    || value.from < 0
    || value.to < value.from
    || value.to > 200) return undefined;
  return { from: value.from, to: value.to };
}

/**
 * Validates untrusted History/session data and returns a UI-safe domain value.
 * Invalid records return null; invalid optional search hits/portion options are
 * isolated without making a neighbouring valid history record unavailable.
 */
export function parseStoredCalculationResult(value: unknown): CalculationResult | null {
  if (!isRecord(value)) return null;
  const request = isParsedFoodRequest(value.request) ? value.request : null;
  const product = parseProductSummary(value.product);
  const middleRange = parseMiddleRange(value.middleRange);
  if (!request
    || !product
    || typeof value.id !== 'string'
    || value.id.length === 0
    || typeof value.createdAt !== 'string'
    || Number.isNaN(Date.parse(value.createdAt))
    || !['exact', 'generic', 'manual'].includes(String(value.mode))
    || !['calculated', 'needs_unit_calibration', 'not_found', 'temporarily_unavailable'].includes(String(value.status))
    || !isNullableFinite(value.carbohydratesG, 0, false, 200_000)
    || (value.basis !== '100g' && value.basis !== '100ml')
    || !(value.carbohydratesPer100 === null || isValidCarbohydratesPer100(value.carbohydratesPer100, value.basis))
    || !isNullableFinite(value.totalMassG, 0, true, MAX_TOTAL_MASS_G)
    || !isNullableFinite(value.totalVolumeMl, 0, true, MAX_TOTAL_VOLUME_ML)
    || !isFiniteNumber(value.amount)
    || !isFoodUnit(value.unit)
    || !(value.unitWeightG === null || (
      isFiniteNumber(value.unitWeightG) && isPlausibleUnitWeightForUnit(value.unitWeightG, value.unit)
    ))
    || !isPlausibleFoodAmount(value.amount, value.unit)
    || (value.countability !== undefined && !['countable', 'non_countable', 'unknown'].includes(String(value.countability)))
    || !isConfidence(value.confidence)
    || typeof value.sourceLabel !== 'string'
    || typeof value.methodLabel !== 'string'
    || !(value.sampleSize === null || (Number.isInteger(value.sampleSize) && (value.sampleSize as number) >= 0 && (value.sampleSize as number) <= 1_000_000))
    || middleRange === undefined
    || !Array.isArray(value.candidates)
    || !Array.isArray(value.notes)
    || !value.notes.every((note) => typeof note === 'string')
    || typeof value.favorite !== 'boolean'
    || (value.portionOptions !== undefined && !Array.isArray(value.portionOptions))
    || (value.selectedPortionId !== undefined && !isNullableString(value.selectedPortionId))) return null;

  const portionOptions = (Array.isArray(value.portionOptions) ? value.portionOptions : [])
    .flatMap((candidate) => {
      const option = parsePortionOption(candidate);
      return option ? [option] : [];
    });
  if (!portionOptions.length) {
    portionOptions.push(fallbackPortionOption(value.unit, value.unitWeightG, value.confidence));
  }
  const selectedPortionId = typeof value.selectedPortionId === 'string'
    && portionOptions.some((option) => option.id === value.selectedPortionId)
    ? value.selectedPortionId
    : (portionOptions.find((option) => option.recommended) ?? portionOptions[0])?.id ?? null;
  const fetchedTimestamp = typeof value.dataFetchedAt === 'string'
    ? Date.parse(value.dataFetchedAt)
    : Number.NaN;
  const dataFetchedAt = Number.isFinite(fetchedTimestamp)
    ? new Date(fetchedTimestamp).toISOString()
    : null;
  const dataCacheAgeMs = isFiniteNumber(value.dataCacheAgeMs) && value.dataCacheAgeMs >= 0
    ? value.dataCacheAgeMs
    : dataFetchedAt
      ? Math.max(0, Date.now() - Date.parse(dataFetchedAt))
      : null;

  return {
    id: value.id,
    createdAt: new Date(value.createdAt).toISOString(),
    request: {
      ...request,
      amount: {
        ...request.amount,
        valueExplicit: request.amount.valueExplicit ?? true,
        unitExplicit: request.amount.unitExplicit ?? true
      }
    },
    product,
    mode: value.mode as CalculationResult['mode'],
    status: value.status as CalculationResult['status'],
    carbohydratesG: value.carbohydratesG,
    carbohydratesPer100: value.carbohydratesPer100,
    basis: value.basis,
    totalMassG: value.totalMassG,
    totalVolumeMl: value.totalVolumeMl,
    unitWeightG: value.unitWeightG,
    amount: value.amount,
    unit: value.unit,
    ...(value.countability === undefined ? {} : { countability: value.countability as CalculationResult['countability'] }),
    confidence: value.confidence,
    sourceLabel: value.sourceLabel,
    methodLabel: value.methodLabel,
    dataFetchedAt,
    dataCacheAgeMs,
    sampleSize: value.sampleSize as number | null,
    middleRange,
    candidates: parseSearchHits(value.candidates),
    notes: value.notes,
    favorite: value.favorite,
    portionOptions,
    selectedPortionId
  };
}
