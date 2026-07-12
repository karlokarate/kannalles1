import type { FoodUnit } from '../types';

export const MAX_TOTAL_MASS_G = 100_000;
export const MAX_TOTAL_VOLUME_ML = 100_000;
export const MAX_UNIT_WEIGHT_G = 5_000;
export const MAX_CALIBRATION_COUNT = 10_000;

export const MAX_AMOUNT_BY_UNIT: Readonly<Record<FoodUnit, number>> = {
  g: MAX_TOTAL_MASS_G,
  kg: MAX_TOTAL_MASS_G / 1_000,
  ml: MAX_TOTAL_VOLUME_ML,
  piece: MAX_CALIBRATION_COUNT,
  bar: MAX_CALIBRATION_COUNT,
  slice: MAX_CALIBRATION_COUNT,
  portion: MAX_CALIBRATION_COUNT,
  package: 1_000
};

export function isPlausibleFoodAmount(value: number, unit: FoodUnit): boolean {
  return Number.isFinite(value) && value > 0 && value <= MAX_AMOUNT_BY_UNIT[unit];
}

export function isPlausibleUnitWeight(value: number): boolean {
  return Number.isFinite(value) && value > 0 && value <= MAX_UNIT_WEIGHT_G;
}

export function isPlausibleUnitWeightForUnit(value: number, unit: FoodUnit): boolean {
  return unit === 'package' ? isPlausibleTotalMass(value) : isPlausibleUnitWeight(value);
}

export function isPlausibleTotalMass(value: number): boolean {
  return Number.isFinite(value) && value > 0 && value <= MAX_TOTAL_MASS_G;
}

export function isPlausibleTotalVolume(value: number): boolean {
  return Number.isFinite(value) && value > 0 && value <= MAX_TOTAL_VOLUME_ML;
}

export function isPlausibleCalibration(
  measuredCount: number,
  measuredTotalWeightG: number,
  requestedAmount?: number
): boolean {
  if (!Number.isInteger(measuredCount)
    || measuredCount < 1
    || measuredCount > MAX_CALIBRATION_COUNT
    || !isPlausibleTotalMass(measuredTotalWeightG)) return false;
  const unitWeight = measuredTotalWeightG / measuredCount;
  if (!isPlausibleUnitWeight(unitWeight)) return false;
  return requestedAmount === undefined || (
    isPlausibleFoodAmount(requestedAmount, 'piece')
    && isPlausibleTotalMass(requestedAmount * unitWeight)
  );
}
