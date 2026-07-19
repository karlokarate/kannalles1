import { useEffect, useMemo, useRef, useState } from 'react';
import type { CatalogProduct } from '../lib/catalog/catalogDomain';
import { getOfflineCatalogProduct, searchOfflineCatalog } from '../lib/catalog/catalogClient';
import { catalogProductEligibility, calculateCatalogCarbohydrates } from '../lib/resolution/catalogResolution';
import type { CatalogUnitRequest } from '../lib/resolution/catalogResolution';
import { createCatalogCalibration } from '../lib/resolution/catalogCalibration';
import { asGenericSearchHit, genericCookedProductForQuery } from '../lib/genericFoods';
import { searchClinicCatalog } from '../lib/clinicCatalog';
import { searchManualCatalog } from '../lib/manualCatalog';
import { createMealCalculationItem, totalMealCarbohydrates, updateMealCalculationItem } from '../lib/mealCalculation';
import type { MealCalculationItem } from '../lib/mealCalculation';
import {
  smartUnitPromptCalibration,
  updateSmartUnitPromptValue
} from '../lib/smartUnitPrompt';
import type { SmartUnitPrompt } from '../lib/smartUnitPrompt';
import {
  createLocalId,
  saveCatalogCalibration,
  saveMealCalculation
} from '../lib/userDataStore';
import type { SavedMealCalculation } from '../lib/userDataStore';
import {
  isAppleMobileSpeechClient,
  speechRecognitionErrorMessage,
  startSpeechRecognitionSafely,
  unavailableSpeechMessage
} from '../lib/speech';
import {
  catalogCalibrationIdentity,
  resolveCatalogUnitRuntime
} from './catalogUnitRuntime';
import { requestForInitialCatalogProduct } from './catalogInputRequest';
import { selectDefaultCatalogCandidate } from './catalogViewModel';
import { parseCatalogQuery, parseProductList } from './queryParser';
import { useCatalogController } from './useCatalogController';
import { useCatalogUnitSelection } from './useCatalogUnitSelection';

export interface PendingSmartUnitItem {
  id: string;
  product: CatalogProduct;
  request: CatalogUnitRequest;
  prompt: SmartUnitPrompt;
}

