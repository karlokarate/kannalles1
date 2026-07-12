import type { CalculationResult, ManualFormValues, ParsedFoodRequest, PortionOption } from '../types';
import { createId, unitLabels } from './format';
import { isOffBarcodeInput, normalizeOffBarcode } from './barcode';
import { isValidCarbohydratesPer100, maximumCarbohydratesPer100 } from './nutrition';
import {
  isPlausibleFoodAmount,
  isPlausibleTotalMass,
  isPlausibleUnitWeightForUnit
} from './domainLimits';

export function buildManualResult(values: ManualFormValues): CalculationResult {
  if (!values.productName.trim()) throw new Error('Ein Produktname ist erforderlich.');
  if (!isPlausibleFoodAmount(values.amount, values.unit)) {
    throw new Error('Die Menge ist ungültig oder für eine einzelne Berechnung zu groß.');
  }
  if (values.nutritionBasis === '100ml' && values.unit !== 'ml') {
    throw new Error('Nährwerte pro 100 ml benötigen eine Gesamtmenge in Millilitern.');
  }
  if (!isValidCarbohydratesPer100(values.carbsPer100, values.nutritionBasis)) {
    throw new Error(
      `Die Kohlenhydratangabe muss zwischen 0 und ${maximumCarbohydratesPer100(values.nutritionBasis)} liegen.`
    );
  }
  if (values.unitWeightG !== null && (
    !Number.isFinite(values.unitWeightG)
    || values.unitWeightG <= 0
    || !isPlausibleUnitWeightForUnit(values.unitWeightG, values.unit)
    || !isPlausibleTotalMass(values.amount * values.unitWeightG)
  )) {
    throw new Error('Das Stückgewicht ist ungültig oder ergibt mehr als 100 kg Gesamtgewicht.');
  }
  const barcode = values.barcode.trim() && isOffBarcodeInput(values.barcode)
    ? normalizeOffBarcode(values.barcode)
    : null;
  if (values.barcode.trim() && !barcode) throw new Error('Der Barcode muss 7 bis 14 Ziffern enthalten.');
  const request: ParsedFoodRequest = {
    status: 'parsed',
    rawInput: `${values.amount} ${unitLabels[values.unit]} ${values.productName}`,
    product: { name: values.productName, brand: values.brand || null, variant: null },
    amount: { value: values.amount, unit: values.unit, valueExplicit: true, unitExplicit: true },
    resolutionMode: barcode ? 'barcode' : 'exact_product',
    barcode,
    clarificationQuestion: null,
    parser: 'local'
  };

  let totalMassG: number | null = null;
  let totalVolumeMl: number | null = null;
  if (values.unit === 'g') totalMassG = values.amount;
  else if (values.unit === 'kg') totalMassG = values.amount * 1000;
  else if (values.unit === 'ml') totalVolumeMl = values.amount;
  else if (values.unitWeightG !== null) totalMassG = values.amount * values.unitWeightG;

  const basis = values.nutritionBasis;
  const referenceAmount = basis === '100g' ? totalMassG : totalVolumeMl;
  const carbs = referenceAmount !== null
    ? referenceAmount * values.carbsPer100 / 100
    : null;

  const option: PortionOption = values.unit === 'g'
    ? { id: 'g:variable:mass', unit: 'g', label: 'Gramm', weightG: 1, volumeMl: null, source: 'mass', confidence: 'high', note: 'Direkte Gewichtsangabe.', recommended: true }
    : values.unit === 'kg'
      ? { id: 'kg:variable:mass', unit: 'kg', label: 'Kilogramm', weightG: 1000, volumeMl: null, source: 'mass', confidence: 'high', note: 'Direkte Gewichtsangabe.', recommended: true }
      : values.unit === 'ml'
        ? { id: 'ml:variable:volume', unit: 'ml', label: 'Milliliter', weightG: null, volumeMl: 1, source: 'volume', confidence: 'high', note: 'Direkte Volumenangabe.', recommended: true }
        : { id: `${values.unit}:${values.unitWeightG ?? 'variable'}:manual`, unit: values.unit, label: unitLabels[values.unit], weightG: values.unitWeightG, volumeMl: null, source: 'manual', confidence: values.unitWeightG !== null ? 'high' : 'missing', note: 'Manuell eingegebene Einheit.', recommended: true };

  return {
    id: createId(),
    createdAt: new Date().toISOString(),
    request,
    product: {
      barcode,
      name: values.productName,
      brand: values.brand || null,
      imageUrl: null,
      packageDescription: null,
      packageWeightG: null,
      servingDescription: null,
      servingWeightG: values.unitWeightG,
      categories: []
    },
    mode: 'manual',
    status: carbs !== null ? 'calculated' : 'needs_unit_calibration',
    carbohydratesG: carbs,
    carbohydratesPer100: values.carbsPer100,
    basis,
    totalMassG,
    totalVolumeMl,
    unitWeightG: values.unitWeightG,
    amount: values.amount,
    unit: values.unit,
    countability: ['piece', 'bar', 'slice'].includes(values.unit)
      ? 'countable'
      : ['g', 'kg', 'ml'].includes(values.unit)
        ? 'non_countable'
        : 'unknown',
    confidence: carbs !== null ? 'high' : 'missing',
    sourceLabel: 'Eigene Angabe',
    methodLabel: 'Manuelle Werte · deterministische Berechnung',
    dataFetchedAt: null,
    dataCacheAgeMs: null,
    sampleSize: null,
    middleRange: null,
    candidates: [],
    notes: [],
    favorite: false,
    portionOptions: [option],
    selectedPortionId: option.id
  };
}
