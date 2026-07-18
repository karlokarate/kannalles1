import type { CatalogProduct } from '../lib/catalog/catalogDomain';
import {
  clinicDefaultRequest,
  directClinicResolution,
  isClinicCatalogProduct
} from '../lib/clinicCatalog';
import type { ClinicCatalogProduct } from '../lib/clinicCatalog';
import { isGenericCatalogProduct } from '../lib/genericFoods';
import {
  selectCatalogCalibration,
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
  CatalogUnitResolution,
  RequestedUnit,
  ResolvedUnitOption
} from '../lib/resolution/catalogResolution';
import { normalizeCatalogUnitRequest } from '../lib/resolution/catalogUnitRequest';
import { resolveSmartUnitState } from '../lib/smartUnitPrompt';
import type { SmartUnitPrompt } from '../lib/smartUnitPrompt';
import { findMatchingCatalogCalibrations } from '../lib/userDataStore';

export { normalizeCatalogUnitRequest } from '../lib/resolution/catalogUnitRequest';

export type CatalogUnitRuntimeMode = 'standard' | 'smart';

export interface CatalogUnitRuntimeState {
  resolution: CatalogUnitResolution;
  prompt: SmartUnitPrompt | null;
}

const CALIBRATION_UNITS: readonly CatalogCalibrationUnit[] = [
  'piece',
  'bar',
  'slice',
  'portion'
];

const UNIT_LABELS: Readonly<Record<RequestedUnit, string>> = {
  g: 'Gramm',
  kg: 'Kilogramm',
  ml: 'Milliliter',
  piece: 'Stück',
  bar: 'Riegel',
  slice: 'Scheibe',
  portion: 'Portion',
  package: 'Packung'
};

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

function directClinicRuntimeState(
  product: ClinicCatalogProduct,
  request: CatalogUnitRequest
): CatalogUnitRuntimeState | null {
  const direct = directClinicResolution(product);
  if (!direct) return null;
  if (!request.unitExplicit || request.unit === 'piece') {
    return { resolution: direct, prompt: null };
  }

  const directPiece = { ...direct.options[0], recommended: false };
  const requested: ResolvedUnitOption = {
    id: `${request.unit}:clinic-direct:unavailable`,
    unit: request.unit,
    label: UNIT_LABELS[request.unit],
    basis: product.nutrition.basis,
    baseValue: null,
    source: 'unresolved',
    recommended: true,
    smallestEdibleUnit: false,
    priority: 0,
    note: `Der Klinikwert ist ausschließlich je Stück hinterlegt. Für ${UNIT_LABELS[request.unit]} wird kein Gewicht oder Volumen abgeleitet.`
  };
  return {
    resolution: {
      status: 'not_calculable',
      selectedOptionId: requested.id,
      options: [requested, directPiece],
      reason: 'requested-unit-unavailable'
    },
    prompt: null
  };
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
  const normalizedRequest = normalizeCatalogUnitRequest(request);
  if (isClinicCatalogProduct(product)) {
    const direct = directClinicRuntimeState(product, normalizedRequest);
    if (direct) return direct;
  }

  const calibrations = catalogProductCalibrations(product, mode)
    .map(toMatchingUnitCalibration);
  const baseResolution = resolveCatalogUnits(product, normalizedRequest, calibrations);

  return mode === 'smart'
    ? resolveSmartUnitState(product, normalizedRequest, baseResolution, promptValueOverride)
    : { resolution: baseResolution, prompt: null };
}

export function defaultClinicCatalogUnitRequest(
  product: ClinicCatalogProduct,
  mode: CatalogUnitRuntimeMode = 'standard'
): CatalogUnitRequest {
  if (product.clinic.directCarbohydratesPerUnit !== null) {
    return clinicDefaultRequest(product);
  }
  const saved = selectCatalogCalibration(catalogProductCalibrations(product, mode));
  return saved
    ? { amount: 1, unit: saved.unit, unitExplicit: false }
    : clinicDefaultRequest(product);
}
