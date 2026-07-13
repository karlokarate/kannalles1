import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { CatalogDiagnostics, CatalogProduct, CatalogSearchHit, CatalogStatus } from '../lib/catalog/catalogDomain';
import { catalogDiagnostics, toCatalogFailure } from '../lib/catalog/catalogErrors';
import { cancelOfflineCatalogRequests, getOfflineCatalogProduct, initializeOfflineCatalog, searchOfflineCatalog } from '../lib/catalog/catalogClient';
import { calculateCatalogCarbohydrates, catalogProductEligibility, resolveCatalogUnits } from '../lib/resolution/catalogResolution';
import type { CatalogUnitRequest, ResolvedUnitOption } from '../lib/resolution/catalogResolution';
import { createCatalogCalibration, deriveCatalogCalibration, toMatchingUnitCalibration } from '../lib/resolution/catalogCalibration';
import type { CatalogCalibrationIdentity, CatalogCalibrationUnit } from '../lib/resolution/catalogCalibration';
import { catalogSearchReducer, createCatalogSearchState } from '../lib/searchState';
import { loadOfflineSettings, saveOfflineSettings } from '../lib/settings';
import type { OfflineAppSettings } from '../lib/settings';
import { clearAllUserData, clearHistoryEntries, clearSearchSession, createLocalId, findMatchingCatalogCalibrations, getUserDataCounts, isFavoriteProduct, listFavoriteProducts, listHistoryEntries, loadSearchSession, saveCatalogCalibration, saveHistoryEntry, saveSearchSession, toggleFavoriteProduct } from '../lib/userDataStore';
import type { AppSection, CalculationHistoryEntry, FavoriteProduct, UserDataCounts } from '../lib/userDataStore';
import { deleteManualProduct, listManualProducts, saveManualProduct as persistManualProduct } from '../lib/userDataStore';
import type { ManualProduct } from '../lib/userDataStore';
import { asGenericSearchHit, genericCookedProductForQuery, genericProductByCode, isGenericCatalogProduct } from '../lib/genericFoods';
import { clinicCatalogProducts, clinicDefaultRequest, clinicProductByCode, directClinicResolution, isClinicCatalogProduct, searchClinicCatalog } from '../lib/clinicCatalog';
import { resizeManualProductImage } from '../lib/manualProductImage';
import { startSpeechRecognitionSafely } from '../lib/speech';
import { inferredCalibrationUnit, selectDefaultCatalogCandidate } from './catalogViewModel';
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
export interface ManualState { id: string | null; label: string; carbohydratesPer100: string; amount: string; basis: 'mass' | 'volume'; imageDataUrl: string | null; }
const INITIAL_MANUAL: ManualState = { id: null, label: '', carbohydratesPer100: '', amount: '100', basis: 'mass', imageDataUrl: null };

