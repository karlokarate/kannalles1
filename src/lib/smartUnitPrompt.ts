import type { CatalogProduct } from './catalog/catalogDomain';
import { genericDefaultPortionGrams, isGenericCatalogProduct } from './genericFoods';
import type {
  CatalogUnitRequest,
  CatalogUnitResolution,
  MatchingUnitCalibration,
  RequestedUnit,
  ResolvedUnitOption
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
  baseValueG: number | null;
  question: string;
  explanation: string;
}

export interface SmartUnitResolutionState {
  resolution: CatalogUnitResolution;
  prompt: SmartUnitPrompt | null;
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

function numericValue(value: string): number | null {
  const parsed = Number(value.replace(',', '.'));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/**
 * Creates a prompt only when the exact requested unit lacks deterministic evidence.
 * Proven catalog units, manufacturer servings and saved user calibrations always win.
 */
export function createSmartUnitPrompt(
  product: CatalogProduct,
  request: CatalogUnitRequest,
  resolution: CatalogUnitResolution
): SmartUnitPrompt | null {
  if (!request.unitExplicit || !isCalibratableUnit(request.unit) || product.nutrition.basis !== 'mass') return null;
  const exactResolved = resolution.options.some((option) => option.unit === request.unit && option.baseValue !== null);
  if (exactResolved) return null;

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
      baseValueG: wholeWeightG / 8,
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
    baseValueG: genericPortion,
    question: `Wie viel Gramm wiegt eine ${label(unit)}?`,
    explanation: genericPortion === null
      ? `Für ${label(unit)} ist keine belastbare Einzelmenge im Katalog vorhanden. Die Eingabe wird nur für dieses Produkt und diese Einheit gespeichert.`
      : `Für dieses generische Produkt sind ${genericPortion.toLocaleString('de-DE')} g als veränderbarer Portionsstandard voreingestellt.`
  };
}

export function updateSmartUnitPromptValue(prompt: SmartUnitPrompt, value: string): SmartUnitPrompt {
  const parsed = numericValue(value);
  const baseValueG = prompt.mode === 'whole-split'
    ? parsed !== null && Number.isInteger(parsed) && prompt.wholeWeightG !== null
      ? prompt.wholeWeightG / parsed
      : null
    : parsed;
  return { ...prompt, value, baseValueG };
}

export function applySmartUnitPromptDefault(
  resolution: CatalogUnitResolution,
  prompt: SmartUnitPrompt | null
): CatalogUnitResolution {
  if (!prompt || prompt.baseValueG === null) return resolution;
  const id = `${prompt.unit}:app_default:${String(prompt.baseValueG)}`;
  const option: ResolvedUnitOption = {
    id,
    unit: prompt.unit,
    label: label(prompt.unit),
    basis: 'mass',
    baseValue: prompt.baseValueG,
    source: 'app_default',
    recommended: true,
    smallestEdibleUnit: prompt.unit !== 'portion',
    priority: 50,
    note: prompt.mode === 'whole-split'
      ? `Veränderbarer Standard aus ${prompt.value} Stücken pro ganzer Pizza.`
      : 'Veränderbarer Standardwert; bitte Portionsgröße prüfen.'
  };
  const options = [option, ...resolution.options.filter((candidate) => candidate.id !== id).map((candidate) => ({ ...candidate, recommended: false }))];
  return { ...resolution, status: 'resolved', selectedOptionId: id, options, reason: 'explicit-unit-preserved' };
}

export function resolveSmartUnitState(
  product: CatalogProduct,
  request: CatalogUnitRequest,
  baseResolution: CatalogUnitResolution,
  valueOverride?: string
): SmartUnitResolutionState {
  const initialPrompt = createSmartUnitPrompt(product, request, baseResolution);
  const prompt = initialPrompt && valueOverride !== undefined
    ? updateSmartUnitPromptValue(initialPrompt, valueOverride)
    : initialPrompt;
  return { resolution: applySmartUnitPromptDefault(baseResolution, prompt), prompt };
}

export function smartUnitPromptCalibration(prompt: SmartUnitPrompt): MatchingUnitCalibration | null {
  const value = numericValue(prompt.value);
  if (value === null) return null;
  if (prompt.mode === 'whole-split') {
    if (!Number.isInteger(value) || prompt.wholeWeightG === null) return null;
    return {
      calibrationId: `smart:${prompt.productId}:${prompt.unit}:split`,
      scope: 'catalog-product',
      unit: prompt.unit,
      measuredCount: value,
      measuredTotalWeightG: prompt.wholeWeightG,
      updatedAt: new Date().toISOString(),
      active: true
    };
  }
  return {
    calibrationId: `smart:${prompt.productId}:${prompt.unit}:weight`,
    scope: 'catalog-product',
    unit: prompt.unit,
    measuredCount: 1,
    measuredTotalWeightG: value,
    updatedAt: new Date().toISOString(),
    active: true
  };
}
