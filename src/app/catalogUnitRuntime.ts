import type { CatalogProduct } from '../lib/catalog/catalogDomain';
import {
  clinicDefaultRequest,
  directClinicResolution,
  isClinicCatalogProduct
} from '../lib/clinicCatalog';
import type { ClinicCatalogProduct } from '../lib/clinicCatalog';
import { isGenericCatalogProduct } from '../lib/genericFoods';
import {
  toMatchingUnitCalibration
} from '../lib/resolution/catalogCalibration';
import type {
  CatalogCalibrationIdentity,
  CatalogCalibrationUnit,
  CatalogUnitCalibration
} from '../lib/resolution/catalogCalibration';
import { resolveCatalogUnits } from '../lib/resolution/catalogResolution';
import type {
  CatalogUnitRequest,
  CatalogUnitResolution
} from '../lib/resolution/catalogResolution';
import { resolveSmartUnitState } from '../lib/smartUnitPrompt';
import type { SmartUnitPrompt } from '../lib/smartUnitPrompt';
import { findMatchingCatalogCalibrations } from '../lib/userDataStore';

type CatalogUnitRuntimeMode = 'standard' | 'smart';

interface CatalogUnitRuntimeState {
  resolution: CatalogUnitResolution;
  prompt: SmartUnitPrompt | null;
}

const CALIBRATION_UNITS: readonly CatalogCalibrationUnit[] = [
  'piece',
  'bar',
  'slice',
  'portion'
];

/**
 * Canonicalizes only transport-facing request syntax. It never changes an
 * explicit counted unit or invents a serving size.
 */
export function normalizeCatalogUnitRequest(request: CatalogUnitRequest): CatalogUnitRequest {
  return request.unit === 'kg'
    ? { amount: request.amount * 1_000, unit: 'g', unitExplicit: true }
    : request;
}

/**
 * Single identity projection for every catalog-unit calibration call site.
 * Generic scope is available only to the smart overlay, matching the existing
 * persistence contract without broadening normal product matching.
 */
export function catalogCalibrationIdentity(
  product: CatalogProduct,
  mode: CatalogUnitRuntimeMode = 'standard'
): CatalogCalibrationIdentity {
  return {
    catalogProductId: product.productId,
    barcode: /^\d{8,14}$/.test(product.code) ? product.code : null,
    canonicalName: product.displayName,
    brandCanonical: product.brand,
    genericFoodKey: mode === 'smart' && isGenericCatalogProduct(product)
      ? product.code.slice('generic:'.length)
      : null
  };
}

export function catalogCalibrationForUnit(
  product: CatalogProduct,
  unit: CatalogCalibrationUnit,
  mode: CatalogUnitRuntimeMode = 'standard'
): CatalogUnitCalibration | null {
  if (mode === 'standard' && isGenericCatalogProduct(product)) return null;
  return findMatchingCatalogCalibrations(
    catalogCalibrationIdentity(product, mode),
    unit,
    mode === 'smart'
  )[0] ?? null;
}

function catalogProductCalibrations(
  product: CatalogProduct,
  mode: CatalogUnitRuntimeMode = 'standard'
): CatalogUnitCalibration[] {
  if (mode === 'standard' && isGenericCatalogProduct(product)) return [];
  const identity = catalogCalibrationIdentity(product, mode);
  return CALIBRATION_UNITS.flatMap((unit) =>
    findMatchingCatalogCalibrations(identity, unit, mode === 'smart')
  );
}

/**
 * The only application-layer authority that combines catalog evidence,
 * persisted measurements, clinic direct values and the optional smart prompt.
 */
export function resolveCatalogUnitRuntime(
  product: CatalogProduct,
  request: CatalogUnitRequest,
  mode: CatalogUnitRuntimeMode = 'standard',
  promptValueOverride?: string
): CatalogUnitRuntimeState {
  if (isClinicCatalogProduct(product)) {
    const direct = directClinicResolution(product);
    if (direct) return { resolution: direct, prompt: null };
  }

  const calibrations = catalogProductCalibrations(product, mode)
    .map(toMatchingUnitCalibration);
  const baseResolution = resolveCatalogUnits(product, request, calibrations);

  return mode === 'smart'
    ? resolveSmartUnitState(product, request, baseResolution, promptValueOverride)
    : { resolution: baseResolution, prompt: null };
}

export function defaultClinicCatalogUnitRequest(
  product: ClinicCatalogProduct,
  mode: CatalogUnitRuntimeMode = 'standard'
): CatalogUnitRequest {
  const saved = catalogProductCalibrations(product, mode)[0];
  return saved
    ? { amount: 1, unit: saved.unit, unitExplicit: false }
    : clinicDefaultRequest(product);
}
