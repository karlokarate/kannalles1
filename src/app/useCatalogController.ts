import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { CatalogDiagnostics, CatalogProduct, CatalogSearchHit, CatalogStatus } from '../lib/catalog/catalogDomain';
import { catalogDiagnostics, toCatalogFailure } from '../lib/catalog/catalogErrors';
import { cancelOfflineCatalogRequests, getOfflineCatalogProduct, initializeOfflineCatalog, searchOfflineCatalog } from '../lib/catalog/catalogClient';
import { calculateCatalogCarbohydrates, catalogProductEligibility } from '../lib/resolution/catalogResolution';
import type { CatalogUnitRequest, ResolvedUnitOption } from '../lib/resolution/catalogResolution';
import { createCatalogCalibration, deriveCatalogCalibration } from '../lib/resolution/catalogCalibration';
import type { CatalogCalibrationUnit } from '../lib/resolution/catalogCalibration';
import { catalogSearchReducer, createCatalogSearchState } from '../lib/searchState';
import { loadOfflineSettings, saveOfflineSettings } from '../lib/settings';
import type { OfflineAppSettings } from '../lib/settings';
import { clearAllUserData, clearHistoryEntries, clearSearchSession, createLocalId, deleteMealCalculation, getUserDataCounts, importHistoryData, isFavoriteProduct, listCatalogProductPhotos, listFavoriteProducts, listHistoryEntries, listMealCalculations, loadSearchSession, saveCatalogCalibration, saveCatalogProductPhoto, saveHistoryEntry, saveMealCalculation, saveSearchSession, toggleFavoriteProduct } from '../lib/userDataStore';
import type { AppSection, CalculationHistoryEntry, CatalogProductPhoto, FavoriteProduct, SavedMealCalculation, UserDataCounts } from '../lib/userDataStore';
import { deleteManualProduct, listManualProducts, saveManualProduct as persistManualProduct } from '../lib/userDataStore';
import type { ManualProduct } from '../lib/userDataStore';
import { asGenericSearchHit, genericCookedProductForQuery, genericProductByCode, isGenericCatalogProduct } from '../lib/genericFoods';
import { clinicCatalogProducts, clinicProductByCode, isClinicCatalogProduct, searchClinicCatalog } from '../lib/clinicCatalog';
import { resizeManualProductImage } from '../lib/manualProductImage';
import { isAppleMobileSpeechClient, speechRecognitionErrorMessage, startSpeechRecognitionSafely, unavailableSpeechMessage } from '../lib/speech';
import { createTransferFile, parseTransferFile, serializeTransferFile } from '../lib/dataTransfer';
import { createMealCalculationItem, totalMealCarbohydrates, updateMealCalculationItem } from '../lib/mealCalculation';
import type { MealCalculationItem } from '../lib/mealCalculation';
import {
  catalogCalibrationForUnit,
  catalogCalibrationIdentity,
  normalizeCatalogUnitRequest,
  resolveCatalogUnitRuntime
} from './catalogUnitRuntime';
import {
  requestForBareCatalogProduct,
  requestForCatalogVariant,
  requestForInitialCatalogProduct,
  requestFromParsedCatalogInput
} from './catalogInputRequest';
import { inferredCalibrationUnit, selectDefaultCatalogCandidate } from './catalogViewModel';
import { parseCatalogQuery, parseProductList } from './queryParser';
import { useCatalogUnitSelection } from './useCatalogUnitSelection';

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
function diagnostic(error: unknown, operation: 'initialize' | 'search' | 'product_lookup', message: string): CatalogDiagnostics { return catalogDiagnostics(error) ?? toCatalogFailure(error, 'CATALOG_QUERY_FAILED', message, { operation }).diagnostics; }
function firstInstall(status: CatalogStatus): boolean { if (status.state !== 'ready' || !status.catalogVersion || typeof window === 'undefined') return false; try { const previous = localStorage.getItem(VERSION_MARKER); localStorage.setItem(VERSION_MARKER, status.catalogVersion); return previous !== status.catalogVersion; } catch { return false; } }
function savedMealFromItems(id: string, items: readonly MealCalculationItem[], createdAt = new Date().toISOString()): SavedMealCalculation {
  return { schemaVersion: 1, id, createdAt, items: items.map((item) => ({ id: item.id, productCode: item.product.code, productName: item.product.displayName, amount: item.request.amount, unit: item.calculation.unit, selectedOptionId: item.resolution.selectedOptionId ?? item.calculation.provenance.optionId ?? '', unitBaseValue: item.calculation.unitBaseValue ?? 1, carbohydratesG: item.calculation.carbohydratesG ?? 0 })), totalCarbohydratesG: totalMealCarbohydrates(items) };
}

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
  const [revision, setRevision] = useState(0);
  const [history, setHistory] = useState<CalculationHistoryEntry[]>(() => listHistoryEntries());
  const [savedMeals, setSavedMeals] = useState<SavedMealCalculation[]>(() => listMealCalculations());
  const [favorites, setFavorites] = useState<FavoriteProduct[]>(() => listFavoriteProducts());
  const [counts, setCounts] = useState<UserDataCounts>(() => getUserDataCounts());
  const [manual, setManual] = useState<ManualState>(INITIAL_MANUAL);
  const [manualProducts, setManualProducts] = useState<ManualProduct[]>(() => listManualProducts());
  const [productPhotos, setProductPhotos] = useState<CatalogProductPhoto[]>(() => listCatalogProductPhotos());
  const [manualMessage, setManualMessage] = useState<string | null>(null);
  const [productPhotoMessage, setProductPhotoMessage] = useState<string | null>(null);
  const [calibrationUnit, setCalibrationUnit] = useState<CatalogCalibrationUnit>('piece');
  const [calibrationCount, setCalibrationCount] = useState('10');
  const [calibrationWeight, setCalibrationWeight] = useState('');
  const [calibrationMessage, setCalibrationMessage] = useState<string | null>(null);
  const [speechListening, setSpeechListening] = useState(false);
  const [speechMessage, setSpeechMessage] = useState<string | null>(null);
  const [mealItems, setMealItems] = useState<MealCalculationItem[]>([]);
  const [mealOpen, setMealOpen] = useState(false);
  const [editingMealItemId, setEditingMealItemId] = useState<string | null>(null);
  const [mealMessage, setMealMessage] = useState<string | null>(null);
  const [mealNeedsCurrentGlucose, setMealNeedsCurrentGlucose] = useState(false);
  const [mealGlucoseFocusRequest, setMealGlucoseFocusRequest] = useState(0);
  const [activeMealHistoryId, setActiveMealHistoryId] = useState<string | null>(null);
  const [activeMealCreatedAt, setActiveMealCreatedAt] = useState<string | null>(null);
  const [transferMessage, setTransferMessage] = useState<string | null>(null);
  const [lastBolusTime, setLastBolusTime] = useState('');
  const [lastBolusUnits, setLastBolusUnits] = useState('');
  const abortRef = useRef<AbortController | null>(null);
  const speechRecognitionRef = useRef<SpeechRecognition | null>(null);
  const restored = useRef(false);
  const product = search.selectedProduct;

  const refreshLocalData = useCallback(() => { setHistory(listHistoryEntries()); setSavedMeals(listMealCalculations()); setFavorites(listFavoriteProducts()); setManualProducts(listManualProducts()); setProductPhotos(listCatalogProductPhotos()); setCounts(getUserDataCounts()); setRevision((v) => v + 1); }, []);
  const initialize = useCallback(async () => {
    setStatus((s) => ({ ...s, state: 'checking', diagnostics: null, progress: null }));
    try { const next = await initializeOfflineCatalog(); setStatus(next); setInstalledFromNetwork(firstInstall(next)); }
    catch (error) { const d = diagnostic(error, 'initialize', 'Der lokale Produktkatalog konnte nicht geöffnet werden.'); setStatus({ state: 'unavailable', activeSlot: d.activeSlot, rollbackSlot: d.rollbackSlot, slotStates: { a: 'empty', b: 'empty' }, catalogVersion: d.catalogVersion, productCount: null, persistent: false, progress: null, diagnostics: d, retryAllowedImmediately: true }); }
  }, []);

  useEffect(() => { void initialize(); return () => { abortRef.current?.abort(); try { speechRecognitionRef.current?.stop(); } catch {} cancelOfflineCatalogRequests(); }; }, [initialize]);
  useEffect(() => { const listener = () => refreshLocalData(); addEventListener('kh:offline-user-data-changed', listener); return () => removeEventListener('kh:offline-user-data-changed', listener); }, [refreshLocalData]);
  useEffect(() => {
    if (restored.current || status.state !== 'ready') return;
    restored.current = true;
    const session = settings.restoreLastSession ? loadSearchSession() : null;
    if (!session) return;
    setQuery(session.query); setSection(session.activeSection); setManualMode(session.manualMode);
    setRequest(normalizeCatalogUnitRequest({ amount: session.amount, unit: session.unit ?? 'g', unitExplicit: session.unit !== null }));
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
    return resolveCatalogUnitRuntime(product, request).resolution;
  }, [product, request, revision]);
  const [selectedOptionId, setSelectedOptionId] = useCatalogUnitSelection(
    product,
    resolution,
    request
  );
  useEffect(() => { void product?.code; setProductPhotoMessage(null); }, [product?.code]);
  const effectiveResolution = useMemo(() => resolution ? { ...resolution, selectedOptionId } : null, [resolution, selectedOptionId]);
  const calculation = useMemo(() => product && effectiveResolution ? calculateCatalogCarbohydrates(product, request, effectiveResolution) : null, [effectiveResolution, product, request]);
  const selectedOption = useMemo<ResolvedUnitOption | null>(() => effectiveResolution?.options.find((o) => o.id === effectiveResolution.selectedOptionId) ?? null, [effectiveResolution]);
  const calibrationPreview = useMemo(() => {
    if (product === null || product.nutrition.basis !== 'mass' || isGenericCatalogProduct(product) || (isClinicCatalogProduct(product) && product.clinic.directCarbohydratesPerUnit !== null)) return null;
    const count = Math.trunc(readNumber(calibrationCount) ?? 0);
    const weight = readNumber(calibrationWeight); if (!weight) return null;
    return deriveCatalogCalibration(count, weight, request.amount, product.nutrition.carbohydratesPer100);
  }, [calibrationCount, calibrationWeight, product, request.amount]);
  const manualCalculation = useMemo(() => { const per100 = readNumber(manual.carbohydratesPer100); const amount = readNumber(manual.amount); if (per100 === null || amount === null || per100 > (manual.basis === 'mass' ? 100 : 200)) return null; return amount * per100 / 100; }, [manual]);

  const executeSearch = useCallback(async (raw: string, page = 0) => {
    const parsed = parseCatalogQuery(raw);
    if (!parsed) { dispatch({ type: 'validation', message: 'Bitte Produktname oder Barcode eingeben.' }); return; }
    setEditingMealItemId(null);
    setMealOpen(false);
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
        setRequest(requestForInitialCatalogProduct(parsed, preferred));
        dispatch({ type: 'resolve', query: parsed.catalogQuery, product: preferred, candidates: hits });
      } else dispatch({ type: 'show-choice', query: parsed.catalogQuery, candidates: hits });
      return;
    }
    if (status.state !== 'ready') { dispatch({ type: 'validation', message: 'Der lokale Katalog ist noch nicht bereit. Erneutes Laden ist sofort möglich.' }); return; }
    abortRef.current?.abort(); const controller = new AbortController(); abortRef.current = controller;
    setRequest(requestFromParsedCatalogInput(parsed)); setSelectedOptionId(null); dispatch({ type: 'start', query: parsed.catalogQuery });
    try {
      if (parsed.barcode) {
        const value = await getOfflineCatalogProduct(parsed.barcode, controller.signal);
        if (!value) dispatch({ type: 'not-found', query: parsed.catalogQuery });
        else if (!catalogProductEligibility(value).eligible) dispatch({ type: 'validation', message: 'Der Katalogeintrag enthält keine sicher berechenbaren Kohlenhydratdaten.' });
        else {
          setRequest(requestForInitialCatalogProduct(parsed, value));
          dispatch({ type: 'resolve', query: parsed.catalogQuery, product: value });
        }
        return;
      }
      const localMatches = cookedGeneric ? [...clinicMatches, asGenericSearchHit(cookedGeneric)] : clinicMatches;
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
        setRequest(requestForInitialCatalogProduct(parsed, preferred));
        dispatch({ type: 'resolve', query: parsed.catalogQuery, product: preferred, candidates: hits });
      }
      else dispatch({ type: 'show-choice', query: parsed.catalogQuery, candidates: hits });
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) dispatch({ type: 'failed', query: parsed.catalogQuery, diagnostics: diagnostic(error, parsed.barcode ? 'product_lookup' : 'search', 'Die lokale Katalogabfrage konnte nicht abgeschlossen werden.') });
    } finally { if (abortRef.current === controller) abortRef.current = null; }
  }, [settings.clinicMode, settings.searchResultLimit, setSelectedOptionId, status.state]);

  const resolveSearchCandidate = useCallback((
    hit: CatalogSearchHit,
    candidates?: readonly CatalogSearchHit[]
  ) => {
    if (!catalogProductEligibility(hit).eligible) {
      dispatch({ type: 'validation', message: isClinicCatalogProduct(hit) ? 'Für diesen Klinikdatensatz ist ausdrücklich kein berechenbarer KH-Wert hinterlegt.' : 'Dieser Katalogeintrag ist nicht sicher berechenbar.' });
      return;
    }
    setRequest((current) => search.phase === 'idle'
      ? requestForBareCatalogProduct(hit)
      : requestForCatalogVariant(current, hit));
    dispatch({
      type: 'resolve',
      query: search.query || hit.displayName,
      product: hit,
      candidates
    });
  }, [search.phase, search.query]);
  const selectCandidate = useCallback((hit: CatalogSearchHit) => {
    resolveSearchCandidate(hit);
  }, [resolveSearchCandidate]);
  const changeSearchPage = (page: number) => { if (page < 0 || (page > searchPage && !searchHasNext)) return; void executeSearch(query, page); };
  const selectUnit = (id: string) => { const option = resolution?.options.find((o) => o.id === id); if (!option) return; setRequest((r) => ({ ...r, unit: option.unit, unitExplicit: true })); setSelectedOptionId(id); setCalibrationMessage(null); };
  useEffect(() => {
    if (!product || isGenericCatalogProduct(product) || (isClinicCatalogProduct(product) && product.clinic.directCarbohydratesPerUnit !== null)) return;
    const unit = inferredCalibrationUnit(product);
    const saved = catalogCalibrationForUnit(product, unit);
    setCalibrationUnit(unit);
    setCalibrationCount(saved ? String(saved.measurement.measuredCount) : '10');
    setCalibrationWeight(saved ? String(saved.measurement.measuredTotalWeightG) : '');
    setCalibrationMessage(saved ? 'Persönliche Einheit geladen.' : null);
  }, [product]);

  useEffect(() => {
    if (product === null || product.nutrition.basis !== 'mass' || isGenericCatalogProduct(product) || (isClinicCatalogProduct(product) && product.clinic.directCarbohydratesPerUnit !== null) || !calibrationPreview) return;
    const measuredCount = Math.trunc(readNumber(calibrationCount) ?? 0);
    const weight = readNumber(calibrationWeight);
    if (!weight || measuredCount < 1) return;
    const existing = catalogCalibrationForUnit(product, calibrationUnit);
    if (existing && existing.measurement.measuredCount === measuredCount && existing.measurement.measuredTotalWeightG === weight) return;
    setCalibrationMessage('Wird automatisch gespeichert …');
    const timer = window.setTimeout(() => {
      const record = createCatalogCalibration({ calibrationId: createLocalId('cal'), scope: 'catalog-product', identity: catalogCalibrationIdentity(product), unit: calibrationUnit, measuredCount, measuredTotalWeightG: weight, smallestEdibleUnit: calibrationUnit !== 'portion', now: new Date().toISOString() });
      if (!record || !saveCatalogCalibration(record)) { setCalibrationMessage('Die Messung konnte nicht gespeichert werden.'); return; }
      setRequest((current) => ({ ...current, unit: calibrationUnit, unitExplicit: false }));
      setSelectedOptionId(`${calibrationUnit}:user_calibration:${String(calibrationPreview.unitWeightG)}`);
      setCalibrationMessage(`${calibrationPreview.unitWeightG.toLocaleString('de-DE')} g je ${calibrationUnit === 'bar' ? 'Riegel' : calibrationUnit === 'slice' ? 'Scheibe' : calibrationUnit === 'portion' ? 'Portion' : 'Stück'} gespeichert.`);
      refreshLocalData();
    }, 600);
    return () => window.clearTimeout(timer);
  }, [calibrationCount, calibrationPreview, calibrationUnit, calibrationWeight, product, refreshLocalData, setSelectedOptionId]);

  const changeCalibrationUnit = (unit: CatalogCalibrationUnit) => {
    setCalibrationUnit(unit);
    if (!product) return;
    const saved = catalogCalibrationForUnit(product, unit);
    setCalibrationCount(saved ? String(saved.measurement.measuredCount) : '10');
    setCalibrationWeight(saved ? String(saved.measurement.measuredTotalWeightG) : '');
    setCalibrationMessage(saved ? 'Persönliche Einheit geladen.' : null);
  };

  const executeProductInput = async (input: string) => {
    const parts = parseProductList(input);
    if (parts.length <= 1) { await executeSearch(input); return; }
    if (status.state !== 'ready' && settings.clinicMode !== 'clinic-only') { await executeSearch(parts[0] ?? input); return; }
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const added: MealCalculationItem[] = [];
    const failures: string[] = [];
    try {
      for (const part of parts) {
        const parsed = parseCatalogQuery(part);
        if (!parsed) { failures.push(part); continue; }
        let candidates: CatalogProduct[] = [];
        if (parsed.barcode) {
          const product = await getOfflineCatalogProduct(parsed.barcode, controller.signal);
          if (product) candidates = [product];
        } else {
          const clinicMatches = settings.clinicMode === 'off' ? [] : searchClinicCatalog(parsed.catalogQuery, 20);
          const generic = settings.clinicMode === 'clinic-only' ? null : genericCookedProductForQuery(parsed.catalogQuery);
          const localMatches = generic ? [...clinicMatches, asGenericSearchHit(generic)] : clinicMatches;
          const sqliteHits = settings.clinicMode === 'clinic-only' ? [] : await searchOfflineCatalog(parsed.catalogQuery, Math.max(1, 20 - localMatches.length), controller.signal, 0);
          const hits = [...localMatches, ...sqliteHits].slice(0, 20).map((hit, resultIndex) => ({ ...hit, resultIndex }));
          const preferred = selectDefaultCatalogCandidate(hits, parsed.catalogQuery, hits.map((hit) => catalogProductEligibility(hit).eligible));
          candidates = preferred ? [preferred, ...hits.filter((hit) => hit.productId !== preferred.productId)] : hits;
        }
        let item: MealCalculationItem | null = null;
        for (const candidate of candidates) {
          if (!catalogProductEligibility(candidate).eligible) continue;
          const nextRequest = requestForInitialCatalogProduct(parsed, candidate);
          const nextResolution = resolveCatalogUnitRuntime(candidate, nextRequest).resolution;
          item = createMealCalculationItem(createLocalId('meal'), candidate, nextRequest, nextResolution, nextResolution.selectedOptionId);
          if (item) break;
        }
        if (item) added.push(item); else failures.push(part);
      }
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) failures.push(...parts.filter((part) => !failures.includes(part)));
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
    if (added.length > 0) {
      setMealItems((current) => [...current, ...added]);
      setManualMode(false);
      setEditingMealItemId(null);
      setMealMessage(`${added.length} ${added.length === 1 ? 'Produkt wurde' : 'Produkte wurden'} aus der Eingabe zur Gesamtrechnung hinzugefügt.${failures.length > 0 ? ` Noch zu prüfen: ${failures.join(', ')}.` : ''}`);
      dispatch({ type: 'reset' });
      setQuery('');
      setMealOpen(failures.length === 0);
    }
    if (failures.length > 0) await executeSearch(failures[0]);
  };

  const startVoiceSearch = () => {
    if (speechRecognitionRef.current) {
      try { speechRecognitionRef.current.stop(); } catch {}
      speechRecognitionRef.current = null;
      setSpeechListening(false);
      setSpeechMessage('Spracheingabe beendet.');
      return;
    }
    const appleMobile = isAppleMobileSpeechClient(navigator);
    const focusNativeDictation = () => {
      const input = document.getElementById('catalog-search-input') as HTMLInputElement | null;
      input?.focus();
      input?.select();
    };
    const Constructor = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!Constructor) {
      focusNativeDictation();
      setSpeechMessage(unavailableSpeechMessage(appleMobile));
      return;
    }
    const recognition = new Constructor();
    speechRecognitionRef.current = recognition;
    recognition.lang = 'de-DE'; recognition.interimResults = false; recognition.continuous = false;
    recognition.onstart = () => { setSpeechListening(true); setSpeechMessage(appleMobile ? 'iPhone-Mikrofon aktiv – bitte jetzt sprechen.' : 'Mikrofon aktiv – bitte jetzt sprechen.'); };
    recognition.onresult = (event) => {
      const transcript = Array.from(event.results).slice(event.resultIndex ?? 0).map((result) => result[0]?.transcript ?? '').join(' ').trim();
      if (transcript) { setQuery(transcript); setSpeechMessage(`Erkannt: „${transcript}“`); void executeProductInput(transcript); }
    };
    recognition.onerror = (event) => {
      setSpeechListening(false);
      speechRecognitionRef.current = null;
      setSpeechMessage(speechRecognitionErrorMessage(event.error, appleMobile));
      if (appleMobile && (event.error === 'not-allowed' || event.error === 'service-not-allowed' || event.error === 'audio-capture')) focusNativeDictation();
    };
    recognition.onend = () => {
      if (speechRecognitionRef.current === recognition) speechRecognitionRef.current = null;
      setSpeechListening(false);
    };
    setSpeechMessage(appleMobile ? 'iPhone-Mikrofon wird gestartet …' : 'Mikrofon wird gestartet …');
    startSpeechRecognitionSafely(recognition, setSpeechListening, (error) => {
      speechRecognitionRef.current = null;
      const code = error instanceof DOMException && error.name === 'NotAllowedError' ? 'not-allowed' : 'start-failed';
      setSpeechMessage(speechRecognitionErrorMessage(code, appleMobile));
      if (appleMobile) focusNativeDictation();
    });
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
  const catalogPhotoUrl = (code: string): string | null => productPhotos.find((photo) => photo.productCode === code)?.imageDataUrl ?? null;
  const setCatalogPhoto = async (file: File | null) => {
    if (!file || !product) return;
    try {
      const imageDataUrl = await resizeManualProductImage(file);
      if (!saveCatalogProductPhoto(product.code, imageDataUrl)) { setProductPhotoMessage('Das Produktfoto konnte nicht lokal gespeichert werden.'); return; }
      setProductPhotoMessage('Produktfoto lokal gespeichert.');
      refreshLocalData();
    } catch (error) {
      setProductPhotoMessage(error instanceof Error ? error.message : 'Produktfoto konnte nicht verarbeitet werden.');
    }
  };
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

  const startNextMealProduct = () => {
    setMealOpen(false);
    setEditingMealItemId(null);
    setManualMode(false);
    setQuery('');
    setRequest({ amount: 1, unit: 'g', unitExplicit: false });
    setSelectedOptionId(null);
    dispatch({ type: 'reset' });
  };
  const addCurrentToMeal = () => {
    if (!product || !resolution || calculation?.status !== 'calculated' || calculation.carbohydratesG === null) {
      startNextMealProduct();
      return;
    }
    const id = editingMealItemId ?? createLocalId('meal');
    const item = createMealCalculationItem(id, product, request, resolution, selectedOptionId);
    if (!item) return;
    setMealItems((current) => editingMealItemId
      ? current.map((existing) => existing.id === editingMealItemId ? item : existing)
      : [...current, item]);
    startNextMealProduct();
  };
  const openMealSummary = () => { setMealOpen(true); setManualMode(false); };
  const openMealItem = (id: string) => {
    const item = mealItems.find((candidate) => candidate.id === id);
    if (!item) return;
    setMealOpen(false);
    setManualMode(false);
    setEditingMealItemId(id);
    setQuery(item.product.displayName);
    setRequest({ ...item.request });
    setSelectedOptionId(item.resolution.selectedOptionId);
    dispatch({ type: 'resolve', query: item.product.displayName, product: item.product, candidates: [] });
  };
  const updateMealItem = (id: string, amount: number, optionId?: string) => setMealItems((current) => current.map((item) => item.id === id ? updateMealCalculationItem(item, amount, optionId) : item));
  const removeMealItem = (id: string) => {
    setMealItems((current) => current.filter((item) => item.id !== id));
    if (mealItems.length <= 1) { setActiveMealHistoryId(null); setActiveMealCreatedAt(null); }
    if (editingMealItemId === id || mealItems.length <= 1) startNextMealProduct();
  };
  const clearMeal = () => { setMealItems([]); setActiveMealHistoryId(null); setActiveMealCreatedAt(null); setMealMessage(null); setMealNeedsCurrentGlucose(false); startNextMealProduct(); };
  const mealTotalCarbohydrates = totalMealCarbohydrates(mealItems);

  useEffect(() => {
    if (mealItems.length === 0) return;
    const id = activeMealHistoryId ?? createLocalId('meal-history');
    const createdAt = activeMealCreatedAt ?? new Date().toISOString();
    if (!activeMealHistoryId) setActiveMealHistoryId(id);
    if (!activeMealCreatedAt) setActiveMealCreatedAt(createdAt);
    saveMealCalculation(savedMealFromItems(id, mealItems, createdAt));
  }, [activeMealCreatedAt, activeMealHistoryId, mealItems]);

  const loadSavedMeal = async (saved: SavedMealCalculation) => {
    const loaded = await Promise.all(saved.items.map(async (line) => {
      const productValue = genericProductByCode(line.productCode) ?? clinicProductByCode(line.productCode) ?? await getOfflineCatalogProduct(line.productCode).catch(() => null);
      if (!productValue) return null;
      const savedRequest: CatalogUnitRequest = { amount: line.amount, unit: line.unit, unitExplicit: true };
      const nextResolution = resolveCatalogUnitRuntime(productValue, savedRequest).resolution;
      const selected = nextResolution.options.find((option) => option.id === line.selectedOptionId)
        ?? nextResolution.options.filter((option) => option.unit === line.unit && option.baseValue !== null).sort((a, b) => Math.abs((a.baseValue ?? 0) - line.unitBaseValue) - Math.abs((b.baseValue ?? 0) - line.unitBaseValue))[0]
        ?? null;
      return createMealCalculationItem(line.id, productValue, savedRequest, nextResolution, selected?.id ?? nextResolution.selectedOptionId);
    }));
    const available = loaded.filter((item): item is MealCalculationItem => item !== null);
    if (available.length === 0) { setMealMessage('Die Produkte dieser Rechnung sind im aktuellen Katalog nicht mehr verfügbar.'); return; }
    abortRef.current?.abort();
    setSection('calculator');
    setManualMode(false);
    setQuery('');
    setSelectedOptionId(null);
    setEditingMealItemId(null);
    dispatch({ type: 'reset' });
    setMealItems(available);
    setActiveMealHistoryId(saved.id);
    setActiveMealCreatedAt(saved.createdAt);
    setMealOpen(true);
    setMealMessage(available.length === saved.items.length ? 'Gespeicherte Rechnung als bearbeitbare Kopie geöffnet.' : 'Rechnung geöffnet; nicht mehr verfügbare Produkte wurden ausgelassen.');
    setMealNeedsCurrentGlucose(settings.diabeticProfileEnabled);
    if (settings.diabeticProfileEnabled) setMealGlucoseFocusRequest((value) => value + 1);
  };
  const removeSavedMeal = (id: string) => { deleteMealCalculation(id); refreshLocalData(); };
  const acknowledgeMealGlucose = () => setMealNeedsCurrentGlucose(false);

  const transferFile = (forNativeShare = false) => new File(
    [serializeTransferFile(createTransferFile(settings))],
    `fishit-kh-daten-${new Date().toISOString().slice(0, 10)}.${forNativeShare ? 'txt' : 'json'}`,
    { type: forNativeShare ? 'text/plain' : 'application/json' }
  );
  const downloadTransferFile = () => {
    const file = transferFile();
    const url = URL.createObjectURL(file);
    const anchor = document.createElement('a');
    anchor.href = url; anchor.download = file.name;
    document.body.append(anchor); anchor.click(); anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
    setTransferMessage('Datei mit Verlauf, Diabeteseinstellungen und Portions-Overrides exportiert.');
  };
  const shareTransferFile = async () => {
    const file = transferFile(true);
    let nativeFileShareAvailable = typeof navigator.share === 'function';
    if (nativeFileShareAvailable && typeof navigator.canShare === 'function') {
      try { nativeFileShareAvailable = navigator.canShare({ files: [file] }); } catch { nativeFileShareAvailable = false; }
    }
    if (!nativeFileShareAvailable) {
      downloadTransferFile();
      setTransferMessage('Teilen wird hier nicht unterstützt – die Datei wurde stattdessen exportiert.');
      return;
    }
    try {
      await navigator.share({ title: 'FishIT KH Checker – Daten', text: 'Verlauf, Diabeteseinstellungen und Portions-Overrides', files: [file] });
      setTransferMessage('Datei zum Teilen übergeben.');
    } catch (error) {
      setTransferMessage(error instanceof DOMException && error.name === 'AbortError' ? 'Teilen abgebrochen.' : 'Die Datei konnte nicht geteilt werden.');
    }
  };
  const importTransferFile = async (file: File | null) => {
    if (!file) return;
    try {
      const parsed = parseTransferFile(await file.text());
      if (!parsed) { setTransferMessage('Diese Datei ist keine gültige FishIT-KH-Datendatei.'); return; }
      const imported = importHistoryData(parsed.history);
      if (!imported) { setTransferMessage('Die gespeicherten Daten in der Datei sind ungültig.'); return; }
      updateSettings({ ...settings, diabeticProfileEnabled: parsed.diabetes.enabled, diabetesFactorSegments: parsed.diabetes.factorSegments, insulinActivityDurationHours: parsed.diabetes.insulinActivityDurationHours, manualBolusTrackingEnabled: parsed.diabetes.manualBolusTrackingEnabled });
      refreshLocalData();
      setTransferMessage(`${imported.meals + imported.calculations} Verlaufseinträge, ${imported.calibrations} Portions-Overrides und die Diabeteseinstellungen wurden importiert.`);
    } catch {
      setTransferMessage('Die Datei konnte nicht gelesen werden.');
    }
  };

  return { settings, updateSettings, status, setStatus, installedFromNetwork, initialize, section, setSection, manualMode, setManualMode, query, setQuery, search, dispatch, executeSearch, executeProductInput, searchPage, searchHasNext, changeSearchPage, clinicBrowseCandidates: settings.clinicMode === 'clinic-only' ? clinicCatalogProducts() : [], startVoiceSearch, speechListening, speechMessage, product, request, setRequest, resolution, selectedOptionId, selectUnit, selectedOption, calculation, selectCandidate, promoteSearchCandidate: resolveSearchCandidate, calibrationUnit, changeCalibrationUnit, calibrationCount, setCalibrationCount, calibrationWeight, setCalibrationWeight, calibrationPreview, calibrationMessage, productPhotoMessage, catalogPhotoUrl, setCatalogPhoto, manual, setManual, manualCalculation, saveManual, manualProducts, manualMessage, saveManualDefinition, loadManualDefinition, removeManualDefinition, setManualPhoto, history, savedMeals, favorites, counts, refreshLocalData, saveCurrent, isFavorite: product ? isFavoriteProduct(product.productId) : false, toggleFavorite, clearHistory, clearSession: clearSearchSession, clearAll, mealItems, mealOpen, editingMealItemId, mealTotalCarbohydrates, mealMessage, mealNeedsCurrentGlucose, mealGlucoseFocusRequest, transferMessage, lastBolusTime, setLastBolusTime, lastBolusUnits, setLastBolusUnits, addCurrentToMeal, startNextMealProduct, openMealSummary, openMealItem, updateMealItem, removeMealItem, clearMeal, loadSavedMeal, removeSavedMeal, acknowledgeMealGlucose, downloadTransferFile, shareTransferFile, importTransferFile };
}

export type CatalogController = ReturnType<typeof useCatalogController>;
