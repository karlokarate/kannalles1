import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { CatalogDiagnostics, CatalogProduct, CatalogSearchHit, CatalogStatus } from '../lib/catalog/catalogDomain';
import { catalogDiagnostics, toCatalogFailure } from '../lib/catalog/catalogErrors';
import { cancelOfflineCatalogRequests, getOfflineCatalogProduct, initializeOfflineCatalog, searchOfflineCatalog } from '../lib/catalog/catalogClient';
import { calculateCatalogCarbohydrates, catalogProductEligibility, resolveCatalogUnits } from '../lib/resolution/catalogResolution';
import type { CatalogUnitRequest, ResolvedUnitOption } from '../lib/resolution/catalogResolution';
import { createCatalogCalibration, deriveCatalogCalibration, deriveGroupCalibration, toMatchingUnitCalibration } from '../lib/resolution/catalogCalibration';
import type { CatalogCalibrationIdentity, CatalogCalibrationUnit } from '../lib/resolution/catalogCalibration';
import { catalogSearchReducer, createCatalogSearchState } from '../lib/searchState';
import { loadOfflineSettings, saveOfflineSettings } from '../lib/settings';
import type { OfflineAppSettings } from '../lib/settings';
import { clearAllUserData, clearHistoryEntries, clearSearchSession, createLocalId, findMatchingCatalogCalibrations, getUserDataCounts, isFavoriteProduct, listFavoriteProducts, listHistoryEntries, loadSearchSession, saveCatalogCalibration, saveHistoryEntry, saveSearchSession, toggleFavoriteProduct } from '../lib/userDataStore';
import type { AppSection, CalculationHistoryEntry, FavoriteProduct, UserDataCounts } from '../lib/userDataStore';
import { autoSelectionEligibility, calibratableRequestedUnit } from './catalogViewModel';
import { parseCatalogQuery } from './queryParser';

const VERSION_MARKER = 'kh-checker:installed-catalog-version:v1';
const INITIAL_STATUS: CatalogStatus = {
  state: 'idle',
  activeSlot: null,
  rollbackSlot: null,
  slotStates: { a: 'empty', b: 'empty' },
  catalogVersion: null,
  productCount: null,
  persistent: false,
  progress: null,
  diagnostics: null,
  retryAllowedImmediately: true
};
export interface ManualState { label: string; carbohydratesPer100: string; amount: string; basis: 'mass' | 'volume'; }
const INITIAL_MANUAL: ManualState = { label: '', carbohydratesPer100: '', amount: '100', basis: 'mass' };

function readNumber(value: string): number | null { const n = Number(value.replace(',', '.')); return Number.isFinite(n) && n > 0 ? n : null; }
function identity(product: CatalogProduct): CatalogCalibrationIdentity { return { catalogProductId: product.productId, barcode: product.code, canonicalName: product.displayName, brandCanonical: product.brand, genericFoodKey: null }; }
function calibrationUnit(product: CatalogProduct, request: CatalogUnitRequest): CatalogCalibrationUnit | null { if (request.unitExplicit && calibratableRequestedUnit(request.unit)) return request.unit; const defaultUnit = product.unitEvidence.defaultUnitKind; return calibratableRequestedUnit(defaultUnit) ? defaultUnit : null; }
function diagnostic(error: unknown, operation: 'initialize' | 'search' | 'product_lookup', message: string): CatalogDiagnostics { return catalogDiagnostics(error) ?? toCatalogFailure(error, 'CATALOG_QUERY_FAILED', message, { operation }).diagnostics; }
function firstInstall(status: CatalogStatus): boolean { if (status.state !== 'ready' || !status.catalogVersion || typeof window === 'undefined') return false; try { const previous = localStorage.getItem(VERSION_MARKER); localStorage.setItem(VERSION_MARKER, status.catalogVersion); return previous !== status.catalogVersion; } catch { return false; } }

