import type { CatalogUnitKind } from './catalog/catalogProtocol';

export type CalibratableCatalogUnit = Extract<
  CatalogUnitKind,
  'piece' | 'bar' | 'slice' | 'portion'
>;
export type CalibrationScope = 'barcode' | 'exact_product' | 'generic_food';

export interface UnitCalibrationRecord {
  schemaVersion: 1;
  calibrationId: string;
  scope: CalibrationScope;
  scopeKey: string;
  product: {
    code: string | null;
    canonicalName: string;
    displayName: string;
    canonicalBrand: string | null;
  };
  unitKind: CalibratableCatalogUnit;
  measurement: {
    mode: 'single_unit' | 'group_weighing';
    measuredCount: number;
    measuredTotalWeightG: number;
  };
  derivedUnitWeightG: number;
  createdAt: string;
  updatedAt: string;
}

export interface UnitCalibrationInput {
  productCode?: string | null;
  productName: string;
  brand?: string | null;
  unitKind: CalibratableCatalogUnit;
  measuredCount: number;
  measuredTotalWeightG: number;
  scope?: CalibrationScope;
  allowGenericScope?: boolean;
}

export interface CalculationHistoryEntry {
  schemaVersion: 1;
  id: string;
  createdAt: string;
  productCode: string;
  productName: string;
  brand: string | null;
  amount: number;
  unitKind: CatalogUnitKind;
  basisValue: number;
  totalCarbohydratesG: number;
  carbohydratesPer100: number;
  carbohydrateBasis: 'mass' | 'volume';
  provenance: {
    source: 'catalog' | 'user_calibration';
    catalogVersion: string | null;
    calibrationId: string | null;
  };
}

export interface FavoriteProduct {
  schemaVersion: 1;
  productCode: string;
  productName: string;
  brand: string | null;
  addedAt: string;
}

export interface SearchSessionSnapshot {
  schemaVersion: 1;
  query: string;
  selectedProductCode: string | null;
  amount: number;
  unitKind: CatalogUnitKind | null;
  activeSection: 'calculator' | 'history' | 'favorites' | 'settings';
  savedAt: string;
}

interface UserDataEnvelope {
  schemaVersion: 1;
  calibrations: UnitCalibrationRecord[];
  history: CalculationHistoryEntry[];
  favorites: FavoriteProduct[];
  session: SearchSessionSnapshot | null;
}

export interface UserDataCounts {
  calibrations: number;
  history: number;
  favorites: number;
}

const USER_DATA_KEY = 'kh-checker:offline-user-data:v1';
const MAX_HISTORY_ENTRIES = 100;