function readPromptNumber(value: string): number | null {
  const parsed = Number(value.replace(',', '.'));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function smartUnitKey(product: CatalogProduct, prompt: SmartUnitPrompt): string {
  return `${product.productId}:${prompt.unit}`;
}

function savedSmartMeal(id: string, items: readonly MealCalculationItem[], createdAt: string): SavedMealCalculation {
  return {
    schemaVersion: 1,
    id,
    createdAt,
    items: items.map((item) => ({
      id: item.id,
      productCode: item.product.code,
      productName: item.product.displayName,
      amount: item.request.amount,
      unit: item.calculation.unit,
      selectedOptionId: item.resolution.selectedOptionId ?? item.calculation.provenance.optionId ?? '',
      unitBaseValue: item.calculation.unitBaseValue ?? 1,
      carbohydratesG: item.calculation.carbohydratesG ?? 0
    })),
    totalCarbohydratesG: totalMealCarbohydrates(items)
  };
}

export function useSmartCatalogController() {
  const base = useCatalogController();
  const refreshLocalData = base.refreshLocalData;
  const [smartItems, setSmartItems] = useState<MealCalculationItem[]>([]);
  const [pendingSmartUnitItems, setPendingSmartUnitItems] = useState<PendingSmartUnitItem[]>([]);
  const [smartMealOpen, setSmartMealOpen] = useState(false);
  const [smartMealMessage, setSmartMealMessage] = useState<string | null>(null);
  const [editingSmartItemId, setEditingSmartItemId] = useState<string | null>(null);
  const [smartUnitValues, setSmartUnitValues] = useState<Record<string, string>>({});
  const [smartUnitMessage, setSmartUnitMessage] = useState<string | null>(null);
  const [smartRevision, setSmartRevision] = useState(0);
  const [smartHistoryId, setSmartHistoryId] = useState<string | null>(null);
  const [smartHistoryCreatedAt, setSmartHistoryCreatedAt] = useState<string | null>(null);
  const [speechListening, setSpeechListening] = useState(false);
  const [speechMessage, setSpeechMessage] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const speechRecognitionRef = useRef<SpeechRecognition | null>(null);

  useEffect(() => () => {
    abortRef.current?.abort();
    try { speechRecognitionRef.current?.stop(); } catch {}
  }, []);

  const currentUnitState = useMemo(() => {
    void smartRevision;
    if (!base.product) return null;
    const initial = resolveCatalogUnitRuntime(base.product, base.request, 'smart');
    const override = initial.prompt ? smartUnitValues[smartUnitKey(base.product, initial.prompt)] : undefined;
    return override === undefined
      ? initial
      : resolveCatalogUnitRuntime(base.product, base.request, 'smart', override);
  }, [base.product, base.request, smartRevision, smartUnitValues]);

  const resolution = currentUnitState?.resolution ?? base.resolution;
  const smartUnitPrompt = currentUnitState?.prompt ?? null;

  const [selectedOptionId, setSelectedOptionId] = useCatalogUnitSelection(
    base.product,
    resolution ?? null,
    base.request
  );

  const effectiveResolution = useMemo(() => resolution ? { ...resolution, selectedOptionId } : null, [resolution, selectedOptionId]);
  const calculation = useMemo(() => base.product && effectiveResolution
    ? calculateCatalogCarbohydrates(base.product, base.request, effectiveResolution)
    : null, [base.product, base.request, effectiveResolution]);
  const selectedOption = useMemo(() => effectiveResolution?.options.find((option) => option.id === effectiveResolution.selectedOptionId) ?? null, [effectiveResolution]);

  const persistSmartPrompt = (product: CatalogProduct, prompt: SmartUnitPrompt): boolean => {
    const measurement = smartUnitPromptCalibration(prompt);
    if (!measurement) {
      setSmartUnitMessage('Bitte einen gültigen positiven Wert eingeben.');
      return false;
    }
    const record = createCatalogCalibration({
      calibrationId: createLocalId('cal'),
      scope: 'catalog-product',
      identity: catalogCalibrationIdentity(product, 'smart'),
      unit: prompt.unit,
      measuredCount: measurement.measuredCount,
      measuredTotalWeightG: measurement.measuredTotalWeightG,
      smallestEdibleUnit: prompt.unit !== 'portion',
      now: new Date().toISOString()
    });
    if (!record || !saveCatalogCalibration(record)) {
      setSmartUnitMessage('Die Einheitengröße konnte nicht gespeichert werden.');
      return false;
    }
    setSmartUnitValues((current) => {
      const next = { ...current };
      delete next[smartUnitKey(product, prompt)];
      return next;
    });
    setSmartRevision((value) => value + 1);
    setSmartUnitMessage(`${product.displayName}: Einheitengröße gespeichert.`);
    refreshLocalData();
    return true;
  };

  const setCurrentSmartUnitPromptValue = (value: string) => {
    const product = base.product;
    if (!product || !smartUnitPrompt) return;
    const key = smartUnitKey(product, smartUnitPrompt);
    setSmartUnitValues((current) => ({ ...current, [key]: value }));
    setSmartUnitMessage(null);
  };

  const confirmCurrentSmartUnitPrompt = () => {
    const product = base.product;
    if (product && smartUnitPrompt) persistSmartPrompt(product, smartUnitPrompt);
  };

  const resolveInputPart = async (part: string, signal: AbortSignal): Promise<{ item: MealCalculationItem | null; pending: PendingSmartUnitItem | null }> => {
    const parsed = parseCatalogQuery(part);
    if (!parsed) return { item: null, pending: null };
    let candidates: CatalogProduct[] = [];
    if (parsed.barcode) {
      const product = await getOfflineCatalogProduct(parsed.barcode, signal);
      if (product) candidates = [product];
    } else {
      const manualMatches = searchManualCatalog(parsed.catalogQuery);
      const clinicMatches = base.settings.clinicMode === 'off' ? [] : searchClinicCatalog(parsed.catalogQuery, 20);
      const generic = base.settings.clinicMode === 'clinic-only' ? null : genericCookedProductForQuery(parsed.catalogQuery);
      const localMatches = [...manualMatches, ...clinicMatches, ...(generic ? [asGenericSearchHit(generic)] : [])];
      const sqliteHits = base.settings.clinicMode === 'clinic-only'
        ? []
        : await searchOfflineCatalog(parsed.catalogQuery, Math.max(1, 20 - localMatches.length), signal, 0);
      const hits = [...localMatches, ...sqliteHits].slice(0, 20).map((hit, resultIndex) => ({ ...hit, resultIndex }));
      const preferred = selectDefaultCatalogCandidate(hits, parsed.catalogQuery, hits.map((hit) => catalogProductEligibility(hit).eligible));
      candidates = preferred ? [preferred, ...hits.filter((hit) => hit.productId !== preferred.productId)] : hits;
    }

    for (const candidate of candidates) {
      if (!catalogProductEligibility(candidate).eligible) continue;
      const request = requestForInitialCatalogProduct(parsed, candidate, 'smart');
      const state = resolveCatalogUnitRuntime(candidate, request, 'smart');
      const item = createMealCalculationItem(createLocalId('meal'), candidate, request, state.resolution, state.resolution.selectedOptionId, state.prompt);
      if (!item) continue;
      if (item.calculation.carbohydratesG === null && state.prompt) {
        return { item: null, pending: { id: item.id, product: candidate, request, prompt: state.prompt } };
      }
      return { item, pending: null };
    }
    return { item: null, pending: null };
  };

  const executeProductInput = async (input: string) => {
    const parts = parseProductList(input);
    if (parts.length <= 1) {
      await base.executeSearch(input);
      return;
    }
    if (base.status.state !== 'ready' && base.settings.clinicMode !== 'clinic-only') {
      await base.executeSearch(parts[0] ?? input);
      return;
    }
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const added: MealCalculationItem[] = [];
    const pending: PendingSmartUnitItem[] = [];
    const failures: string[] = [];
    try {
      for (const part of parts) {
        const result = await resolveInputPart(part, controller.signal);
        if (result.item) added.push(result.item);
        else if (result.pending) pending.push(result.pending);
        else failures.push(part);
      }
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) failures.push(...parts.filter((part) => !failures.includes(part)));
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }

    if (added.length > 0) setSmartItems((current) => [...current, ...added]);
    if (pending.length > 0) setPendingSmartUnitItems((current) => [...current, ...pending]);
    if (added.length > 0 || pending.length > 0) {
      base.setManualMode(false);
      base.dispatch({ type: 'reset' });
      base.setQuery('');
      setEditingSmartItemId(null);
      setSmartMealOpen(true);
      const promptCount = added.filter((item) => item.smartUnitPrompt).length + pending.length;
      setSmartMealMessage(`${added.length + pending.length} ${added.length + pending.length === 1 ? 'Produkt wurde' : 'Produkte wurden'} erkannt.${promptCount > 0 ? ` Bitte prüfe ${promptCount === 1 ? 'eine Einheitengröße' : `${promptCount} Einheitengrößen`}.` : ''}${failures.length > 0 ? ` Noch zu prüfen: ${failures.join(', ')}.` : ''}`);
    }
    if (failures.length > 0) await base.executeSearch(failures[0]);
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
    recognition.lang = 'de-DE';
    recognition.interimResults = false;
    recognition.continuous = false;
    recognition.onstart = () => {
      setSpeechListening(true);
      setSpeechMessage(appleMobile ? 'iPhone-Mikrofon aktiv – bitte jetzt sprechen.' : 'Mikrofon aktiv – bitte jetzt sprechen.');
    };
    recognition.onresult = (event) => {
      const transcript = Array.from(event.results).slice(event.resultIndex ?? 0).map((result) => result[0]?.transcript ?? '').join(' ').trim();
      if (transcript) {
        base.setQuery(transcript);
        setSpeechMessage(`Erkannt: „${transcript}“`);
        void executeProductInput(transcript);
      }
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

  const updateMealItemSmartUnit = (id: string, value: string) => {
    setSmartItems((current) => current.map((item) => {
      if (item.id !== id || !item.smartUnitPrompt) return item;
      const prompt = updateSmartUnitPromptValue(item.smartUnitPrompt, value);
      const state = resolveCatalogUnitRuntime(item.product, item.request, 'smart', value);
      return createMealCalculationItem(item.id, item.product, item.request, state.resolution, state.resolution.selectedOptionId, state.prompt ?? prompt) ?? item;
    }));
  };

  const confirmMealItemSmartUnit = (id: string) => {
    const item = smartItems.find((candidate) => candidate.id === id);
    if (!item?.smartUnitPrompt || !persistSmartPrompt(item.product, item.smartUnitPrompt)) return;
    const state = resolveCatalogUnitRuntime(item.product, item.request, 'smart');
    const next = createMealCalculationItem(item.id, item.product, item.request, state.resolution, state.resolution.selectedOptionId, state.prompt);
    if (next) setSmartItems((current) => current.map((candidate) => candidate.id === id ? next : candidate));
  };

  const updatePendingSmartUnit = (id: string, value: string) => {
    setPendingSmartUnitItems((current) => current.map((item) => item.id === id
      ? { ...item, prompt: updateSmartUnitPromptValue(item.prompt, value) }
      : item));
  };

  const confirmPendingSmartUnit = (id: string) => {
    const pending = pendingSmartUnitItems.find((item) => item.id === id);
    if (!pending || !persistSmartPrompt(pending.product, pending.prompt)) return;
    const state = resolveCatalogUnitRuntime(pending.product, pending.request, 'smart');
    const item = createMealCalculationItem(pending.id, pending.product, pending.request, state.resolution, state.resolution.selectedOptionId, state.prompt);
    if (!item || item.calculation.carbohydratesG === null) return;
    setPendingSmartUnitItems((current) => current.filter((candidate) => candidate.id !== id));
    setSmartItems((current) => [...current, item]);
  };

  const mealItems = [...base.mealItems, ...smartItems];
  const mealTotalCarbohydrates = base.mealTotalCarbohydrates + totalMealCarbohydrates(smartItems);
  const smartMealOwnsView = smartItems.length > 0 || pendingSmartUnitItems.length > 0;
  const mealOpen = smartMealOwnsView ? smartMealOpen : base.mealOpen;

  const addCurrentToMeal = () => {
    const product = base.product;
    if (!product || !resolution) {
      base.startNextMealProduct();
      return;
    }
    const itemId = editingSmartItemId ?? createLocalId('meal');
    const item = createMealCalculationItem(itemId, product, base.request, resolution, selectedOptionId, smartUnitPrompt);
    if (!item) return;
    if (item.calculation.carbohydratesG === null && smartUnitPrompt) {
      setPendingSmartUnitItems((current) => [
        ...current.filter((candidate) => candidate.id !== itemId),
        { id: itemId, product, request: base.request, prompt: smartUnitPrompt }
      ]);
    } else {
      setSmartItems((current) => editingSmartItemId
        ? current.map((candidate) => candidate.id === editingSmartItemId ? item : candidate)
        : [...current, item]);
    }
    setEditingSmartItemId(null);
    base.startNextMealProduct();
  };

  const startNextMealProduct = () => {
    setSmartMealOpen(false);
    setEditingSmartItemId(null);
    base.startNextMealProduct();
  };

  const openMealSummary = () => {
    setSmartMealOpen(true);
    base.openMealSummary();
  };

  const openMealItem = (id: string) => {
    const item = smartItems.find((candidate) => candidate.id === id);
    if (!item) {
      setSmartMealOpen(false);
      base.openMealItem(id);
      return;
    }
    setSmartMealOpen(false);
    setEditingSmartItemId(id);
    base.setManualMode(false);
    base.setQuery(item.product.displayName);
    base.setRequest({ ...item.request });
    base.dispatch({ type: 'resolve', query: item.product.displayName, product: item.product, candidates: [] });
    const prompt = item.smartUnitPrompt;
    if (prompt) {
      const key = smartUnitKey(item.product, prompt);
      setSmartUnitValues((current) => ({ ...current, [key]: prompt.value }));
    }
  };

  const updateMealItem = (id: string, amount: number, optionId?: string) => {
    if (smartItems.some((item) => item.id === id)) {
      setSmartItems((current) => current.map((item) => item.id === id ? updateMealCalculationItem(item, amount, optionId) : item));
    } else base.updateMealItem(id, amount, optionId);
  };

  const removeMealItem = (id: string) => {
    if (smartItems.some((item) => item.id === id)) setSmartItems((current) => current.filter((item) => item.id !== id));
    else base.removeMealItem(id);
    setPendingSmartUnitItems((current) => current.filter((item) => item.id !== id));
  };

  const clearMeal = () => {
    setSmartItems([]);
    setPendingSmartUnitItems([]);
    setSmartMealOpen(false);
    setSmartMealMessage(null);
    setSmartHistoryId(null);
    setSmartHistoryCreatedAt(null);
    base.clearMeal();
  };

  const loadSavedMeal = async (saved: SavedMealCalculation) => {
    setSmartItems([]);
    setPendingSmartUnitItems([]);
    setSmartMealOpen(false);
    await base.loadSavedMeal(saved);
  };

  const selectUnit = (id: string) => {
    const option = resolution?.options.find((candidate) => candidate.id === id);
    if (!option) return;
    base.setRequest((current) => ({ ...current, unit: option.unit, unitExplicit: true }));
    setSelectedOptionId(id);
  };

  useEffect(() => {
    if (smartItems.length === 0 || smartItems.some((item) => item.calculation.carbohydratesG === null)) return;
    const id = smartHistoryId ?? createLocalId('meal-history');
    const createdAt = smartHistoryCreatedAt ?? new Date().toISOString();
    if (!smartHistoryId) setSmartHistoryId(id);
    if (!smartHistoryCreatedAt) setSmartHistoryCreatedAt(createdAt);
    saveMealCalculation(savedSmartMeal(id, smartItems, createdAt));
    refreshLocalData();
  }, [refreshLocalData, smartHistoryCreatedAt, smartHistoryId, smartItems]);

  const promptIsValid = (prompt: SmartUnitPrompt): boolean => {
    const value = readPromptNumber(prompt.value);
    return value !== null && (prompt.mode !== 'whole-split' || Number.isInteger(value));
  };

  return {
    ...base,
    executeProductInput,
    startVoiceSearch,
    speechListening,
    speechMessage,
    resolution,
    selectedOptionId,
    selectUnit,
    selectedOption,
    calculation,
    smartUnitPrompt,
    smartUnitMessage,
    setCurrentSmartUnitPromptValue,
    confirmCurrentSmartUnitPrompt,
    mealItems,
    mealOpen,
    editingMealItemId: editingSmartItemId ?? base.editingMealItemId,
    mealTotalCarbohydrates,
    mealMessage: smartMealMessage ?? base.mealMessage,
    addCurrentToMeal,
    startNextMealProduct,
    openMealSummary,
    openMealItem,
    updateMealItem,
    updateMealItemSmartUnit,
    confirmMealItemSmartUnit,
    removeMealItem,
    clearMeal,
    loadSavedMeal,
    pendingSmartUnitItems,
    updatePendingSmartUnit,
    confirmPendingSmartUnit,
    promptIsValid
  };
}

export type SmartCatalogController = ReturnType<typeof useSmartCatalogController>;