export function useCatalogController() {
  const [settings, setSettings] = useState<OfflineAppSettings>(() => loadOfflineSettings());
  const [status, setStatus] = useState<CatalogStatus>(INITIAL_STATUS);
  const [installedFromNetwork, setInstalledFromNetwork] = useState(false);
  const [section, setSection] = useState<AppSection>('calculator');
  const [manualMode, setManualMode] = useState(false);
  const [query, setQuery] = useState('');
  const [search, dispatch] = useReducer(catalogSearchReducer, undefined, createCatalogSearchState);
  const [request, setRequest] = useState<CatalogUnitRequest>({ amount: 1, unit: 'g', unitExplicit: false });
  const [selectedOptionId, setSelectedOptionId] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [history, setHistory] = useState<CalculationHistoryEntry[]>(() => listHistoryEntries());
  const [favorites, setFavorites] = useState<FavoriteProduct[]>(() => listFavoriteProducts());
  const [counts, setCounts] = useState<UserDataCounts>(() => getUserDataCounts());
  const [manual, setManual] = useState<ManualState>(INITIAL_MANUAL);
  const [calibrationMode, setCalibrationMode] = useState<'single' | 'group'>('group');
  const [calibrationCount, setCalibrationCount] = useState('2');
  const [calibrationWeight, setCalibrationWeight] = useState('');
  const [calibrationMessage, setCalibrationMessage] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const restored = useRef(false);
  const product = search.selectedProduct;

  const refreshLocalData = useCallback(() => { setHistory(listHistoryEntries()); setFavorites(listFavoriteProducts()); setCounts(getUserDataCounts()); setRevision((v) => v + 1); }, []);
  const initialize = useCallback(async () => {
    setStatus((s) => ({ ...s, state: 'checking', diagnostics: null, progress: null }));
    try { const next = await initializeOfflineCatalog(); setStatus(next); setInstalledFromNetwork(firstInstall(next)); }
    catch (error) { const d = diagnostic(error, 'initialize', 'Der lokale Produktkatalog konnte nicht geöffnet werden.'); setStatus({ state: 'unavailable', activeSlot: d.activeSlot, rollbackSlot: d.rollbackSlot, slotStates: { a: 'empty', b: 'empty' }, catalogVersion: d.catalogVersion, productCount: null, persistent: false, progress: null, diagnostics: d, retryAllowedImmediately: true }); }
  }, []);

  useEffect(() => { void initialize(); return () => { abortRef.current?.abort(); cancelOfflineCatalogRequests(); }; }, [initialize]);
  useEffect(() => { const listener = () => refreshLocalData(); addEventListener('kh:offline-user-data-changed', listener); return () => removeEventListener('kh:offline-user-data-changed', listener); }, [refreshLocalData]);
  useEffect(() => {
    if (restored.current || status.state !== 'ready') return;
    restored.current = true;
    const session = settings.restoreLastSession ? loadSearchSession() : null;
    if (!session) return;
    setQuery(session.query); setSection(session.activeSection); setManualMode(session.manualMode);
    setRequest({ amount: session.amount, unit: session.unit ?? 'g', unitExplicit: session.unit !== null });
    if (session.selectedProductCode) void getOfflineCatalogProduct(session.selectedProductCode).then((value) => { if (value) dispatch({ type: 'resolve', query: session.query, product: value }); }).catch(() => undefined);
  }, [settings.restoreLastSession, status.state]);
  useEffect(() => {
    if (!settings.restoreLastSession) { clearSearchSession(); return; }
    saveSearchSession({ query, selectedProductCode: product?.code ?? null, amount: request.amount, unit: product ? request.unit : null, activeSection: section, manualMode });
  }, [manualMode, product, query, request.amount, request.unit, section, settings.restoreLastSession]);

  const resolution = useMemo(() => {
    void revision;
    if (!product) return null;
    const unit = calibrationUnit(product, request);
    const matches = unit ? findMatchingCatalogCalibrations(identity(product), unit, false).map(toMatchingUnitCalibration) : [];
    return resolveCatalogUnits(product, request, matches);
  }, [product, request, revision]);
  useEffect(() => { setSelectedOptionId((current) => resolution && current && resolution.options.some((o) => o.id === current) ? current : resolution?.selectedOptionId ?? null); }, [resolution]);
  const effectiveResolution = useMemo(() => resolution ? { ...resolution, selectedOptionId } : null, [resolution, selectedOptionId]);
  const calculation = useMemo(() => product && effectiveResolution ? calculateCatalogCarbohydrates(product, request, effectiveResolution) : null, [effectiveResolution, product, request]);
  const selectedOption = useMemo<ResolvedUnitOption | null>(() => effectiveResolution?.options.find((o) => o.id === effectiveResolution.selectedOptionId) ?? null, [effectiveResolution]);
  const calibrationPreview = useMemo(() => {
    if (!product || !selectedOption || !calibratableRequestedUnit(selectedOption.unit)) return null;
    const count = calibrationMode === 'single' ? 1 : Math.trunc(readNumber(calibrationCount) ?? 0);
    const weight = readNumber(calibrationWeight); if (!weight) return null;
    return calibrationMode === 'group' ? deriveGroupCalibration(count, weight, request.amount, product.nutrition.carbohydratesPer100) : deriveCatalogCalibration(1, weight, request.amount, product.nutrition.carbohydratesPer100);
  }, [calibrationCount, calibrationMode, calibrationWeight, product, request.amount, selectedOption]);
  const manualCalculation = useMemo(() => { const per100 = readNumber(manual.carbohydratesPer100); const amount = readNumber(manual.amount); if (per100 === null || amount === null || per100 > (manual.basis === 'mass' ? 100 : 200)) return null; return amount * per100 / 100; }, [manual]);

  const executeSearch = useCallback(async (raw: string) => {
    const parsed = parseCatalogQuery(raw);
    if (!parsed) { dispatch({ type: 'validation', message: 'Bitte Produktname oder Barcode eingeben.' }); return; }
    if (status.state !== 'ready') { dispatch({ type: 'validation', message: 'Der lokale Katalog ist noch nicht bereit. Erneutes Laden ist sofort möglich.' }); return; }
    abortRef.current?.abort(); const controller = new AbortController(); abortRef.current = controller;
    setRequest({ amount: parsed.amount, unit: parsed.unit, unitExplicit: parsed.unitExplicit }); setSelectedOptionId(null); dispatch({ type: 'start', query: parsed.catalogQuery });
    try {
      if (parsed.barcode) {
        const value = await getOfflineCatalogProduct(parsed.barcode, controller.signal);
        if (!value) dispatch({ type: 'not-found', query: parsed.catalogQuery });
        else if (!catalogProductEligibility(value).eligible) dispatch({ type: 'validation', message: 'Der Katalogeintrag enthält keine sicher berechenbaren Kohlenhydratdaten.' });
        else dispatch({ type: 'resolve', query: parsed.catalogQuery, product: value });
        return;
      }
      const hits = await searchOfflineCatalog(parsed.catalogQuery, settings.searchResultLimit, controller.signal);
      if (!hits.length) { dispatch({ type: 'not-found', query: parsed.catalogQuery }); return; }
      const flags = hits.map((hit) => catalogProductEligibility(hit).eligible);
      const eligibleCount = flags.filter(Boolean).length;
      const index = hits.findIndex((hit, i) => autoSelectionEligibility(hit, parsed.catalogQuery, flags[i], eligibleCount).eligible);
      if (index >= 0) dispatch({ type: 'resolve', query: parsed.catalogQuery, product: hits[index], candidates: hits });
      else dispatch({ type: 'show-choice', query: parsed.catalogQuery, candidates: hits });
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) dispatch({ type: 'failed', query: parsed.catalogQuery, diagnostics: diagnostic(error, parsed.barcode ? 'product_lookup' : 'search', 'Die lokale Katalogabfrage konnte nicht abgeschlossen werden.') });
    } finally { if (abortRef.current === controller) abortRef.current = null; }
  }, [settings.searchResultLimit, status.state]);

  const selectCandidate = (hit: CatalogSearchHit) => { if (!catalogProductEligibility(hit).eligible) dispatch({ type: 'validation', message: 'Dieser Katalogeintrag ist nicht sicher berechenbar.' }); else dispatch({ type: 'resolve', query: search.query, product: hit }); };
  const selectUnit = (id: string) => { const option = resolution?.options.find((o) => o.id === id); if (!option) return; setRequest((r) => ({ ...r, unit: option.unit, unitExplicit: true })); setSelectedOptionId(id); setCalibrationMessage(null); };
  const saveCalibration = () => {
    if (!product || !selectedOption || !calibratableRequestedUnit(selectedOption.unit)) return;
    const measuredCount = calibrationMode === 'single' ? 1 : Math.trunc(readNumber(calibrationCount) ?? 0); const weight = readNumber(calibrationWeight);
    if (!weight || measuredCount < (calibrationMode === 'group' ? 2 : 1)) { setCalibrationMessage('Bitte gültige Messwerte eingeben.'); return; }
    const record = createCatalogCalibration({ calibrationId: createLocalId('cal'), scope: 'catalog-product', identity: identity(product), unit: selectedOption.unit, measuredCount, measuredTotalWeightG: weight, smallestEdibleUnit: selectedOption.unit !== 'portion', now: new Date().toISOString() });
    if (!record || !saveCatalogCalibration(record)) { setCalibrationMessage('Die Messung konnte nicht gespeichert werden.'); return; }
    setCalibrationMessage('Kalibrierung gespeichert und neu berechnet.'); setCalibrationWeight(''); refreshLocalData();
  };
  const saveCurrent = () => {
    if (!settings.saveHistory || !product || !selectedOption || calculation?.status !== 'calculated' || calculation.carbohydratesG === null || calculation.unitBaseValue === null) return;
    saveHistoryEntry({ schemaVersion: 2, id: createLocalId('calc'), createdAt: new Date().toISOString(), product: { productId: product.productId, code: product.code, displayName: product.displayName, brand: product.brand }, amount: request.amount, unit: calculation.unit, unitBaseValue: calculation.unitBaseValue, totalCarbohydratesG: calculation.carbohydratesG, carbohydratesPer100: product.nutrition.carbohydratesPer100, nutritionBasis: product.nutrition.basis, provenance: { source: selectedOption.source === 'user_calibration' ? 'user-calibration' : 'catalog', catalogVersion: status.catalogVersion, calibrationId: selectedOption.source === 'user_calibration' ? selectedOption.id : null } }); refreshLocalData();
  };
  const saveManual = () => { const per100 = readNumber(manual.carbohydratesPer100); const amount = readNumber(manual.amount); if (!settings.saveHistory || manualCalculation === null || per100 === null || amount === null) return; saveHistoryEntry({ schemaVersion: 2, id: createLocalId('manual'), createdAt: new Date().toISOString(), product: { productId: null, code: null, displayName: manual.label.trim() || 'Manuelle Berechnung', brand: null }, amount, unit: manual.basis === 'mass' ? 'g' : 'ml', unitBaseValue: 1, totalCarbohydratesG: manualCalculation, carbohydratesPer100: per100, nutritionBasis: manual.basis, provenance: { source: 'manual', catalogVersion: null, calibrationId: null } }); refreshLocalData(); };
  const updateSettings = (next: OfflineAppSettings) => { const saved = saveOfflineSettings(next); setSettings(saved); if (!saved.restoreLastSession) clearSearchSession(); };
  const toggleFavorite = () => { if (product) { toggleFavoriteProduct(product); refreshLocalData(); } };
  const clearHistory = () => { clearHistoryEntries(); refreshLocalData(); };
  const clearAll = () => { clearAllUserData(); refreshLocalData(); };

  return { settings, updateSettings, status, setStatus, installedFromNetwork, initialize, section, setSection, manualMode, setManualMode, query, setQuery, search, dispatch, executeSearch, product, request, setRequest, resolution, selectedOptionId, selectUnit, selectedOption, calculation, selectCandidate, calibrationMode, setCalibrationMode, calibrationCount, setCalibrationCount, calibrationWeight, setCalibrationWeight, calibrationPreview, calibrationMessage, saveCalibration, manual, setManual, manualCalculation, saveManual, history, favorites, counts, refreshLocalData, saveCurrent, isFavorite: product ? isFavoriteProduct(product.productId) : false, toggleFavorite, clearHistory, clearSession: clearSearchSession, clearAll };
}

export type CatalogController = ReturnType<typeof useCatalogController>;
