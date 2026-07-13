import type { CatalogProduct } from './catalog/catalogDomain';
import type {
  CatalogCalibrationIdentity,
  CatalogCalibrationUnit,
  CatalogUnitCalibration
} from './resolution/catalogCalibration';
import {
  catalogCalibrationLookupKeys,
  normalizeCatalogCalibration
} from './resolution/catalogCalibration';
import type { RequestedUnit } from './resolution/catalogResolution';

export interface CalculationHistoryEntry {
  schemaVersion: 2;
  id: string;
  createdAt: string;
  product: {
    productId: number | null;
    code: string | null;
    displayName: string;
    brand: string | null;
  };
  amount: number;
  unit: RequestedUnit;
  unitBaseValue: number;
  totalCarbohydratesG: number;
  carbohydratesPer100: number;
  nutritionBasis: 'mass' | 'volume';
  provenance: {
    source: 'catalog' | 'user-calibration' | 'manual';
    catalogVersion: string | null;
    calibrationId: string | null;
  };
}

export interface FavoriteProduct {
  schemaVersion: 2;
  productId: number;
  code: string;
  displayName: string;
  brand: string | null;
  addedAt: string;
}

export type AppSection = 'calculator' | 'history' | 'favorites' | 'settings';

export interface SearchSessionSnapshot {
  schemaVersion: 2;
  query: string;
  selectedProductCode: string | null;
  amount: number;
  unit: RequestedUnit | null;
  activeSection: AppSection;
  manualMode: boolean;
  savedAt: string;
}

interface UserDataEnvelope {
  schemaVersion: 2;
  calibrations: CatalogUnitCalibration[];
  history: CalculationHistoryEntry[];
  favorites: FavoriteProduct[];
  session: SearchSessionSnapshot | null;
}

export interface UserDataCounts {
  calibrations: number;
  history: number;
  favorites: number;
}

const USER_DATA_KEY = 'kh-checker:offline-user-data:v2';
const MAX_HISTORY_ENTRIES = 100;

