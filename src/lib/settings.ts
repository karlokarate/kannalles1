import { defaultDiabetesFactorSchedules, normalizeDiabetesFactorSchedules } from './diabetesProfile';
import type { DiabetesFactorSegments } from './diabetesProfile';

export type DecimalPlaces = 0 | 1 | 2;
export type SearchResultLimit = 10 | 15 | 20;
export type ProductImageMode = 'remote' | 'hidden';
export type ClinicMode = 'clinic-only' | 'hybrid' | 'off';
export type VisualTheme = 'comic' | 'standard';

export interface OfflineAppSettings {
  schemaVersion: 1;
  decimalPlaces: DecimalPlaces;
  searchResultLimit: SearchResultLimit;
  saveHistory: boolean;
  restoreLastSession: boolean;
  productImageMode: ProductImageMode;
  clinicMode: ClinicMode;
  visualTheme: VisualTheme;
  diabeticProfileEnabled: boolean;
  diabetesFactorSegments: DiabetesFactorSegments;
  insulinActivityDurationHours: number;
  manualBolusTrackingEnabled: boolean;
}

const SETTINGS_KEY = 'kh-checker:offline-settings:v1';

export const DEFAULT_OFFLINE_SETTINGS: OfflineAppSettings = Object.freeze({
  schemaVersion: 1,
  decimalPlaces: 1,
  searchResultLimit: 20,
  saveHistory: false,
  restoreLastSession: false,
  productImageMode: 'remote',
  clinicMode: 'hybrid',
  visualTheme: 'comic',
  diabeticProfileEnabled: false,
  diabetesFactorSegments: defaultDiabetesFactorSchedules(),
  insulinActivityDurationHours: 5,
  manualBolusTrackingEnabled: false
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function defaultSettings(): OfflineAppSettings {
  return { ...DEFAULT_OFFLINE_SETTINGS, diabetesFactorSegments: defaultDiabetesFactorSchedules() };
}

export function normalizeOfflineSettings(value: unknown): OfflineAppSettings {
  if (!isRecord(value)) return defaultSettings();
  return {
    schemaVersion: 1,
    decimalPlaces: value.decimalPlaces === 0 || value.decimalPlaces === 1 || value.decimalPlaces === 2 ? value.decimalPlaces : 1,
    searchResultLimit: value.searchResultLimit === 10 || value.searchResultLimit === 15 || value.searchResultLimit === 20 ? value.searchResultLimit : 20,
    saveHistory: typeof value.saveHistory === 'boolean' ? value.saveHistory : false,
    restoreLastSession: typeof value.restoreLastSession === 'boolean' ? value.restoreLastSession : false,
    productImageMode: value.productImageMode === 'hidden' ? 'hidden' : 'remote',
    clinicMode: value.clinicMode === 'clinic-only' || value.clinicMode === 'off' ? value.clinicMode : 'hybrid',
    visualTheme: value.visualTheme === 'standard' ? 'standard' : 'comic',
    diabeticProfileEnabled: value.diabeticProfileEnabled === true,
    diabetesFactorSegments: normalizeDiabetesFactorSchedules(value.diabetesFactorSegments, value.diabetesSegments),
    insulinActivityDurationHours: typeof value.insulinActivityDurationHours === 'number' && Number.isFinite(value.insulinActivityDurationHours) && value.insulinActivityDurationHours >= 1 && value.insulinActivityDurationHours <= 6 && Number.isInteger(value.insulinActivityDurationHours * 2) ? value.insulinActivityDurationHours : 5,
    manualBolusTrackingEnabled: value.manualBolusTrackingEnabled === true
  };
}

export function loadOfflineSettings(): OfflineAppSettings {
  if (typeof window === 'undefined') return defaultSettings();
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    return raw ? normalizeOfflineSettings(JSON.parse(raw)) : defaultSettings();
  } catch {
    return defaultSettings();
  }
}

export function saveOfflineSettings(settings: OfflineAppSettings): OfflineAppSettings {
  const normalized = normalizeOfflineSettings(settings);
  try { window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(normalized)); } catch {}
  return normalized;
}

export function formatCarbohydrates(value: number | null, decimalPlaces: DecimalPlaces): string {
  if (value === null || !Number.isFinite(value)) return '–';
  return new Intl.NumberFormat('de-DE', { minimumFractionDigits: decimalPlaces, maximumFractionDigits: decimalPlaces }).format(value);
}
