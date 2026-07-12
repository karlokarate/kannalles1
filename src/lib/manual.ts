import type { CalculationResult, ManualFormValues, ParsedFoodRequest, PortionOption } from '../types';
import { createId, unitLabels } from './format';

export function buildManualResult(values: ManualFormValues): CalculationResult {
  const request: ParsedFoodRequest = {
    status: 'parsed',
    rawInput: `${values.amount} ${unitLabels[values.unit]} ${values.productName}`,
    product: { name: values.productName, brand: values.brand || null, variant: null },
    amount: { value: values.amount, unit: values.unit, valueExplicit: true, unitExplicit: true },
    resolutionMode: values.barcode ? 'barcode' : 'exact_product',
    barcode: values.barcode || null,
    clarificationQuestion: null,
    parser: 'local'
  };

  let totalMassG: number | null = null;
  let totalVolumeMl: number | null = null;
  if (values.unit === 'g') totalMassG = values.amount;
  else if (values.unit === 'kg') totalMassG = values.amount * 1000;
  else if (values.unit === 'ml') totalVolumeMl = values.amount;
  else if (values.unitWeightG !== null) totalMassG = values.amount * values.unitWeightG;

  const carbs = values.carbsPer100g !== null && totalMassG !== null
    ? totalMassG * values.carbsPer100g / 100
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
      barcode: values.barcode || null,
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
    carbohydratesPer100: values.carbsPer100g,
    basis: '100g',
    totalMassG,
    totalVolumeMl,
    unitWeightG: values.unitWeightG,
    amount: values.amount,
    unit: values.unit,
    confidence: carbs !== null ? 'high' : 'missing',
    sourceLabel: 'Eigene Angabe',
    methodLabel: 'Manuelle Werte · deterministische Berechnung',
    sampleSize: null,
    middleRange: null,
    candidates: [],
    notes: [],
    favorite: false,
    portionOptions: [option],
    selectedPortionId: option.id
  };
}