const EMPTY_ENVELOPE: UserDataEnvelope = Object.freeze({
  schemaVersion: 1,
  calibrations: [],
  history: [],
  favorites: [],
  session: null
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function storageAvailable(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function canonicalText(value: string): string {
  return value
    .normalize('NFKD')
    .toLocaleLowerCase('de-DE')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9äöüß]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function normalizeCode(value: string | null | undefined): string | null {
  const digits = (value ?? '').replace(/\D+/g, '');
  return digits.length >= 8 && digits.length <= 14 ? digits : null;
}

function calibrationScopeKey(
  scope: CalibrationScope,
  input: Pick<UnitCalibrationInput, 'productCode' | 'productName' | 'brand' | 'unitKind'>
): string | null {
  const name = canonicalText(input.productName);
  if (!name) return null;
  const code = normalizeCode(input.productCode);
  const brand = canonicalText(input.brand ?? '') || null;
  if (scope === 'barcode') return code ? `barcode:${code}|${input.unitKind}` : null;
  if (scope === 'exact_product') return `exact:${name}|${brand ?? '-'}|${input.unitKind}`;
  return `generic:${name}|${input.unitKind}`;
}

function validUnitKind(value: unknown): value is CalibratableCatalogUnit {
  return value === 'piece' || value === 'bar' || value === 'slice' || value === 'portion';
}

function validCalibration(value: unknown): value is UnitCalibrationRecord {
  if (!isRecord(value) || value.schemaVersion !== 1) return false;
  if (typeof value.calibrationId !== 'string' || typeof value.scopeKey !== 'string') return false;
  if (!validUnitKind(value.unitKind) || !isRecord(value.measurement) || !isRecord(value.product)) {
    return false;
  }
  const count = value.measurement.measuredCount;
  const total = value.measurement.measuredTotalWeightG;
  const unitWeight = value.derivedUnitWeightG;
  return Number.isInteger(count)
    && typeof count === 'number'
    && count >= 1
    && typeof total === 'number'
    && Number.isFinite(total)
    && total > 0
    && typeof unitWeight === 'number'
    && Number.isFinite(unitWeight)
    && unitWeight > 0
    && typeof value.product.canonicalName === 'string'
    && typeof value.product.displayName === 'string';
}

function validHistoryEntry(value: unknown): value is CalculationHistoryEntry {
  if (!isRecord(value) || value.schemaVersion !== 1) return false;
  return typeof value.id === 'string'
    && typeof value.productCode === 'string'
    && typeof value.productName === 'string'
    && typeof value.totalCarbohydratesG === 'number'
    && Number.isFinite(value.totalCarbohydratesG)
    && value.totalCarbohydratesG >= 0;
}

function validFavorite(value: unknown): value is FavoriteProduct {
  if (!isRecord(value) || value.schemaVersion !== 1) return false;
  return typeof value.productCode === 'string'
    && typeof value.productName === 'string'
    && typeof value.addedAt === 'string';
}

function validSession(value: unknown): value is SearchSessionSnapshot {
  if (!isRecord(value) || value.schemaVersion !== 1) return false;
  return typeof value.query === 'string'
    && (typeof value.selectedProductCode === 'string' || value.selectedProductCode === null)
    && typeof value.amount === 'number'
    && Number.isFinite(value.amount)
    && value.amount > 0
    && typeof value.savedAt === 'string';
}

function normalizeEnvelope(value: unknown): UserDataEnvelope {
  if (!isRecord(value) || value.schemaVersion !== 1) {
    return { ...EMPTY_ENVELOPE, calibrations: [], history: [], favorites: [] };
  }
  return {
    schemaVersion: 1,
    calibrations: Array.isArray(value.calibrations)
      ? value.calibrations.filter(validCalibration)
      : [],
    history: Array.isArray(value.history)
      ? value.history.filter(validHistoryEntry).slice(0, MAX_HISTORY_ENTRIES)
      : [],
    favorites: Array.isArray(value.favorites) ? value.favorites.filter(validFavorite) : [],
    session: validSession(value.session) ? value.session : null
  };
}

function readEnvelope(): UserDataEnvelope {
  if (!storageAvailable()) return normalizeEnvelope(null);
  try {
    const raw = window.localStorage.getItem(USER_DATA_KEY);
    return raw ? normalizeEnvelope(JSON.parse(raw)) : normalizeEnvelope(null);
  } catch {
    return normalizeEnvelope(null);
  }
}

function writeEnvelope(envelope: UserDataEnvelope): void {
  if (!storageAvailable()) return;
  try {
    window.localStorage.setItem(USER_DATA_KEY, JSON.stringify(envelope));
    window.dispatchEvent(new CustomEvent('kh:offline-user-data-changed'));
  } catch {
    // Explicit user actions remain usable in memory even when persistence is unavailable.
  }
}

function createId(prefix: string): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function deriveCalibrationValues(
  measuredCount: number,
  measuredTotalWeightG: number,
  requestedAmount: number,
  carbohydratesPer100g: number | null
): {
  unitWeightG: number;
  carbsPerUnitG: number | null;
  requestedTotalWeightG: number;
  requestedTotalCarbsG: number | null;
} | null {
  if (!Number.isInteger(measuredCount) || measuredCount < 1) return null;
  if (!Number.isFinite(measuredTotalWeightG) || measuredTotalWeightG <= 0) return null;
  if (!Number.isFinite(requestedAmount) || requestedAmount <= 0) return null;
  const unitWeightG = measuredTotalWeightG / measuredCount;
  const validCarbs = carbohydratesPer100g !== null
    && Number.isFinite(carbohydratesPer100g)
    && carbohydratesPer100g >= 0
    && carbohydratesPer100g <= 100;
  const requestedTotalWeightG = requestedAmount * unitWeightG;
  return {
    unitWeightG,
    carbsPerUnitG: validCarbs ? unitWeightG * carbohydratesPer100g / 100 : null,
    requestedTotalWeightG,
    requestedTotalCarbsG: validCarbs
      ? requestedTotalWeightG * carbohydratesPer100g / 100
      : null
  };
}

export function saveUnitCalibration(input: UnitCalibrationInput): UnitCalibrationRecord | null {
  if (!validUnitKind(input.unitKind)) return null;
  const derived = deriveCalibrationValues(
    input.measuredCount,
    input.measuredTotalWeightG,
    1,
    null
  );
  if (!derived) return null;

  const code = normalizeCode(input.productCode);
  const inferredScope: CalibrationScope = input.scope ?? (code ? 'barcode' : 'exact_product');
  const scope = inferredScope === 'barcode' && !code ? 'exact_product' : inferredScope;
  const scopeKey = calibrationScopeKey(scope, input);
  const canonicalName = canonicalText(input.productName);
  if (!scopeKey || !canonicalName) return null;

  const now = new Date().toISOString();
  const envelope = readEnvelope();
  const existing = envelope.calibrations.find((record) => record.scopeKey === scopeKey);
  const record: UnitCalibrationRecord = {
    schemaVersion: 1,
    calibrationId: existing?.calibrationId ?? createId('cal'),
    scope,
    scopeKey,
    product: {
      code,
      canonicalName,
      displayName: input.productName.trim(),
      canonicalBrand: canonicalText(input.brand ?? '') || null
    },
    unitKind: input.unitKind,
    measurement: {
      mode: input.measuredCount >= 2 ? 'group_weighing' : 'single_unit',
      measuredCount: input.measuredCount,
      measuredTotalWeightG: input.measuredTotalWeightG
    },
    derivedUnitWeightG: derived.unitWeightG,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now
  };
  envelope.calibrations = [record, ...envelope.calibrations.filter((item) => item.scopeKey !== scopeKey)];
  writeEnvelope(envelope);
  return record;
}

export function findUnitCalibration(input: {
  productCode?: string | null;
  productName: string;
  brand?: string | null;
  unitKind: CalibratableCatalogUnit;
  allowGenericScope?: boolean;
}): UnitCalibrationRecord | null {
  const scopes: CalibrationScope[] = ['barcode', 'exact_product'];
  if (input.allowGenericScope) scopes.push('generic_food');
  const keys = scopes
    .map((scope) => calibrationScopeKey(scope, input))
    .filter((key): key is string => Boolean(key));
  const records = readEnvelope().calibrations.filter((record) => keys.includes(record.scopeKey));
  records.sort((a, b) => {
    const scopeOrder: Record<CalibrationScope, number> = {
      barcode: 0,
      exact_product: 1,
      generic_food: 2
    };
    const scopeDelta = scopeOrder[a.scope] - scopeOrder[b.scope];
    if (scopeDelta !== 0) return scopeDelta;
    const sampleDelta = b.measurement.measuredCount - a.measurement.measuredCount;
    return sampleDelta !== 0 ? sampleDelta : b.updatedAt.localeCompare(a.updatedAt);
  });
  return records[0] ?? null;
}

export function listUnitCalibrations(): UnitCalibrationRecord[] {
  return readEnvelope().calibrations;
}

export function deleteUnitCalibration(calibrationId: string): void {
  const envelope = readEnvelope();
  envelope.calibrations = envelope.calibrations.filter(
    (record) => record.calibrationId !== calibrationId
  );
  writeEnvelope(envelope);
}

export function saveHistoryEntry(entry: CalculationHistoryEntry): void {
  const envelope = readEnvelope();
  envelope.history = [entry, ...envelope.history.filter((item) => item.id !== entry.id)]
    .slice(0, MAX_HISTORY_ENTRIES);
  writeEnvelope(envelope);
}

export function listHistoryEntries(): CalculationHistoryEntry[] {
  return readEnvelope().history;
}

export function clearHistoryEntries(): void {
  const envelope = readEnvelope();
  envelope.history = [];
  writeEnvelope(envelope);
}

export function toggleFavorite(product: Omit<FavoriteProduct, 'schemaVersion' | 'addedAt'>): boolean {
  const envelope = readEnvelope();
  const existing = envelope.favorites.some((item) => item.productCode === product.productCode);
  envelope.favorites = existing
    ? envelope.favorites.filter((item) => item.productCode !== product.productCode)
    : [{ schemaVersion: 1, ...product, addedAt: new Date().toISOString() }, ...envelope.favorites];
  writeEnvelope(envelope);
  return !existing;
}

export function listFavorites(): FavoriteProduct[] {
  return readEnvelope().favorites;
}

export function isFavorite(productCode: string): boolean {
  return readEnvelope().favorites.some((item) => item.productCode === productCode);
}

export function saveSearchSession(snapshot: Omit<SearchSessionSnapshot, 'schemaVersion' | 'savedAt'>): void {
  const envelope = readEnvelope();
  envelope.session = {
    schemaVersion: 1,
    ...snapshot,
    savedAt: new Date().toISOString()
  };
  writeEnvelope(envelope);
}

export function loadSearchSession(): SearchSessionSnapshot | null {
  return readEnvelope().session;
}

export function clearSearchSession(): void {
  const envelope = readEnvelope();
  envelope.session = null;
  writeEnvelope(envelope);
}

export function getUserDataCounts(): UserDataCounts {
  const envelope = readEnvelope();
  return {
    calibrations: envelope.calibrations.length,
    history: envelope.history.length,
    favorites: envelope.favorites.length
  };
}

export function clearAllUserData(): void {
  if (!storageAvailable()) return;
  try {
    window.localStorage.removeItem(USER_DATA_KEY);
    window.dispatchEvent(new CustomEvent('kh:offline-user-data-changed'));
  } catch {
    // Ignore unavailable storage.
  }
}

export function encodeSearchSession(snapshot: SearchSessionSnapshot): string {
  return JSON.stringify(snapshot);
}

export function decodeSearchSession(raw: string | null): SearchSessionSnapshot | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw);
    return validSession(value) ? value : null;
  } catch {
    return null;
  }
}
