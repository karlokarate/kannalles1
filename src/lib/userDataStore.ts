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

export interface ManualProduct {
  schemaVersion: 1;
  id: string;
  label: string;
  carbohydratesPer100: number;
  basis: 'mass' | 'volume';
  imageDataUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CatalogProductPhoto {
  schemaVersion: 1;
  productCode: string;
  imageDataUrl: string;
  updatedAt: string;
}

export interface SavedMealLine {
  id: string;
  productCode: string;
  productName: string;
  amount: number;
  unit: RequestedUnit;
  selectedOptionId: string;
  unitBaseValue: number;
  carbohydratesG: number;
}

export interface SavedMealCalculation {
  schemaVersion: 1;
  id: string;
  /** Full ISO-8601 date-time of the represented automatic calculation. */
  createdAt: string;
  items: SavedMealLine[];
  totalCarbohydratesG: number;
}

export interface HistoryTransferData {
  calculations: CalculationHistoryEntry[];
  meals: SavedMealCalculation[];
  calibrations: CatalogUnitCalibration[];
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
  manualProducts: ManualProduct[];
  productPhotos: CatalogProductPhoto[];
  meals: SavedMealCalculation[];
  session: SearchSessionSnapshot | null;
}

export interface UserDataCounts {
  calibrations: number;
  history: number;
  favorites: number;
  manualProducts: number;
  productPhotos: number;
}

const USER_DATA_KEY = 'kh-checker:offline-user-data:v2';
const MAX_HISTORY_ENTRIES = 100;
const MAX_MEAL_ENTRIES = 50;

function emptyEnvelope(): UserDataEnvelope {
  return {
    schemaVersion: 2,
    calibrations: [],
    history: [],
    favorites: [],
    manualProducts: [],
    productPhotos: [],
    meals: [],
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

function canonicalDateTime(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/u.test(value)) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
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

function validImageDataUrl(image: unknown): image is string {
  return typeof image === 'string' && /^data:image\/(?:jpeg|png|webp);base64,/.test(image) && image.length <= 350_000;
}

function validManualProduct(value: unknown): value is ManualProduct {
  if (!isRecord(value) || value.schemaVersion !== 1) return false;
  const image = value.imageDataUrl;
  return typeof value.id === 'string'
    && typeof value.label === 'string' && value.label.trim().length > 0
    && typeof value.carbohydratesPer100 === 'number' && Number.isFinite(value.carbohydratesPer100)
    && value.carbohydratesPer100 >= 0 && value.carbohydratesPer100 <= 200
    && (value.basis === 'mass' || value.basis === 'volume')
    && (image === null || validImageDataUrl(image))
    && typeof value.createdAt === 'string' && typeof value.updatedAt === 'string';
}

function validCatalogProductPhoto(value: unknown): value is CatalogProductPhoto {
  return isRecord(value) && value.schemaVersion === 1
    && typeof value.productCode === 'string' && value.productCode.trim().length > 0 && value.productCode.length <= 160
    && validImageDataUrl(value.imageDataUrl)
    && typeof value.updatedAt === 'string';
}

function validSavedMealLine(value: unknown): value is SavedMealLine {
  return isRecord(value)
    && typeof value.id === 'string'
    && typeof value.productCode === 'string' && value.productCode.length > 0 && value.productCode.length <= 160
    && typeof value.productName === 'string' && value.productName.trim().length > 0
    && typeof value.amount === 'number' && Number.isFinite(value.amount) && value.amount > 0 && value.amount <= 10_000
    && isRequestedUnit(value.unit)
    && typeof value.selectedOptionId === 'string' && value.selectedOptionId.length > 0
    && typeof value.unitBaseValue === 'number' && Number.isFinite(value.unitBaseValue) && value.unitBaseValue > 0
    && typeof value.carbohydratesG === 'number' && Number.isFinite(value.carbohydratesG) && value.carbohydratesG >= 0;
}

function validSavedMeal(value: unknown): value is SavedMealCalculation {
  return isRecord(value) && value.schemaVersion === 1
    && typeof value.id === 'string'
    && canonicalDateTime(value.createdAt) !== null
    && Array.isArray(value.items) && value.items.length > 0 && value.items.length <= 100
    && value.items.every(validSavedMealLine)
    && typeof value.totalCarbohydratesG === 'number' && Number.isFinite(value.totalCarbohydratesG) && value.totalCarbohydratesG >= 0;
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
    manualProducts: Array.isArray(value.manualProducts) ? value.manualProducts.filter(validManualProduct).slice(0, 100) : [],
    productPhotos: Array.isArray(value.productPhotos) ? value.productPhotos.filter(validCatalogProductPhoto).slice(0, 50) : [],
    meals: Array.isArray(value.meals) ? value.meals.filter(validSavedMeal).slice(0, MAX_MEAL_ENTRIES) : [],
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
    ...envelope.calibrations.filter((item) => {
      if (item.scopeKey === normalized.scopeKey) return false;
      // One explicitly chosen default serving unit per concrete catalog product.
      return !(normalized.scope === 'catalog-product'
        && item.scope === 'catalog-product'
        && item.identity.catalogProductId === normalized.identity.catalogProductId);
    })
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
  envelope.meals = [];
  writeEnvelope(envelope);
}

/**
 * Persists the represented automatic calculation with the exact execution
 * time. The caller-provided timestamp is deliberately replaced so stale
 * snapshots or reused calculations cannot keep an earlier clock value.
 */
export function saveMealCalculation(
  entry: SavedMealCalculation,
  performedAt = new Date().toISOString()
): void {
  const timestamp = canonicalDateTime(performedAt);
  if (!timestamp) return;
  const timestamped: SavedMealCalculation = { ...entry, createdAt: timestamp };
  if (!validSavedMeal(timestamped)) return;
  const envelope = readEnvelope();
  envelope.meals = [
    timestamped,
    ...envelope.meals.filter((item) => item.id !== timestamped.id)
  ].slice(0, MAX_MEAL_ENTRIES);
  writeEnvelope(envelope);
}

export function listMealCalculations(): SavedMealCalculation[] { return readEnvelope().meals; }

export function deleteMealCalculation(id: string): void {
  const envelope = readEnvelope();
  envelope.meals = envelope.meals.filter((item) => item.id !== id);
  writeEnvelope(envelope);
}

export function exportHistoryData(): HistoryTransferData {
  const envelope = readEnvelope();
  return { calculations: envelope.history, meals: envelope.meals, calibrations: envelope.calibrations };
}

export function importHistoryData(value: unknown): { calculations: number; meals: number; calibrations: number } | null {
  if (!isRecord(value) || !Array.isArray(value.calculations) || !Array.isArray(value.meals) || !Array.isArray(value.calibrations)) return null;
  const calculations = value.calculations.filter(validHistoryEntry).slice(0, MAX_HISTORY_ENTRIES);
  const meals = value.meals.filter(validSavedMeal).slice(0, MAX_MEAL_ENTRIES);
  const calibrations = value.calibrations.map((entry) => normalizeCatalogCalibration(entry)).filter((entry): entry is CatalogUnitCalibration => entry !== null);
  const envelope = readEnvelope();
  envelope.history = [...calculations, ...envelope.history.filter((current) => !calculations.some((entry) => entry.id === current.id))].slice(0, MAX_HISTORY_ENTRIES);
  envelope.meals = [...meals, ...envelope.meals.filter((current) => !meals.some((entry) => entry.id === current.id))].slice(0, MAX_MEAL_ENTRIES);
  envelope.calibrations = [...calibrations, ...envelope.calibrations.filter((current) => !calibrations.some((entry) => entry.calibrationId === current.calibrationId || entry.scopeKey === current.scopeKey))];
  writeEnvelope(envelope);
  return { calculations: calculations.length, meals: meals.length, calibrations: calibrations.length };
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

export function saveManualProduct(product: ManualProduct): ManualProduct | null {
  if (!validManualProduct(product)) return null;
  const envelope = readEnvelope();
  envelope.manualProducts = [product, ...envelope.manualProducts.filter((item) => item.id !== product.id)].slice(0, 100);
  writeEnvelope(envelope);
  return product;
}

export function listManualProducts(): ManualProduct[] { return readEnvelope().manualProducts; }

export function deleteManualProduct(id: string): void {
  const envelope = readEnvelope();
  envelope.manualProducts = envelope.manualProducts.filter((item) => item.id !== id);
  writeEnvelope(envelope);
}

export function saveCatalogProductPhoto(productCode: string, imageDataUrl: string): CatalogProductPhoto | null {
  const photo: CatalogProductPhoto = { schemaVersion: 1, productCode: productCode.trim(), imageDataUrl, updatedAt: new Date().toISOString() };
  if (!validCatalogProductPhoto(photo)) return null;
  const envelope = readEnvelope();
  envelope.productPhotos = [photo, ...envelope.productPhotos.filter((item) => item.productCode !== photo.productCode)].slice(0, 50);
  writeEnvelope(envelope);
  return photo;
}

export function getCatalogProductPhoto(productCode: string): CatalogProductPhoto | null {
  return readEnvelope().productPhotos.find((item) => item.productCode === productCode) ?? null;
}

export function listCatalogProductPhotos(): CatalogProductPhoto[] { return readEnvelope().productPhotos; }

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
    history: envelope.history.length + envelope.meals.length,
    favorites: envelope.favorites.length,
    manualProducts: envelope.manualProducts.length,
    productPhotos: envelope.productPhotos.length
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

export function encodeMealCalculation(entry: SavedMealCalculation): string { return JSON.stringify(entry); }

export function decodeMealCalculation(raw: string | null): SavedMealCalculation | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw);
    return validSavedMeal(value) ? value : null;
  } catch {
    return null;
  }
}