function emptyEnvelope(): UserDataEnvelope {
  return {
    schemaVersion: 2,
    calibrations: [],
    history: [],
    favorites: [],
    session: null
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function storageAvailable(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function isRequestedUnit(value: unknown): value is RequestedUnit {
  return value === 'g'
    || value === 'kg'
    || value === 'ml'
    || value === 'piece'
    || value === 'bar'
    || value === 'slice'
    || value === 'portion'
    || value === 'package';
}

function isSection(value: unknown): value is AppSection {
  return value === 'calculator'
    || value === 'history'
    || value === 'favorites'
    || value === 'settings';
}

function validHistoryEntry(value: unknown): value is CalculationHistoryEntry {
  if (!isRecord(value) || value.schemaVersion !== 2 || !isRecord(value.product)) return false;
  return typeof value.id === 'string'
    && typeof value.createdAt === 'string'
    && typeof value.product.displayName === 'string'
    && typeof value.amount === 'number'
    && Number.isFinite(value.amount)
    && value.amount > 0
    && isRequestedUnit(value.unit)
    && typeof value.unitBaseValue === 'number'
    && Number.isFinite(value.unitBaseValue)
    && value.unitBaseValue > 0
    && typeof value.totalCarbohydratesG === 'number'
    && Number.isFinite(value.totalCarbohydratesG)
    && value.totalCarbohydratesG >= 0
    && typeof value.carbohydratesPer100 === 'number'
    && Number.isFinite(value.carbohydratesPer100);
}

function validFavorite(value: unknown): value is FavoriteProduct {
  if (!isRecord(value) || value.schemaVersion !== 2) return false;
  return typeof value.productId === 'number'
    && Number.isSafeInteger(value.productId)
    && typeof value.code === 'string'
    && typeof value.displayName === 'string'
    && typeof value.addedAt === 'string';
}

function validSession(value: unknown): value is SearchSessionSnapshot {
  if (!isRecord(value) || value.schemaVersion !== 2) return false;
  return typeof value.query === 'string'
    && (typeof value.selectedProductCode === 'string' || value.selectedProductCode === null)
    && typeof value.amount === 'number'
    && Number.isFinite(value.amount)
    && value.amount > 0
    && (isRequestedUnit(value.unit) || value.unit === null)
    && isSection(value.activeSection)
    && typeof value.manualMode === 'boolean'
    && typeof value.savedAt === 'string';
}

function normalizeEnvelope(value: unknown): UserDataEnvelope {
  if (!isRecord(value) || value.schemaVersion !== 2) return emptyEnvelope();
  const calibrations = Array.isArray(value.calibrations)
    ? value.calibrations
        .map((entry) => normalizeCatalogCalibration(entry))
        .filter((entry): entry is CatalogUnitCalibration => entry !== null)
    : [];
  return {
    schemaVersion: 2,
    calibrations,
    history: Array.isArray(value.history)
      ? value.history.filter(validHistoryEntry).slice(0, MAX_HISTORY_ENTRIES)
      : [],
    favorites: Array.isArray(value.favorites) ? value.favorites.filter(validFavorite) : [],
    session: validSession(value.session) ? value.session : null
  };
}

function readEnvelope(): UserDataEnvelope {
  if (!storageAvailable()) return emptyEnvelope();
  try {
    const raw = window.localStorage.getItem(USER_DATA_KEY);
    return raw ? normalizeEnvelope(JSON.parse(raw)) : emptyEnvelope();
  } catch {
    return emptyEnvelope();
  }
}

function writeEnvelope(envelope: UserDataEnvelope): void {
  if (!storageAvailable()) return;
  try {
    window.localStorage.setItem(USER_DATA_KEY, JSON.stringify(envelope));
    window.dispatchEvent(new CustomEvent('kh:offline-user-data-changed'));
  } catch {
    // Storage denial must not break calculation or catalog access.
  }
}

export function createLocalId(prefix: string): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function saveCatalogCalibration(record: CatalogUnitCalibration): CatalogUnitCalibration | null {
  const normalized = normalizeCatalogCalibration(record);
  if (!normalized) return null;
  const envelope = readEnvelope();
  envelope.calibrations = [
    normalized,
    ...envelope.calibrations.filter((item) => item.scopeKey !== normalized.scopeKey)
  ];
  writeEnvelope(envelope);
  return normalized;
}

export function findMatchingCatalogCalibrations(
  identity: CatalogCalibrationIdentity,
  unit: CatalogCalibrationUnit,
  allowGenericScope = false
): CatalogUnitCalibration[] {
  const keys = catalogCalibrationLookupKeys(identity, unit, allowGenericScope);
  const keyOrder = new Map(keys.map((key, index) => [key, index]));
  return readEnvelope().calibrations
    .filter((record) => record.active && keyOrder.has(record.scopeKey))
    .sort((a, b) => {
      const scopeDelta = (keyOrder.get(a.scopeKey) ?? 99) - (keyOrder.get(b.scopeKey) ?? 99);
      if (scopeDelta !== 0) return scopeDelta;
      const sampleDelta = b.measurement.measuredCount - a.measurement.measuredCount;
      return sampleDelta !== 0 ? sampleDelta : b.updatedAt.localeCompare(a.updatedAt);
    });
}

export function listCatalogCalibrations(): CatalogUnitCalibration[] {
  return readEnvelope().calibrations;
}

export function deleteCatalogCalibration(calibrationId: string): void {
  const envelope = readEnvelope();
  envelope.calibrations = envelope.calibrations.filter(
    (record) => record.calibrationId !== calibrationId
  );
  writeEnvelope(envelope);
}

export function saveHistoryEntry(entry: CalculationHistoryEntry): void {
  if (!validHistoryEntry(entry)) return;
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

export function toggleFavoriteProduct(product: CatalogProduct): boolean {
  const envelope = readEnvelope();
  const exists = envelope.favorites.some((item) => item.productId === product.productId);
  envelope.favorites = exists
    ? envelope.favorites.filter((item) => item.productId !== product.productId)
    : [
        {
          schemaVersion: 2,
          productId: product.productId,
          code: product.code,
          displayName: product.displayName,
          brand: product.brand,
          addedAt: new Date().toISOString()
        },
        ...envelope.favorites
      ];
  writeEnvelope(envelope);
  return !exists;
}

export function listFavoriteProducts(): FavoriteProduct[] {
  return readEnvelope().favorites;
}

export function isFavoriteProduct(productId: number): boolean {
  return readEnvelope().favorites.some((item) => item.productId === productId);
}

export function saveSearchSession(
  snapshot: Omit<SearchSessionSnapshot, 'schemaVersion' | 'savedAt'>
): void {
  const envelope = readEnvelope();
  envelope.session = {
    schemaVersion: 2,
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
    // Ignore unavailable local storage.
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
