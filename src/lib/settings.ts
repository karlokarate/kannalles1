export type DecimalPlaces = 0 | 1 | 2;
export type SearchResultLimit = 10 | 15 | 20;
export type ProductImageMode = 'remote' | 'hidden';

export interface OfflineAppSettings {
  schemaVersion: 1;
  decimalPlaces: DecimalPlaces;
  searchResultLimit: SearchResultLimit;
  saveHistory: boolean;
  restoreLastSession: boolean;
  productImageMode: ProductImageMode;
}

const SETTINGS_KEY = 'kh-checker:offline-settings:v1';

export const DEFAULT_OFFLINE_SETTINGS: OfflineAppSettings = Object.freeze({
  schemaVersion: 1,
  decimalPlaces: 1,
  searchResultLimit: 10,
  saveHistory: false,
  restoreLastSession: false,
  productImageMode: 'remote'
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function readDecimalPlaces(value: unknown): DecimalPlaces {
  return value === 0 || value === 1 || value === 2
    ? value
    : DEFAULT_OFFLINE_SETTINGS.decimalPlaces;
}

function readSearchResultLimit(value: unknown): SearchResultLimit {
  return value === 10 || value === 15 || value === 20
    ? value
    : DEFAULT_OFFLINE_SETTINGS.searchResultLimit;
}

function readProductImageMode(value: unknown): ProductImageMode {
  return value === 'hidden' || value === 'remote'
    ? value
    : DEFAULT_OFFLINE_SETTINGS.productImageMode;
}

export function normalizeOfflineSettings(value: unknown): OfflineAppSettings {
  if (!isRecord(value)) return { ...DEFAULT_OFFLINE_SETTINGS };
  return {
    schemaVersion: 1,
    decimalPlaces: readDecimalPlaces(value.decimalPlaces),
    searchResultLimit: readSearchResultLimit(value.searchResultLimit),
    saveHistory: readBoolean(value.saveHistory, DEFAULT_OFFLINE_SETTINGS.saveHistory),
    restoreLastSession: readBoolean(
      value.restoreLastSession,
      DEFAULT_OFFLINE_SETTINGS.restoreLastSession
    ),
    productImageMode: readProductImageMode(value.productImageMode)
  };
}

function storageAvailable(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

export function loadOfflineSettings(): OfflineAppSettings {
  if (!storageAvailable()) return { ...DEFAULT_OFFLINE_SETTINGS };
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    return raw ? normalizeOfflineSettings(JSON.parse(raw)) : { ...DEFAULT_OFFLINE_SETTINGS };
  } catch {
    return { ...DEFAULT_OFFLINE_SETTINGS };
  }
}

export function saveOfflineSettings(settings: OfflineAppSettings): OfflineAppSettings {
  const normalized = normalizeOfflineSettings(settings);
  if (!storageAvailable()) return normalized;
  try {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(normalized));
    window.dispatchEvent(new CustomEvent('kh:offline-settings-changed', { detail: normalized }));
  } catch {
    // A storage quota or privacy mode must not make the calculator unusable.
  }
  return normalized;
}

export function resetOfflineSettings(): OfflineAppSettings {
  if (storageAvailable()) {
    try {
      window.localStorage.removeItem(SETTINGS_KEY);
    } catch {
      // Ignore unavailable storage; the in-memory defaults still apply.
    }
  }
  return { ...DEFAULT_OFFLINE_SETTINGS };
}

export function formatCarbohydrates(value: number | null, decimalPlaces: DecimalPlaces): string {
  if (value === null || !Number.isFinite(value)) return '–';
  return new Intl.NumberFormat('de-DE', {
    minimumFractionDigits: decimalPlaces,
    maximumFractionDigits: decimalPlaces
  }).format(value);
}