function readNumber(value: string): number | null { const n = Number(value.replace(',', '.')); return Number.isFinite(n) && n > 0 ? n : null; }
function pickerRequest(request: CatalogUnitRequest): CatalogUnitRequest {
  return request.unit === 'kg' ? { amount: request.amount * 1_000, unit: 'g', unitExplicit: true } : request;
}
function identity(product: CatalogProduct): CatalogCalibrationIdentity { return { catalogProductId: product.productId, barcode: /^\d{8,14}$/.test(product.code) ? product.code : null, canonicalName: product.displayName, brandCanonical: product.brand, genericFoodKey: null }; }
const CALIBRATION_UNITS: readonly CatalogCalibrationUnit[] = ['piece', 'bar', 'slice', 'portion'];
function productCalibrations(product: CatalogProduct) { return CALIBRATION_UNITS.flatMap((unit) => findMatchingCatalogCalibrations(identity(product), unit, false)); }
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
  const [searchPage, setSearchPage] = useState(0);
  const [searchHasNext, setSearchHasNext] = useState(false);
  const [request, setRequest] = useState<CatalogUnitRequest>({ amount: 1, unit: 'g', unitExplicit: false });
  const [selectedOptionId, setSelectedOptionId] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [history, setHistory] = useState<CalculationHistoryEntry[]>(() => listHistoryEntries());
  const [favorites, setFavorites] = useState<FavoriteProduct[]>(() => listFavoriteProducts());
  const [counts, setCounts] = useState<UserDataCounts>(() => getUserDataCounts());
  const [manual, setManual] = useState<ManualState>(INITIAL_MANUAL);
  const [manualProducts, setManualProducts] = useState<ManualProduct[]>(() => listManualProducts());
  const [manualMessage, setManualMessage] = useState<string | null>(null);
  const [calibrationUnit, setCalibrationUnit] = useState<CatalogCalibrationUnit>('piece');
  const [calibrationCount, setCalibrationCount] = useState('10');
  const [calibrationWeight, setCalibrationWeight] = useState('');
  const [calibrationMessage, setCalibrationMessage] = useState<string | null>(null);
  const [speechListening, setSpeechListening] = useState(false);
  const [speechMessage, setSpeechMessage] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const restored = useRef(false);
  const product = search.selectedProduct;

  const refreshLocalData = useCallback(() => { setHistory(listHistoryEntries()); setFavorites(listFavoriteProducts()); setManualProducts(listManualProducts()); setCounts(getUserDataCounts()); setRevision((v) => v + 1); }, []);
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
    setRequest(pickerRequest({ amount: session.amount, unit: session.unit ?? 'g', unitExplicit: session.unit !== null }));
    if (session.selectedProductCode) {
      const local = genericProductByCode(session.selectedProductCode) ?? clinicProductByCode(session.selectedProductCode);
      if (local) dispatch({ type: 'resolve', query: session.query, product: local });
      else void getOfflineCatalogProduct(session.selectedProductCode).then((value) => { if (value) dispatch({ type: 'resolve', query: session.query, product: value }); }).catch(() => undefined);
    }
  }, [settings.restoreLastSession, status.state]);
  useEffect(() => {
    if (!settings.restoreLastSession) { clearSearchSession(); return; }
    saveSearchSession({ query, selectedProductCode: product?.code ?? null, amount: request.amount, unit: product ? request.unit : null, activeSection: section, manualMode });
  }, [manualMode, product, query, request.amount, request.unit, section, settings.restoreLastSession]);

  const resolution = useMemo(() => {
    void revision;
    if (!product) return null;
    if (isClinicCatalogProduct(product)) {
      const direct = directClinicResolution(product);
      if (direct) return direct;
    }
    const matches = isGenericCatalogProduct(product) || isClinicCatalogProduct(product) ? [] : productCalibrations(product).map(toMatchingUnitCalibration);
    return resolveCatalogUnits(product, request, matches);
  }, [product, request, revision]);
  useEffect(() => { setSelectedOptionId((current) => resolution && current && resolution.options.some((o) => o.id === current) ? current : resolution?.selectedOptionId ?? null); }, [resolution]);
  const effectiveResolution = useMemo(() => resolution ? { ...resolution, selectedOptionId } : null, [resolution, selectedOptionId]);
  const calculation = useMemo(() => product && effectiveResolution ? calculateCatalogCarbohydrates(product, request, effectiveResolution) : null, [effectiveResolution, product, request]);
  const selectedOption = useMemo<ResolvedUnitOption | null>(() => effectiveResolution?.options.find((o) => o.id === effectiveResolution.selectedOptionId) ?? null, [effectiveResolution]);
  const calibrationPreview = useMemo(() => {
    if (product === null || product.nutrition.basis !== 'mass' || isGenericCatalogProduct(product) || isClinicCatalogProduct(product)) return null;
    const count = Math.trunc(readNumber(calibrationCount) ?? 0);
    const weight = readNumber(calibrationWeight); if (!weight) return null;
    return deriveCatalogCalibration(count, weight, request.amount, product.nutrition.carbohydratesPer100);
  }, [calibrationCount, calibrationWeight, product, request.amount]);
  const manualCalculation = useMemo(() => { const per100 = readNumber(manual.carbohydratesPer100); const amount = readNumber(manual.amount); if (per100 === null || amount === null || per100 > (manual.basis === 'mass' ? 100 : 200)) return null; return amount * per100 / 100; }, [manual]);

  const executeSearch = useCallback(async (raw: string, page = 0) => {
    const parsed = parseCatalogQuery(raw);
    if (!parsed) { dispatch({ type: 'validation', message: 'Bitte Produktname oder Barcode eingeben.' }); return; }
    const pageSize = Math.min(20, settings.searchResultLimit);
    const offset = Math.max(0, page) * pageSize;
    const clinicMatches = parsed.barcode || settings.clinicMode === 'off' ? [] : searchClinicCatalog(parsed.catalogQuery, Number.MAX_SAFE_INTEGER);
    const cookedGeneric = parsed.barcode || settings.clinicMode === 'clinic-only' ? null : genericCookedProductForQuery(parsed.catalogQuery);
    if (settings.clinicMode === 'clinic-only') {
      const hits = clinicMatches.slice(offset, offset + pageSize);
      setSearchPage(page); setSearchHasNext(offset + pageSize < clinicMatches.length);
      if (!hits.length) { dispatch({ type: 'not-found', query: parsed.catalogQuery }); return; }
      const flags = hits.map((hit) => catalogProductEligibility(hit).eligible);
      const preferred = selectDefaultCatalogCandidate(hits, parsed.catalogQuery, flags);
      if (preferred) {
        if (isClinicCatalogProduct(preferred) && !parsed.amountExplicit && !parsed.unitExplicit) setRequest(clinicDefaultRequest(preferred));
        else setRequest(pickerRequest({ amount: parsed.amount, unit: parsed.unit, unitExplicit: parsed.unitExplicit }));
        dispatch({ type: 'resolve', query: parsed.catalogQuery, product: preferred, candidates: hits });
      } else dispatch({ type: 'show-choice', query: parsed.catalogQuery, candidates: hits });
      return;
    }
    if (status.state !== 'ready') { dispatch({ type: 'validation', message: 'Der lokale Katalog ist noch nicht bereit. Erneutes Laden ist sofort möglich.' }); return; }
    abortRef.current?.abort(); const controller = new AbortController(); abortRef.current = controller;
    setRequest(pickerRequest({ amount: parsed.amount, unit: parsed.unit, unitExplicit: parsed.unitExplicit })); setSelectedOptionId(null); dispatch({ type: 'start', query: parsed.catalogQuery });
    try {
      if (parsed.barcode) {
        const value = await getOfflineCatalogProduct(parsed.barcode, controller.signal);
        if (!value) dispatch({ type: 'not-found', query: parsed.catalogQuery });
        else if (!catalogProductEligibility(value).eligible) dispatch({ type: 'validation', message: 'Der Katalogeintrag enthält keine sicher berechenbaren Kohlenhydratdaten.' });
        else dispatch({ type: 'resolve', query: parsed.catalogQuery, product: value });
        return;
      }
      const localMatches = cookedGeneric ? [asGenericSearchHit(cookedGeneric), ...clinicMatches] : clinicMatches;
      const localPage = localMatches.slice(offset, offset + pageSize);
      const remaining = pageSize - localPage.length;
      const sqliteOffset = Math.max(0, offset - localMatches.length);
      const sqliteHits = remaining > 0
        ? await searchOfflineCatalog(parsed.catalogQuery, remaining + 1, controller.signal, sqliteOffset)
        : [];
      const hits = [...localPage, ...sqliteHits.slice(0, remaining)].map((hit, resultIndex) => ({ ...hit, resultIndex }));
      setSearchPage(page);
      setSearchHasNext(offset + localPage.length < localMatches.length || (remaining > 0 && sqliteHits.length >= remaining) || (remaining === 0 && status.state === 'ready'));
      if (!hits.length) { dispatch({ type: 'not-found', query: parsed.catalogQuery }); return; }
      const flags = hits.map((hit) => catalogProductEligibility(hit).eligible);
      const preferred = selectDefaultCatalogCandidate(hits, parsed.catalogQuery, flags);
      if (preferred) {
        if (isGenericCatalogProduct(preferred) && !parsed.amountExplicit && !parsed.unitExplicit) setRequest({ amount: 200, unit: 'g', unitExplicit: true });
        else if (isClinicCatalogProduct(preferred) && !parsed.amountExplicit && !parsed.unitExplicit) setRequest(clinicDefaultRequest(preferred));
        dispatch({ type: 'resolve', query: parsed.catalogQuery, product: preferred, candidates: hits });
      }
      else dispatch({ type: 'show-choice', query: parsed.catalogQuery, candidates: hits });
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) dispatch({ type: 'failed', query: parsed.catalogQuery, diagnostics: diagnostic(error, parsed.barcode ? 'product_lookup' : 'search', 'Die lokale Katalogabfrage konnte nicht abgeschlossen werden.') });
    } finally { if (abortRef.current === controller) abortRef.current = null; }
  }, [settings.clinicMode, settings.searchResultLimit, status.state]);

  const selectCandidate = (hit: CatalogSearchHit) => { if (!catalogProductEligibility(hit).eligible) dispatch({ type: 'validation', message: isClinicCatalogProduct(hit) ? 'Für diesen Klinikdatensatz ist ausdrücklich kein berechenbarer KH-Wert hinterlegt.' : 'Dieser Katalogeintrag ist nicht sicher berechenbar.' }); else { if (isClinicCatalogProduct(hit)) setRequest(clinicDefaultRequest(hit)); dispatch({ type: 'resolve', query: search.query, product: hit }); } };
  const changeSearchPage = (page: number) => { if (page < 0 || (page > searchPage && !searchHasNext)) return; void executeSearch(query, page); };
  const selectUnit = (id: string) => { const option = resolution?.options.find((o) => o.id === id); if (!option) return; setRequest((r) => ({ ...r, unit: option.unit, unitExplicit: true })); setSelectedOptionId(id); setCalibrationMessage(null); };
  useEffect(() => {
    if (!product || isGenericCatalogProduct(product) || isClinicCatalogProduct(product)) return;
    const unit = inferredCalibrationUnit(product);
    const saved = findMatchingCatalogCalibrations(identity(product), unit, false)[0];
    setCalibrationUnit(unit);
    setCalibrationCount(saved ? String(saved.measurement.measuredCount) : '10');
    setCalibrationWeight(saved ? String(saved.measurement.measuredTotalWeightG) : '');
    setCalibrationMessage(saved ? 'Persönliche Einheit geladen.' : null);
  }, [product]);

  useEffect(() => {
    if (product === null || product.nutrition.basis !== 'mass' || isGenericCatalogProduct(product) || isClinicCatalogProduct(product) || !calibrationPreview) return;
    const measuredCount = Math.trunc(readNumber(calibrationCount) ?? 0);
    const weight = readNumber(calibrationWeight);
    if (!weight || measuredCount < 1) return;
    const existing = findMatchingCatalogCalibrations(identity(product), calibrationUnit, false)[0];
    if (existing && existing.measurement.measuredCount === measuredCount && existing.measurement.measuredTotalWeightG === weight) return;
    setCalibrationMessage('Wird automatisch gespeichert …');
    const timer = window.setTimeout(() => {
      const record = createCatalogCalibration({ calibrationId: createLocalId('cal'), scope: 'catalog-product', identity: identity(product), unit: calibrationUnit, measuredCount, measuredTotalWeightG: weight, smallestEdibleUnit: calibrationUnit !== 'portion', now: new Date().toISOString() });
      if (!record || !saveCatalogCalibration(record)) { setCalibrationMessage('Die Messung konnte nicht gespeichert werden.'); return; }
      setRequest((current) => ({ ...current, unit: calibrationUnit, unitExplicit: false }));
      setSelectedOptionId(`${calibrationUnit}:user_calibration:${String(calibrationPreview.unitWeightG)}`);
      setCalibrationMessage(`${calibrationPreview.unitWeightG.toLocaleString('de-DE')} g je ${calibrationUnit === 'bar' ? 'Riegel' : calibrationUnit === 'slice' ? 'Scheibe' : calibrationUnit === 'portion' ? 'Portion' : 'Stück'} gespeichert.`);
      refreshLocalData();
    }, 600);
    return () => window.clearTimeout(timer);
  }, [calibrationCount, calibrationPreview, calibrationUnit, calibrationWeight, product, refreshLocalData]);

  const changeCalibrationUnit = (unit: CatalogCalibrationUnit) => {
    setCalibrationUnit(unit);
    if (!product) return;
    const saved = findMatchingCatalogCalibrations(identity(product), unit, false)[0];
    setCalibrationCount(saved ? String(saved.measurement.measuredCount) : '10');
    setCalibrationWeight(saved ? String(saved.measurement.measuredTotalWeightG) : '');
    setCalibrationMessage(saved ? 'Persönliche Einheit geladen.' : null);
  };

  const startVoiceSearch = () => {
    const Constructor = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!Constructor) { setSpeechMessage('Sprachsuche wird von diesem Browser nicht unterstützt. Die Texteingabe bleibt verfügbar.'); return; }
    const recognition = new Constructor();
    recognition.lang = 'de-DE'; recognition.interimResults = false; recognition.continuous = false;
    recognition.onresult = (event) => { const transcript = event.results[0]?.[0]?.transcript?.trim(); if (transcript) { setQuery(transcript); setSpeechMessage(`Erkannt: „${transcript}“`); void executeSearch(transcript); } };
    recognition.onerror = () => { setSpeechListening(false); setSpeechMessage('Spracheingabe fehlgeschlagen. Du kannst sofort erneut starten oder Text eingeben.'); };
    recognition.onend = () => setSpeechListening(false);
    startSpeechRecognitionSafely(recognition, setSpeechListening, () => setSpeechMessage('Die Spracheingabe konnte nicht gestartet werden. Die Texteingabe bleibt verfügbar.'));
  };
  const saveCurrent = () => {
    if (!settings.saveHistory || !product || !selectedOption || calculation?.status !== 'calculated' || calculation.carbohydratesG === null || calculation.unitBaseValue === null) return;
    saveHistoryEntry({ schemaVersion: 2, id: createLocalId('calc'), createdAt: new Date().toISOString(), product: { productId: product.productId, code: product.code, displayName: product.displayName, brand: product.brand }, amount: request.amount, unit: calculation.unit, unitBaseValue: calculation.unitBaseValue, totalCarbohydratesG: calculation.carbohydratesG, carbohydratesPer100: product.nutrition.carbohydratesPer100, nutritionBasis: product.nutrition.basis, provenance: { source: selectedOption.source === 'user_calibration' ? 'user-calibration' : 'catalog', catalogVersion: status.catalogVersion, calibrationId: selectedOption.source === 'user_calibration' ? selectedOption.id : null } }); refreshLocalData();
  };
  const saveManual = () => { const per100 = readNumber(manual.carbohydratesPer100); const amount = readNumber(manual.amount); if (!settings.saveHistory || manualCalculation === null || per100 === null || amount === null) return; saveHistoryEntry({ schemaVersion: 2, id: createLocalId('manual'), createdAt: new Date().toISOString(), product: { productId: null, code: null, displayName: manual.label.trim() || 'Manuelle Berechnung', brand: null }, amount, unit: manual.basis === 'mass' ? 'g' : 'ml', unitBaseValue: 1, totalCarbohydratesG: manualCalculation, carbohydratesPer100: per100, nutritionBasis: manual.basis, provenance: { source: 'manual', catalogVersion: null, calibrationId: null } }); refreshLocalData(); };
  const saveManualDefinition = () => {
    const per100 = readNumber(manual.carbohydratesPer100); const label = manual.label.trim();
    if (!label || per100 === null || per100 > (manual.basis === 'mass' ? 100 : 200)) { setManualMessage('Bitte Name und gültigen KH-Wert eintragen.'); return; }
    const existing = manual.id ? manualProducts.find((item) => item.id === manual.id) : null;
    const now = new Date().toISOString();
    const saved = persistManualProduct({ schemaVersion: 1, id: manual.id ?? createLocalId('manual-product'), label, carbohydratesPer100: per100, basis: manual.basis, imageDataUrl: manual.imageDataUrl, createdAt: existing?.createdAt ?? now, updatedAt: now });
    if (!saved) { setManualMessage('Das Produkt konnte nicht lokal gespeichert werden.'); return; }
    setManual((current) => ({ ...current, id: saved.id })); setManualMessage('Produkt automatisch lokal gespeichert.'); refreshLocalData();
  };
  const loadManualDefinition = (item: ManualProduct) => { setManual({ id: item.id, label: item.label, carbohydratesPer100: String(item.carbohydratesPer100), amount: '100', basis: item.basis, imageDataUrl: item.imageDataUrl }); setManualMessage('Gespeichertes Produkt geladen.'); };
  const removeManualDefinition = (id: string) => { deleteManualProduct(id); if (manual.id === id) setManual(INITIAL_MANUAL); refreshLocalData(); };
  const setManualPhoto = async (file: File | null) => { if (!file) return; try { const imageDataUrl = await resizeManualProductImage(file); setManual((current) => ({ ...current, imageDataUrl })); setManualMessage('Foto verkleinert und bereit zum Speichern.'); } catch (error) { setManualMessage(error instanceof Error ? error.message : 'Foto konnte nicht verarbeitet werden.'); } };
  const updateSettings = (next: OfflineAppSettings) => {
    const saved = saveOfflineSettings(next);
    if (saved.clinicMode !== settings.clinicMode) {
      abortRef.current?.abort();
      dispatch({ type: 'reset' });
      setSearchPage(0);
      setSearchHasNext(false);
      setSelectedOptionId(null);
    }
    setSettings(saved);
    if (!saved.restoreLastSession) clearSearchSession();
  };
  const toggleFavorite = () => { if (product) { toggleFavoriteProduct(product); refreshLocalData(); } };
  const clearHistory = () => { clearHistoryEntries(); refreshLocalData(); };
  const clearAll = () => { clearAllUserData(); refreshLocalData(); };

  return { settings, updateSettings, status, setStatus, installedFromNetwork, initialize, section, setSection, manualMode, setManualMode, query, setQuery, search, dispatch, executeSearch, searchPage, searchHasNext, changeSearchPage, clinicBrowseCandidates: settings.clinicMode === 'clinic-only' ? clinicCatalogProducts() : [], startVoiceSearch, speechListening, speechMessage, product, request, setRequest, resolution, selectedOptionId, selectUnit, selectedOption, calculation, selectCandidate, calibrationUnit, changeCalibrationUnit, calibrationCount, setCalibrationCount, calibrationWeight, setCalibrationWeight, calibrationPreview, calibrationMessage, manual, setManual, manualCalculation, saveManual, manualProducts, manualMessage, saveManualDefinition, loadManualDefinition, removeManualDefinition, setManualPhoto, history, favorites, counts, refreshLocalData, saveCurrent, isFavorite: product ? isFavoriteProduct(product.productId) : false, toggleFavorite, clearHistory, clearSession: clearSearchSession, clearAll };
}

export type CatalogController = ReturnType<typeof useCatalogController>;
