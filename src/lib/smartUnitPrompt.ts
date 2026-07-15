import type { CatalogProduct } from './catalog/catalogDomain';
import { genericDefaultPortionGrams, isGenericCatalogProduct } from './genericFoods';
import type {
  CatalogUnitRequest,
  CatalogUnitResolution,
  MatchingUnitCalibration,
  RequestedUnit
} from './resolution/catalogResolution';
import type { CatalogCalibrationUnit } from './resolution/catalogCalibration';

export type SmartUnitPromptMode = 'unit-weight' | 'whole-split';

export interface SmartUnitPrompt {
  productId: number;
  productName: string;
  unit: CatalogCalibrationUnit;
  requestedAmount: number;
  mode: SmartUnitPromptMode;
  value: string;
  defaultValue: number | null;
  wholeWeightG: number | null;
  question: string;
  explanation: string;
}

const CALIBRATABLE_UNITS: readonly RequestedUnit[] = ['piece', 'bar', 'slice', 'portion'];

function isCalibratableUnit(unit: RequestedUnit): unit is CatalogCalibrationUnit {
  return CALIBRATABLE_UNITS.includes(unit);
}

function normalizedName(product: CatalogProduct): string {
  return product.displayName
    .normalize('NFKC')
    .toLocaleLowerCase('de-DE')
    .replace(/[^a-z0-9äöüß]+/g, ' ')
    .trim();
}

function wholeProductWeightG(product: CatalogProduct): number | null {
  const quantity = product.unitEvidence.productQuantity;
  return quantity?.basis === 'mass' && Number.isFinite(quantity.baseValue) && quantity.baseValue > 0
    ? quantity.baseValue
    : null;
}

function label(unit: CatalogCalibrationUnit): string {
  if (unit === 'bar') return 'Riegel';
  if (unit === 'slice') return 'Scheibe';
  if (unit === 'portion') return 'Portion';
  return 'Stück';
}

/**
 * Returns a prompt only when the exact requested unit has no deterministic base value.
 * Proven catalog evidence, manufacturer servings and saved user calibrations always win.
 */
export function createSmartUnitPrompt(
  product: CatalogProduct,
  request: CatalogUnitRequest,
  resolution: CatalogUnitResolution
): SmartUnitPrompt | null {
  if (!request.unitExplicit || !isCalibratableUnit(request.unit)) return null;
  const selected = resolution.options.find((option) => option.id === resolution.selectedOptionId)
    ?? resolution.options.find((option) => option.unit === request.unit);
  if (selected?.baseValue !== null && selected?.baseValue !== undefined) return null;

  const unit = request.unit;
  const productName = product.displayName;
  const pizza = /\bpizza\b/.test(normalizedName(product));
  const wholeWeightG = wholeProductWeightG(product);

  if ((unit === 'piece' || unit === 'slice') && pizza && wholeWeightG !== null) {
    return {
      productId: product.productId,
      productName,
      unit,
      requestedAmount: request.amount,
      mode: 'whole-split',
      value: '8',
      defaultValue: 8,
      wholeWeightG,
      question: 'In wie viele Stücke ist die ganze Pizza geschnitten?',
      explanation: `Standard sind 8 Stück. Das Gewicht je ${label(unit)} wird aus ${wholeWeightG.toLocaleString('de-DE')} g Gesamtgewicht berechnet.`
    };
  }

  const genericPortion = unit === 'portion' && isGenericCatalogProduct(product)
    ? genericDefaultPortionGrams(product)
    : null;
  return {
    productId: product.productId,
    productName,
    unit,
    requestedAmount: request.amount,
    mode: 'unit-weight',
    value: genericPortion === null ? '' : String(genericPortion),
    defaultValue: genericPortion,
    wholeWeightG: null,
    question: `Wie viel Gramm wiegt eine ${label(unit)}?`,
    explanation: genericPortion === null
      ? `Für ${label(unit)} ist keine belastbare Einzelmenge im Katalog vorhanden. Die Eingabe wird nur für dieses Produkt und diese Einheit gespeichert.`
      : `Für dieses generische Produkt sind ${genericPortion.toLocaleString('de-DE')} g als veränderbarer Portionsstandard voreingestellt.`
  };
}

export function smartUnitPromptCalibration(prompt: SmartUnitPrompt): MatchingUnitCalibration | null {
  const value = Number(prompt.value.replace(',', '.'));
  if (!Number.isFinite(value) || value <= 0) return null;
  if (prompt.mode === 'whole-split') {
    if (!Number.isInteger(value) || prompt.wholeWeightG === null) return null;
    return {
      calibrationId: `smart:${prompt.productId}:${prompt.unit}:split`,
      scope: 'catalog-product',
      unit: prompt.unit,
      measuredCount: value,
      measuredTotalWeightG: prompt.wholeWeightG,
      updatedAt: new Date(0).toISOString(),
      active: true
    };
  }
  return {
    calibrationId: `smart:${prompt.productId}:${prompt.unit}:weight`,
    scope: isGenericCatalogProductCode(prompt.productId) ? 'generic-food' : 'catalog-product',
    unit: prompt.unit,
    measuredCount: 1,
    measuredTotalWeightG: value,
    updatedAt: new Date(0).toISOString(),
    active: true
  };
}

// Generic products use stable negative ids. The controller supplies the final persistence scope.
function isGenericCatalogProductCode(productId: number): boolean {
  return productId < 0;
}

export function smartUnitPromptUnitWeight(prompt: SmartUnitPrompt): number | null {
  const calibration = smartUnitPromptCalibration(prompt);
  return calibration === null ? null : calibration.measuredTotalWeightG / calibration.measuredCount;
}
