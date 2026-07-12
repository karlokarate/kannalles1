import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode, RefObject } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  Barcode,
  Calculator,
  CheckCircle2,
  ChevronDown,
  Clock3,
  Copy,
  Database,
  Gauge,
  Heart,
  History,
  Home,
  Info,
  LoaderCircle,
  Mail,
  Mic,
  Package,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  Star,
  Trash2,
  Weight,
  X
} from 'lucide-react';
import type {
  ApiAttemptDiagnostic,
  ApiResponseMeta,
  AppSettings,
  CalculationResult,
  FoodUnit,
  ManualFormValues,
  OffProduct,
  ParsedFoodRequest,
  PortionOption,
  ProductApiMode,
  SearchHit,
  SearchOutcome,
  SearchResponse,
  WeightMeasurement
} from './types';
import { parseFoodRequestLocal } from './lib/parser';
import { parseFoodRequestWithAi } from './lib/aiClient';
import {
  DataSourceError,
  cancelPendingApiRequests,
  clearApiGovernor,
  getApiUsageSnapshot,
  getProductByBarcode,
  searchFoodCandidatesOutcome
} from './lib/api';
import type { ApiUsageSnapshot } from './lib/apiGovernor';
import {
  buildBaseFoodReferenceResult,
  buildExactResult,
  buildGenericResult,
  displayCarbohydrateValue,
  rankExactCandidates,
  recalculateResult,
  recalculateWithManualTotalMass,
  recalculateWithManualTotalVolume,
  recalculateWithPortion,
  resolveGenericCandidates,
  shouldResolveAsExactProduct
} from './lib/resolver';
import { getBaseFoodReference } from './lib/baseFoods';
import { candidateIdentityScore, isGenericCategoryQuery, sameProductFamily } from './lib/identity';
import { buildManualResult } from './lib/manual';
import { isValidCarbohydratesPer100, maximumCarbohydratesPer100 } from './lib/nutrition';
import { isOffBarcodeInput, normalizeOffBarcode } from './lib/barcode';
import {
  isPlausibleFoodAmount,
  isPlausibleTotalMass,
  isPlausibleTotalVolume,
  isPlausibleUnitWeightForUnit
} from './lib/domainLimits';
import { GatewayUrlError, validatedGatewayBase } from './lib/gatewayUrl';
import { startSpeechRecognitionSafely } from './lib/speech';
import { resultDataAttribution } from './lib/attribution';
import { clearOffProductImageCache } from './lib/pwaCache';
import {
  isParsedFoodRequest,
  parseSearchHits,
  parseStoredCalculationResult
} from './lib/resultValidation';
import {
  clearApiCache,
  clearCalibrations,
  clearHistory,
  deleteResult,
  getApiCacheStats,
  findCalibration,
  getHistory,
  loadSettings,
  pruneApiCache,
  saveCalibration,
  saveResult,
  saveSettings,
  synchronizeExternalRepositoryMutation
} from './lib/storage';
import { createPieceCalibration, deriveGroupCalibration, isCalibratableUnit } from './lib/calibration';
import {
  currentWorkflowIssue,
  restoreSearchWorkflowState,
  searchWorkflowReducer,
  workflowHits,
  workflowRequest,
  workflowResult
} from './lib/searchState';
import type { SearchScreen, SearchView, WorkflowIssue } from './lib/searchState';
import type { ApiCacheStats } from './lib/storage';
import {
  createId,
  displayBrand,
  displayProductName,
  formatNumber,
  normalizeText,
  parseLocalizedDecimal,
  unitLabels
} from './lib/format';

type Tab = 'search' | 'history' | 'favorites' | 'settings';

const APP_VERSION = __APP_VERSION__;
const DEVELOPER_SUPPORT_EMAIL = 'chrisfischtopher@googlemail.com';
const MAX_SEARCH_QUERY_LENGTH = 120;
const SESSION_KEY = 'kh-checker-session-v3';
const LEGACY_SESSION_KEY = 'kh-checker-v2.0-session';
const SESSION_SCHEMA_VERSION = 3;

const DEFAULT_SETTINGS: AppSettings = {
  aiEnabled: false,
  decimalPlaces: 1,
  searchPageSize: 10,
  preferGermanMarket: true,
  saveHistory: false,
  saveSearchSession: false,
  saveCalibrations: false,
  cacheApiData: false,
  dataGatewayUrl: import.meta.env.VITE_DATA_GATEWAY_URL || import.meta.env.VITE_DATA_API_BASE_URL || '',
  productApiMode: 'hybrid'
};

const DEFAULT_MANUAL: ManualFormValues = {
  productName: '',
  brand: '',
  amount: 1,
  unit: 'portion',
  barcode: '',
  unitWeightG: null,
  nutritionBasis: '100g',
  carbsPer100: null
};

const UNIT_OPTIONS: Array<{ value: FoodUnit; label: string }> = [
  { value: 'piece', label: 'Stück' },
  { value: 'bar', label: 'Riegel' },
  { value: 'slice', label: 'Scheibe' },
  { value: 'portion', label: 'Portion' },
  { value: 'package', label: 'Packung' },
  { value: 'g', label: 'Gramm' },
  { value: 'kg', label: 'Kilogramm' },
  { value: 'ml', label: 'Milliliter' }
];


interface SessionSnapshot {
  tab: Tab;
  searchView: SearchView;
  query: string;
  manualMode: boolean;
  manualValues: ManualFormValues;
  request: ParsedFoodRequest | null;
  hits: SearchHit[];
  result: CalculationResult | null;
}

interface StoredSessionSnapshot {
  schemaVersion: typeof SESSION_SCHEMA_VERSION;
  consent: true;
  value: SessionSnapshot;
}

interface AppHistoryState {
  khChecker: true;
  tab: Tab;
  view: SearchView;
  entryId: string;
  scrollY?: number;
  focusId?: string | null;
}

export function createNavigationHistoryState(tab: Tab, view: SearchView, entryId: string): AppHistoryState {
  return { khChecker: true, tab, view, entryId };
}

type UiIssue = WorkflowIssue;

interface ApiTraceNotice {
  label: string;
  meta: ApiResponseMeta;
  observedAt: string;
}


function mergeTraceAttempts(...groups: Array<ApiAttemptDiagnostic[] | undefined>): ApiAttemptDiagnostic[] {
  const seen = new Set<string>();
  const merged: ApiAttemptDiagnostic[] = [];
  for (const attempt of groups.flatMap((group) => group ?? [])) {
    const key = [
      attempt.startedAt,
      attempt.backend,
      attempt.label,
      attempt.url,
      attempt.outcome,
      attempt.status ?? '',
      attempt.errorName ?? '',
      attempt.errorMessage ?? ''
    ].join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(attempt);
  }
  return merged;
}

function appendApiTrace(
  previous: ApiTraceNotice | null,
  label: string,
  next: ApiResponseMeta,
  observedAt = new Date().toISOString()
): ApiTraceNotice {
  if (!previous) return { label, meta: next, observedAt };
  const attempts = mergeTraceAttempts(previous.meta.attempts, next.attempts);
  const labels = previous.label.split(' → ');
  if (!labels.includes(label)) labels.push(label);
  return {
    label: labels.join(' → '),
    observedAt,
    meta: {
      ...next,
      networkAttempted: Boolean(previous.meta.networkAttempted || next.networkAttempted),
      durationMs: attempts.reduce((sum, attempt) => sum + attempt.durationMs, 0),
      attempts,
      fallbackReason: next.fallbackReason ?? previous.meta.fallbackReason,
      fallbackStatus: next.fallbackStatus ?? previous.meta.fallbackStatus,
      fallbackOrigin: next.fallbackOrigin ?? previous.meta.fallbackOrigin,
      retryAt: next.retryAt ?? previous.meta.retryAt
    }
  };
}

function regularErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

function ensureControllerActive(controller: AbortController): void {
  if (!controller.signal.aborted) return;
  throw new DataSourceError('Anfrage abgebrochen', 'aborted', {
    cause: controller.signal.reason
  });
}

interface EndpointValidation {
  value: string;
  error: string | null;
}

function validateHttpEndpoint(value: string): EndpointValidation {
  try {
    return {
      value: validatedGatewayBase(value, window.location.origin, true),
      error: null
    };
  } catch (cause) {
    return {
      value: '',
      error: cause instanceof GatewayUrlError
        ? cause.message
        : 'Die Gateway-Adresse ist keine gültige oder sichere URL.'
    };
  }
}

interface PwaStatusNotice {
  message: string;
  updateAvailable?: boolean;
  applyUpdate?: () => void | Promise<void>;
}

function missingNetworkCapabilities(): string[] {
  const missing: string[] = [];
  if (typeof fetch === 'undefined') missing.push('Fetch');
  if (typeof AbortController === 'undefined') missing.push('AbortController');
  if (typeof URL === 'undefined') missing.push('URL');
  if (typeof TextDecoder === 'undefined') missing.push('TextDecoder');
  return missing;
}

function formatCountdown(milliseconds: number): string {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1000));
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest ? `${minutes}:${String(rest).padStart(2, '0')} min` : `${minutes} min`;
}

function sanitizeSettings(value: AppSettings | null): AppSettings {
  const merged = { ...DEFAULT_SETTINGS, ...(value ?? {}) };
  const defaultGatewayUrl = DEFAULT_SETTINGS.dataGatewayUrl.trim();
  const persistedGatewayUrl = value && typeof value.dataGatewayUrl === 'string'
    ? value.dataGatewayUrl.trim()
    : null;
  // Empty is an intentional manual/offline-only choice. Apply the build
  // default only before any settings record exists.
  merged.dataGatewayUrl = persistedGatewayUrl ?? defaultGatewayUrl;
  if (!['hybrid', 'v3', 'v2'].includes(String(merged.productApiMode))) {
    merged.productApiMode = 'hybrid';
  }
  return {
    aiEnabled: merged.aiEnabled === true,
    decimalPlaces: [0, 1, 2].includes(Number(merged.decimalPlaces)) ? merged.decimalPlaces : 1,
    searchPageSize: [10, 15, 20].includes(Number(merged.searchPageSize)) ? merged.searchPageSize : 10,
    preferGermanMarket: merged.preferGermanMarket !== false,
    saveHistory: merged.saveHistory === true,
    saveSearchSession: merged.saveSearchSession === true,
    saveCalibrations: merged.saveCalibrations === true,
    cacheApiData: merged.cacheApiData === true,
    dataGatewayUrl: merged.dataGatewayUrl,
    productApiMode: merged.productApiMode
  };
}

function sameSettings(left: AppSettings, right: AppSettings): boolean {
  return left.aiEnabled === right.aiEnabled
    && left.decimalPlaces === right.decimalPlaces
    && left.searchPageSize === right.searchPageSize
    && left.preferGermanMarket === right.preferGermanMarket
    && left.saveHistory === right.saveHistory
    && left.saveSearchSession === right.saveSearchSession
    && left.saveCalibrations === right.saveCalibrations
    && left.cacheApiData === right.cacheApiData
    && left.dataGatewayUrl === right.dataGatewayUrl
    && left.productApiMode === right.productApiMode;
}

function attemptOutcomeLabel(outcome: ApiAttemptDiagnostic['outcome']): string {
  return ({
    'cache-hit': 'Cache-Treffer',
    success: 'Erfolgreich',
    'http-error': 'HTTP-Fehler',
    'rate-limit': 'Rate-Limit / Überlastung',
    'network-error': 'Netzwerk-/CORS-Fehler',
    timeout: 'Zeitüberschreitung',
    'parse-error': 'JSON-Fehler',
    aborted: 'Abgebrochen'
  })[outcome];
}

function formatCacheAge(milliseconds?: number): string {
  if (milliseconds === undefined || !Number.isFinite(milliseconds)) return 'unbekannt';
  if (milliseconds < 60_000) return `${Math.max(0, Math.round(milliseconds / 1000))} s`;
  if (milliseconds < 3_600_000) return `${Math.round(milliseconds / 60_000)} min`;
  if (milliseconds < 86_400_000) return `${Math.round(milliseconds / 3_600_000)} h`;
  return `${Math.round(milliseconds / 86_400_000)} Tage`;
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${formatNumber(bytes / 1024, 1)} KB`;
  return `${formatNumber(bytes / (1024 * 1024), 1)} MB`;
}

function backendLabel(backend: ApiResponseMeta['backend'] | ApiResponseMeta['originBackend']): string {
  if (!backend) return 'unbekannt';
  return ({
    gateway: 'eigener Gateway',
    'search-index': 'eigener Suchindex',
    'search-a-licious': 'Search-a-licious',
    'open-food-facts-legacy': 'OFF Legacy-Suche',
    'open-food-facts-v3': 'OFF API v3.6',
    'open-food-facts-v2': 'OFF API v2',
    'query-cache': 'Suchcache',
    'product-cache': 'Produktcache'
  })[backend];
}

function attemptTechnicalText(attempt: ApiAttemptDiagnostic): string {
  const status = attempt.status ? `HTTP ${attempt.status}` : '';
  const error = [attempt.errorName, attempt.errorMessage].filter(Boolean).join(': ');
  return [status, error].filter(Boolean).join(' · ') || attemptOutcomeLabel(attempt.outcome);
}

function diagnosticsText(issue: UiIssue): string {
  return JSON.stringify({
    appVersion: APP_VERSION,
    occurredAt: issue.occurredAt,
    online: typeof navigator === 'undefined' ? null : navigator.onLine,
    title: issue.title,
    message: issue.message,
    technical: issue.technical,
    attempts: issue.attempts
  }, null, 2);
}

function diagnosticsBundleText(
  issue: UiIssue | null,
  apiTrace: ApiTraceNotice | null,
  apiUsage: ApiUsageSnapshot
): string {
  return JSON.stringify({
    appVersion: APP_VERSION,
    createdAt: new Date().toISOString(),
    online: typeof navigator === 'undefined' ? null : navigator.onLine,
    page: typeof window === 'undefined' ? null : window.location.href,
    issue: issue
      ? {
          occurredAt: issue.occurredAt,
          title: issue.title,
          message: issue.message,
          technical: issue.technical,
          attempts: issue.attempts
        }
      : null,
    apiTrace: apiTrace
      ? {
          label: apiTrace.label,
          observedAt: apiTrace.observedAt,
          meta: apiTrace.meta
        }
      : null,
    apiUsage
  }, null, 2);
}

function diagnosticsMailtoHref(
  issue: UiIssue | null,
  apiTrace: ApiTraceNotice | null,
  apiUsage: ApiUsageSnapshot
): string {
  const subject = issue ? `KH Checker Diagnose: ${issue.title}` : 'KH Checker Diagnosebericht';
  const body = [
    'Hallo,',
    '',
    'anbei die automatisch gesammelten Diagnose- und Fehlerdaten.',
    '',
    '```json',
    diagnosticsBundleText(issue, apiTrace, apiUsage),
    '```',
    '',
    'Viele Gruesse'
  ].join('\n');
  return `mailto:${DEVELOPER_SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

async function copyText(value: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(value);
    return;
  } catch {
    // Clipboard can be unavailable in local Android viewers.
  }
  const area = document.createElement('textarea');
  area.value = value;
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.appendChild(area);
  area.focus();
  area.select();
  document.execCommand('copy');
  area.remove();
}

function normalizeStoredResult(value: CalculationResult): CalculationResult {
  const parsed = parseStoredCalculationResult(value);
  if (!parsed) throw new Error('Ungültiges Berechnungsergebnis.');
  return parsed;
}

function normalizeManualForm(value: unknown): ManualFormValues {
  if (!value || typeof value !== 'object') return DEFAULT_MANUAL;
  const candidate = value as Partial<ManualFormValues> & { carbsPer100g?: unknown };
  const amount = typeof candidate.amount === 'number' && Number.isFinite(candidate.amount) && candidate.amount > 0
    ? candidate.amount
    : DEFAULT_MANUAL.amount;
  const unit = UNIT_OPTIONS.some((option) => option.value === candidate.unit)
    ? candidate.unit as FoodUnit
    : DEFAULT_MANUAL.unit;
  const legacyCarbs = typeof candidate.carbsPer100g === 'number' ? candidate.carbsPer100g : null;
  const candidateCarbs = typeof candidate.carbsPer100 === 'number' && Number.isFinite(candidate.carbsPer100)
    ? candidate.carbsPer100
    : legacyCarbs;
  const unitWeightG = typeof candidate.unitWeightG === 'number'
    && Number.isFinite(candidate.unitWeightG)
    && candidate.unitWeightG > 0
    ? candidate.unitWeightG
    : null;
  const nutritionBasis = candidate.nutritionBasis === '100ml' && unit === 'ml' ? '100ml' : '100g';
  return {
    productName: typeof candidate.productName === 'string' ? candidate.productName.slice(0, 160) : '',
    brand: typeof candidate.brand === 'string' ? candidate.brand.slice(0, 120) : '',
    amount,
    unit,
    barcode: typeof candidate.barcode === 'string' ? candidate.barcode.replace(/\D/g, '').slice(0, 14) : '',
    unitWeightG,
    nutritionBasis,
    carbsPer100: isValidCarbohydratesPer100(candidateCarbs, nutritionBasis) ? candidateCarbs : null
  };
}

function isTab(value: unknown): value is Tab {
  return value === 'search' || value === 'history' || value === 'favorites' || value === 'settings';
}

function isSearchView(value: unknown): value is SearchView {
  return value === 'home' || value === 'candidates' || value === 'result';
}

export function decodeSessionSnapshot(raw: string): SessionSnapshot | null {
  try {
    const stored = JSON.parse(raw) as { schemaVersion?: unknown; consent?: unknown; value?: unknown };
    if (stored.schemaVersion !== SESSION_SCHEMA_VERSION || stored.consent !== true || !stored.value || typeof stored.value !== 'object') return null;
    const parsed = stored.value as Partial<SessionSnapshot>;
    if (!isTab(parsed.tab) || !isSearchView(parsed.searchView) || typeof parsed.query !== 'string') return null;
    const hits = parseSearchHits(parsed.hits);
    const request = isParsedFoodRequest(parsed.request) ? parsed.request : null;
    const result = parseStoredCalculationResult(parsed.result);
    const searchView: SearchView = parsed.searchView === 'result' && result
      ? 'result'
      : parsed.searchView === 'candidates' && request && hits.length
        ? 'candidates'
        : 'home';
    return {
      tab: parsed.tab,
      searchView,
      query: parsed.query.slice(0, MAX_SEARCH_QUERY_LENGTH),
      manualMode: parsed.manualMode === true,
      manualValues: normalizeManualForm(parsed.manualValues),
      request,
      hits,
      result
    };
  } catch {
    return null;
  }
}

function loadSession(): SessionSnapshot | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? decodeSessionSnapshot(raw) : null;
  } catch {
    return null;
  }
}

function saveSession(snapshot: SessionSnapshot): void {
  try {
    const stored: StoredSessionSnapshot = {
      schemaVersion: SESSION_SCHEMA_VERSION,
      consent: true,
      value: snapshot
    };
    localStorage.setItem(SESSION_KEY, JSON.stringify(stored));
    localStorage.removeItem(LEGACY_SESSION_KEY);
  } catch {
    // Local storage can be unavailable in private mode. The app remains usable.
  }
}

function clearSession(): void {
  try {
    localStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(LEGACY_SESSION_KEY);
  } catch {
    // Storage is optional.
  }
}

function syntheticHit(product: OffProduct, apiMeta?: ApiResponseMeta): SearchHit {
  return {
    code: product.code,
    product_name: product.product_name,
    product_name_de: product.product_name_de,
    generic_name: product.generic_name,
    generic_name_de: product.generic_name_de,
    brands: product.brands,
    quantity: product.quantity,
    product_quantity: product.product_quantity,
    product_quantity_unit: product.product_quantity_unit,
    serving_size: product.serving_size,
    serving_quantity: product.serving_quantity,
    nutrition_data_per: product.nutrition_data_per,
    nutrition_data_prepared_per: product.nutrition_data_prepared_per,
    data_quality_errors_tags: product.data_quality_errors_tags,
    countries_tags: product.countries_tags,
    categories_tags: product.categories_tags,
    nutriments: product.nutriments,
    image_front_url: product.image_front_url,
    completeness: 1,
    api_meta: apiMeta
  };
}

function productSeedFromSearchHit(hit: SearchHit): OffProduct {
  return {
    code: hit.code,
    product_name: hit.product_name,
    product_name_de: hit.product_name_de,
    generic_name: hit.generic_name,
    generic_name_de: hit.generic_name_de,
    brands: Array.isArray(hit.brands) ? hit.brands.join(', ') : hit.brands,
    quantity: hit.quantity,
    product_quantity: hit.product_quantity,
    product_quantity_unit: hit.product_quantity_unit,
    serving_size: hit.serving_size,
    serving_quantity: hit.serving_quantity,
    nutrition_data_per: hit.nutrition_data_per,
    nutrition_data_prepared_per: hit.nutrition_data_prepared_per,
    data_quality_errors_tags: hit.data_quality_errors_tags,
    countries_tags: hit.countries_tags,
    categories_tags: hit.categories_tags,
    nutriments: hit.nutriments,
    image_front_url: hit.image_front_url
  };
}

function mergeSearchHit(base: SearchHit, extra: SearchHit | null | undefined): SearchHit {
  if (!extra) return base;
  return {
    ...base,
    ...extra,
    code: extra.code ?? base.code,
    product_name: extra.product_name ?? base.product_name,
    product_name_de: extra.product_name_de ?? base.product_name_de,
    generic_name: extra.generic_name ?? base.generic_name,
    generic_name_de: extra.generic_name_de ?? base.generic_name_de,
    brands: extra.brands ?? base.brands,
    quantity: extra.quantity ?? base.quantity,
    product_quantity: extra.product_quantity ?? base.product_quantity,
    product_quantity_unit: extra.product_quantity_unit ?? base.product_quantity_unit,
    serving_size: extra.serving_size ?? base.serving_size,
    serving_quantity: extra.serving_quantity ?? base.serving_quantity,
    countries_tags: extra.countries_tags ?? base.countries_tags,
    categories_tags: extra.categories_tags ?? base.categories_tags,
    image_front_url: extra.image_front_url ?? base.image_front_url,
    nutriments: { ...(base.nutriments ?? {}), ...(extra.nutriments ?? {}) }
  };
}

function requestSearchQuery(request: ParsedFoodRequest): string {
  const name = request.product.name.trim();
  const brand = request.product.brand?.trim() ?? '';
  if (!brand || normalizeText(name).includes(normalizeText(brand))) return name;
  return `${brand} ${name}`.trim();
}

function isCountedFoodUnit(unit: FoodUnit): boolean {
  return unit === 'bar' || unit === 'slice' || unit === 'piece';
}

function supportsUnitWeight(unit: FoodUnit): boolean {
  return !['g', 'kg', 'ml'].includes(unit);
}

function requireSearchResponse(outcome: SearchOutcome): SearchResponse {
  if (outcome.status !== 'temporarily_unavailable' && outcome.result) return outcome.result;
  throw new DataSourceError(
    outcome.diagnostics.message ?? 'Die Produktsuche ist vorübergehend nicht verfügbar.',
    outcome.diagnostics.errorKind ?? 'network',
    {
      status: outcome.diagnostics.statusCode,
      attempts: outcome.diagnostics.attempts,
      retryAt: outcome.diagnostics.retryAt ? Date.parse(outcome.diagnostics.retryAt) : undefined
    }
  );
}

function sliderMaximum(value: number | null, mode: 'unit' | 'total'): number {
  const safe = value !== null && Number.isFinite(value) && value > 0 ? value : 0;
  if (mode === 'unit') {
    return Math.min(1000, Math.max(50, Math.ceil((safe * 3 || 50) / 10) * 10));
  }
  return Math.min(10_000, Math.max(500, Math.ceil((safe * 2.5 || 500) / 100) * 100));
}

function inputNumber(value: number | null, decimals = 2): string {
  if (value === null || !Number.isFinite(value)) return '';
  return String(Number(value.toFixed(decimals)));
}

function confidenceLabel(value: CalculationResult['confidence']): string {
  return ({ high: 'Hoch', medium: 'Mittel', low: 'Niedrig', missing: 'Fehlt' })[value];
}

function AttemptDiagnostics({ attempts }: { attempts: ApiAttemptDiagnostic[] }) {
  if (!attempts.length) return null;
  return (
    <div className="diagnostic-attempts">
      {attempts.map((attempt, index) => (
        <article
          className={`diagnostic-attempt ${['success', 'cache-hit'].includes(attempt.outcome) ? 'ok' : 'failed'}`}
          key={`${attempt.startedAt}-${attempt.backend}-${attempt.label}-${attempt.url}`}
        >
          <div className="diagnostic-attempt-head">
            <strong>{index + 1}. {attempt.label}</strong>
            <span>{attemptOutcomeLabel(attempt.outcome)} · {Math.round(attempt.durationMs)} ms</span>
          </div>
          <code>{attempt.url || 'Lokaler Cache ohne Netzwerk-Endpunkt'}</code>
          {(attempt.status || attempt.errorName || attempt.errorMessage) && (
            <p><b>Technisch:</b> {attemptTechnicalText(attempt)}</p>
          )}
          <p><b>Start:</b> {new Date(attempt.startedAt).toLocaleString('de-DE')}</p>
          {attempt.responsePreview && <p><b>Antwort:</b> {attempt.responsePreview}</p>}
          {attempt.retryAfterMs !== undefined && (
            <p><b>Retry-After vom Server:</b> {formatCountdown(attempt.retryAfterMs)} – nur Hinweis, kein App-Lock.</p>
          )}
          {attempt.cacheAgeMs !== undefined && <p><b>Cache-Alter:</b> {formatCacheAge(attempt.cacheAgeMs)}</p>}
        </article>
      ))}
    </div>
  );
}

function ApiIssueBanner({
  issue,
  onDismiss,
  onRetry,
  bannerRef
}: {
  issue: UiIssue;
  onDismiss: () => void;
  onRetry: () => void;
  bannerRef?: RefObject<HTMLElement | null>;
}) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await copyText(diagnosticsText(issue));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_600);
  };

  return (
    <section className={`api-issue-banner ${issue.kind}`} role="alert" aria-live="assertive" tabIndex={-1} ref={bannerRef}>
      <div className="api-issue-heading">
        <div className="api-issue-icon"><AlertTriangle size={21} /></div>
        <div>
          <strong>{issue.title}</strong>
          <p>{issue.message}</p>
        </div>
        <button type="button" className="icon-button compact-icon" onClick={onDismiss} aria-label="Fehler schließen"><X size={17} /></button>
      </div>
      <div className="api-issue-technical">
        <span>Eigentlicher Fehler</span>
        <code>{issue.technical}</code>
      </div>
      <details className="api-diagnostics" open>
        <summary>API-Diagnose ({issue.attempts.length || 1}) <ChevronDown size={17} /></summary>
        <p className="diagnostic-context">
          {new Date(issue.occurredAt).toLocaleString('de-DE')} · Browser online: {navigator.onLine ? 'ja' : 'nein'} · App v{APP_VERSION}
        </p>
        <AttemptDiagnostics attempts={issue.attempts} />
      </details>
      <div className="api-issue-actions">
        <button type="button" className="primary-button compact" onClick={onRetry}>
          <Search size={17} /> {issue.retryLabel}
        </button>
        <button type="button" className="secondary-button compact" onClick={() => { void copy(); }}>
          <Copy size={16} /> {copied ? 'Kopiert' : 'Diagnose kopieren'}
        </button>
      </div>
    </section>
  );
}

function ApiTraceBanner({ notice, onDismiss }: { notice: ApiTraceNotice; onDismiss: () => void }) {
  const { meta, label } = notice;
  const failed = (meta.attempts ?? []).filter((attempt) => !['success', 'cache-hit'].includes(attempt.outcome));
  const cacheOnly = meta.cacheStatus === 'fresh-cache' && meta.networkAttempted === false;
  const stale = meta.cacheStatus === 'stale-cache';
  const fallbackWorked = failed.length > 0 && !stale;
  const state = stale || fallbackWorked ? 'warning' : cacheOnly ? 'cache' : 'network';
  const headline = cacheOnly
    ? 'Lokaler Cache verwendet – keine API-Anfrage'
    : stale
      ? 'Gespeicherte Daten verwendet – API-Versuch fehlgeschlagen'
      : fallbackWorked
        ? 'Fallback erfolgreich – erster API-Weg ist fehlgeschlagen'
        : 'API-Anfrage erfolgreich';
  const origin = backendLabel(meta.originBackend ?? meta.backend);

  return (
    <section className={`api-trace-banner ${state}`} role="status" aria-live="polite">
      <div className="api-trace-heading">
        <div className="api-trace-icon">
          {state === 'warning' ? <AlertTriangle size={19} /> : cacheOnly ? <Database size={19} /> : <CheckCircle2 size={19} />}
        </div>
        <div>
          <strong>{headline}</strong>
          <p>{label} · Quelle: {origin}{meta.cacheAgeMs !== undefined ? ` · Cache-Alter ${formatCacheAge(meta.cacheAgeMs)}` : ''}</p>
        </div>
        <button type="button" className="icon-button compact-icon" onClick={onDismiss} aria-label="API-Status schließen"><X size={16} /></button>
      </div>
      {(meta.attempts?.length ?? 0) > 0 && (
        <details className="api-diagnostics" open={failed.length > 0}>
          <summary>{failed.length ? 'Technische API-Details anzeigen' : 'Anfrage- und Cache-Details'} <ChevronDown size={17} /></summary>
          <AttemptDiagnostics attempts={meta.attempts ?? []} />
        </details>
      )}
    </section>
  );
}

function RuntimeStatusRegion({
  settingsReady,
  online,
  gatewayError,
  pending,
  capabilityWarnings,
  pwaNotice,
  onApplyPwaUpdate,
  onConfigure,
  onDismissPwa
}: {
  settingsReady: boolean;
  online: boolean;
  gatewayError: string | null;
  pending: boolean;
  capabilityWarnings: string[];
  pwaNotice: PwaStatusNotice | null;
  onApplyPwaUpdate: () => void;
  onConfigure: () => void;
  onDismissPwa: () => void;
}) {
  return (
    <div className="runtime-status-region" aria-live="polite" aria-atomic="true">
      {!settingsReady && (
        <div className="runtime-status loading" role="status">
          <LoaderCircle className="spin" size={18} /> Einstellungen und lokale Daten werden geladen …
        </div>
      )}
      {settingsReady && !online && (
        <div className="runtime-status offline" role="status">
          <Database size={18} /> Offline: Gespeicherte Ergebnisse, Cache-Daten und manuelle Berechnung bleiben verfügbar.
        </div>
      )}
      {settingsReady && gatewayError && (
        <div className="runtime-status configuration" role="status">
          <AlertTriangle size={18} />
          <span>{gatewayError} Netzwerk-Suche ist deaktiviert; lokale Funktionen bleiben nutzbar.</span>
          <button type="button" className="secondary-button compact" onClick={onConfigure}>Gateway konfigurieren</button>
        </div>
      )}
      {pending && (
        <div className="runtime-status loading" role="status">
          <LoaderCircle className="spin" size={18} /> Anfrage läuft. Eine neue Aktion startet sofort einen neuen Versuch.
        </div>
      )}
      {settingsReady && capabilityWarnings.length > 0 && (
        <div className="runtime-status capability" role="status">
          <Info size={18} />
          <span>{capabilityWarnings.join(' ')}</span>
        </div>
      )}
      {pwaNotice && (
        <div className="runtime-status pwa" role="status">
          <CheckCircle2 size={18} /> <span>{pwaNotice.message}</span>
          {pwaNotice.updateAvailable && (
            <button type="button" className="secondary-button compact" onClick={onApplyPwaUpdate}>Jetzt aktualisieren</button>
          )}
          {pwaNotice.updateAvailable ? (
            <button type="button" className="secondary-button compact" onClick={onDismissPwa}>Später</button>
          ) : (
            <button type="button" className="icon-button compact-icon" onClick={onDismissPwa} aria-label="PWA-Status schließen"><X size={16} /></button>
          )}
        </div>
      )}
    </div>
  );
}

function portionOptionText(option: PortionOption): string {
  if (option.unit === 'g') return 'Gramm';
  if (option.unit === 'kg') return 'Kilogramm';
  if (option.unit === 'ml') return 'Milliliter';
  if (option.source === 'unresolved') return `${option.label} · Einzelgewicht ermitteln`;
  const quantity = option.weightG !== null
    ? `${formatNumber(option.weightG, 2)} g`
    : option.volumeMl !== null
      ? `${formatNumber(option.volumeMl, 2)} ml`
      : 'Gewicht eingeben';
  return `${option.label} · ${quantity}`;
}

function SearchHeader({ onHistory }: { onHistory: () => void }) {
  return (
    <header className="app-header">
      <div className="brand-mark" aria-hidden="true">
        <span className="leaf leaf-a" />
        <span className="leaf leaf-b" />
      </div>
      <div className="app-title-wrap">
        <h1>KH Checker</h1>
        <span>Produkte, Mengen, Kohlenhydrate</span>
      </div>
      <button type="button" className="icon-button" onClick={onHistory} aria-label="Verlauf öffnen">
        <History size={22} />
      </button>
    </header>
  );
}

function HomeScreen({
  query,
  setQuery,
  onSubmit,
  loading,
  manualMode,
  setManualMode,
  manualValues,
  setManualValues,
  onManualSubmit,
  listening,
  onVoice,
  settingsReady
}: {
  query: string;
  setQuery: (value: string) => void;
  onSubmit: () => void;
  loading: boolean;
  manualMode: boolean;
  setManualMode: (value: boolean) => void;
  manualValues: ManualFormValues;
  setManualValues: (value: ManualFormValues) => void;
  onManualSubmit: () => void;
  listening: boolean;
  onVoice: () => void;
  settingsReady: boolean;
}) {
  const selectModeFromKeyboard = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const nextManual = event.key === 'ArrowRight' || event.key === 'End';
    setManualMode(nextManual);
    window.requestAnimationFrame(() => {
      document.getElementById(nextManual ? 'manual-mode-tab' : 'search-mode-tab')?.focus();
    });
  };
  return (
    <div className="screen-content home-screen">
      <section className="hero-copy">
        <span className="eyebrow">Direkt suchen & berechnen</span>
        <h2>Welches Produkt oder Lebensmittel?</h2>
        <p>Suche reale Markenprodukte oder generische Basislebensmittel und passe die Portion direkt im Ergebnis an.</p>
      </section>

      <div className="mode-switch" role="tablist" aria-label="Eingabemodus">
        <button type="button" id="search-mode-tab" role="tab" aria-controls="search-mode-panel" aria-selected={!manualMode} tabIndex={!manualMode ? 0 : -1} className={!manualMode ? 'active' : ''} onKeyDown={selectModeFromKeyboard} onClick={() => setManualMode(false)}>
          <Search size={17} /> Suche
        </button>
        <button type="button" id="manual-mode-tab" role="tab" aria-controls="manual-mode-panel" aria-selected={manualMode} tabIndex={manualMode ? 0 : -1} className={manualMode ? 'active' : ''} onKeyDown={selectModeFromKeyboard} onClick={() => setManualMode(true)}>
          <Calculator size={17} /> Manuell
        </button>
      </div>

      {!manualMode ? (
        <section className="search-panel card" id="search-mode-panel" role="tabpanel" aria-labelledby="search-mode-tab">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              onSubmit();
            }}
          >
            <label className="search-field">
              <Search size={22} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="z. B. Bifi, 200 g Reis, 1 Riegel Bueno"
                autoComplete="off"
                enterKeyHint="search"
                maxLength={MAX_SEARCH_QUERY_LENGTH}
                aria-label="Produkt oder Lebensmittel suchen"
                aria-busy={loading}
              />
              {query && (
                <button type="button" onClick={() => setQuery('')} aria-label="Eingabe löschen">
                  <X size={18} />
                </button>
              )}
            </label>

            <div className="search-actions">
              <button
                type="button"
                className={`voice-button ${listening ? 'listening' : ''}`}
                onClick={onVoice}
              >
                <Mic size={21} />
                {listening ? 'Ich höre zu …' : 'Sprechen'}
              </button>
              <button type="submit" className="primary-button" disabled={!query.trim() || !settingsReady}>
                {loading ? <LoaderCircle className="spin" size={20} /> : <Search size={20} />}
                {!settingsReady ? 'Einstellungen laden …' : loading ? 'Suche neu starten' : 'Suchen'}
              </button>
            </div>
            <p className="request-policy-note">
              Cache zuerst. Serverhinweise wie Retry-After werden angezeigt, blockieren aber keine erneute Nutzeraktion.
            </p>
          </form>

          <fieldset className="example-grid">
            <legend className="visually-hidden">Beispiele</legend>
            {['Bifi', 'Nutella', '200 g Nudeln', '14 Salzstangen', 'Spagetti'].map((example) => (
              <button type="button" key={example} onClick={() => setQuery(example)}>{example}</button>
            ))}
          </fieldset>
        </section>
      ) : (
        <ManualForm
          values={manualValues}
          onChange={setManualValues}
          onSubmit={onManualSubmit}
          loading={loading}
        />
      )}

      <section className="trust-strip">
        <div><Database size={18} /><span>Open Food Facts</span></div>
        <div><ShieldCheck size={18} /><span>Deterministische Rechnung</span></div>
        <div><Sparkles size={18} /><span>KI optional</span></div>
      </section>
    </div>
  );
}

function ManualForm({
  values,
  onChange,
  onSubmit,
  loading
}: {
  values: ManualFormValues;
  onChange: (values: ManualFormValues) => void;
  onSubmit: () => void;
  loading: boolean;
}) {
  const patch = (next: Partial<ManualFormValues>) => onChange({ ...values, ...next });
  const validAmount = isPlausibleFoodAmount(values.amount, values.unit);
  const validUnitWeight = values.unitWeightG === null || (
    Number.isFinite(values.unitWeightG)
    && values.unitWeightG > 0
    && isPlausibleUnitWeightForUnit(values.unitWeightG, values.unit)
    && isPlausibleTotalMass(values.amount * values.unitWeightG)
  );
  const maxCarbs = maximumCarbohydratesPer100(values.nutritionBasis);
  const validCarbs = isValidCarbohydratesPer100(values.carbsPer100, values.nutritionBasis);
  const validBasisUnit = values.nutritionBasis !== '100ml' || values.unit === 'ml';
  const validBarcode = !values.barcode || (
    isOffBarcodeInput(values.barcode) && normalizeOffBarcode(values.barcode) !== null
  );

  return (
    <form
      className="manual-form card"
      id="manual-mode-panel"
      role="tabpanel"
      aria-labelledby="manual-mode-tab"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <div className="field-grid two-columns">
        <label>
          <span>Produkt *</span>
          <input value={values.productName} onChange={(event) => patch({ productName: event.target.value })} placeholder="z. B. Vollkornbrot" aria-label="Produkt" required />
        </label>
        <label>
          <span>Marke</span>
          <input value={values.brand} onChange={(event) => patch({ brand: event.target.value })} placeholder="optional" aria-label="Marke" />
        </label>
      </div>

      <label className="compound-field">
        <span>Menge & Einheit *</span>
        <div className="quantity-unit-control">
          <LocalizedDecimalInput value={values.amount} onChange={(amount) => patch({ amount: amount ?? 0 })} min={0.01} required ariaLabel="Menge" />
          <select value={values.unit} onChange={(event) => {
            const unit = event.target.value as FoodUnit;
            const nutritionBasis = values.nutritionBasis === '100ml' && unit !== 'ml' ? '100g' : values.nutritionBasis;
            patch({
              unit,
              nutritionBasis,
              carbsPer100: isValidCarbohydratesPer100(values.carbsPer100, nutritionBasis) ? values.carbsPer100 : null
            });
          }} aria-label="Einheit">
            {UNIT_OPTIONS.map((unit) => <option key={unit.value} value={unit.value}>{unit.label}</option>)}
          </select>
        </div>
      </label>

      <div className="field-grid two-columns manual-nutrition-fields">
        <label>
          <span>Bezugsbasis vom Etikett *</span>
          <select value={values.nutritionBasis} onChange={(event) => {
            const nutritionBasis = event.target.value as '100g' | '100ml';
            patch({
              nutritionBasis,
              ...(nutritionBasis === '100ml' ? { unit: 'ml' as const, unitWeightG: null } : {})
            });
          }} aria-label="Bezugsbasis der Nährwerte">
            <option value="100g">pro 100 g</option>
            <option value="100ml">pro 100 ml</option>
          </select>
        </label>
        <label htmlFor="manual-carbs-input">
          <span>KH pro {values.nutritionBasis === '100g' ? '100 g' : '100 ml'} *</span>
          <LocalizedDecimalInput
            value={values.carbsPer100}
            onChange={(carbsPer100) => patch({ carbsPer100 })}
            min={0}
            max={maxCarbs}
            required
            ariaLabel={`Kohlenhydrate pro ${values.nutritionBasis === '100g' ? '100 Gramm' : '100 Milliliter'}`}
            describedBy="manual-carbs-help"
            id="manual-carbs-input"
          />
          <small id="manual-carbs-help" className={validCarbs ? 'field-help' : 'field-error'}>{validCarbs ? '0 ist zulässig.' : `Erforderlich: Wert zwischen 0 und ${maxCarbs}.`}</small>
        </label>
      </div>
      {values.nutritionBasis === '100ml' && (
        <p className="field-help">Nährwerte pro 100 ml werden gegen das Gesamtvolumen berechnet. Mehrere Gläser oder Portionen bitte als gesamte Milliliter eingeben.</p>
      )}

      <details className="advanced-fields">
        <summary>Optionale genaue Angaben <ChevronDown size={17} /></summary>
        <div className="field-grid two-columns">
          <label>
            <span>Barcode</span>
            <input inputMode="numeric" value={values.barcode} onChange={(event) => patch({ barcode: event.target.value.replace(/\D/g, '').slice(0, 14) })} placeholder="7–14 Ziffern" minLength={7} maxLength={14} pattern="[0-9]{7,14}" aria-label="Barcode" />
          </label>
          {!['g', 'kg', 'ml'].includes(values.unit) && (
            <label htmlFor="manual-unit-weight-input">
              <span>Gewicht für 1 {unitLabels[values.unit]} (g)</span>
              <LocalizedDecimalInput id="manual-unit-weight-input" value={values.unitWeightG} onChange={(unitWeightG) => patch({ unitWeightG })} min={0.01} ariaLabel="Gewicht einer Einheit in Gramm" placeholder="z. B. 21,5" />
            </label>
          )}
        </div>
      </details>

      <button type="submit" className="primary-button full-width" disabled={!values.productName.trim() || !validAmount || !validUnitWeight || !validCarbs || !validBarcode || !validBasisUnit}>
        {loading ? <LoaderCircle className="spin" size={20} /> : <Calculator size={20} />}
        {loading ? 'Berechnung neu starten' : 'Berechnen'}
      </button>
    </form>
  );
}

function decimalInputText(value: number | null): string {
  return value === null ? '' : String(value).replace('.', ',');
}

function LocalizedDecimalInput({
  id,
  value,
  onChange,
  min,
  max,
  required = false,
  ariaLabel,
  describedBy,
  placeholder
}: {
  id?: string;
  value: number | null;
  onChange: (value: number | null) => void;
  min: number;
  max?: number;
  required?: boolean;
  ariaLabel: string;
  describedBy?: string;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState(() => ({ committed: value, text: decimalInputText(value) }));
  if (draft.committed !== value) {
    setDraft({ committed: value, text: decimalInputText(value) });
  }
  const parsed = parseLocalizedDecimal(draft.text);
  const invalid = parsed === null
    ? required || draft.text.trim().length > 0
    : parsed < min || (max !== undefined && parsed > max);
  return (
    <input
      id={id}
      type="text"
      inputMode="decimal"
      autoComplete="off"
      value={draft.text}
      placeholder={placeholder}
      pattern="[0-9]+([,.][0-9]+)?"
      required={required}
      aria-label={ariaLabel}
      aria-describedby={describedBy}
      aria-invalid={invalid}
      onChange={(event) => {
        const text = event.target.value;
        const next = parseLocalizedDecimal(text);
        setDraft({ committed: next, text });
        onChange(next);
      }}
      onBlur={() => {
        const next = parseLocalizedDecimal(draft.text);
        setDraft({ committed: next, text: decimalInputText(next) });
      }}
    />
  );
}

function ProductImage({
  src,
  alt,
  className,
  fallbackSize = 28
}: {
  src: string | null | undefined;
  alt: string;
  className?: string;
  fallbackSize?: number;
}) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  if (!src || failedSrc === src) return <Package size={fallbackSize} aria-hidden="true" />;
  return <img className={className} src={src} alt={alt} loading="lazy" onError={() => setFailedSrc(src)} />;
}

function CandidateNutrition({ hit, request }: { hit: SearchHit; request: ParsedFoodRequest }) {
  const nutrition = displayCarbohydrateValue(hit, request.product.name, request.amount.unit);
  const basis = nutrition.basis === '100ml' ? '100 ml' : '100 g';
  return (
    <small>
      {formatNumber(nutrition.value, 1)} g KH / {basis}{nutrition.prepared ? ' · zubereitet' : ''}
    </small>
  );
}

function CandidateList({
  request,
  hits,
  onBack,
  onSelect,
  onGeneric,
  loading,
  allowImages
}: {
  request: ParsedFoodRequest;
  hits: SearchHit[];
  onBack: () => void;
  onSelect: (hit: SearchHit) => void;
  onGeneric: () => void;
  loading: boolean;
  allowImages: boolean;
}) {
  return (
    <div className="screen-content">
      <div className="subheader">
        <button type="button" className="icon-button" onClick={onBack} aria-label="Zurück zur Suche"><ArrowLeft size={21} /></button>
        <div>
          <h2>Produkt auswählen</h2>
          <p>{request.amount.value} {unitLabels[request.amount.unit]} · {request.product.name}</p>
        </div>
      </div>

      {(request.resolutionMode === 'generic_category' || isGenericCategoryQuery(request.product.name)) && (
        <button type="button" className="generic-choice card" onClick={onGeneric} disabled={loading}>
          <div className="generic-icon"><Gauge size={24} /></div>
          <div>
            <strong>Als allgemeines Basislebensmittel</strong>
            <span>Robuster Median oder gebündelte Basislebensmittel-Referenz</span>
          </div>
          <ChevronDown className="rotate-left" size={20} />
        </button>
      )}

      <div className="candidate-list">
        {hits.map((hit, index) => (
          <button type="button" id={`candidate-option-${index}`} className="candidate-card card" key={hit.code ?? `${normalizeText(displayProductName(hit))}-${normalizeText(displayBrand(hit.brands) ?? '')}-${hit.quantity ?? ''}`} onClick={() => onSelect(hit)} disabled={loading}>
            <div className="candidate-image">
              <ProductImage src={allowImages ? hit.image_front_url : null} alt="" />
            </div>
            <div className="candidate-copy">
              <strong>{displayProductName(hit)}</strong>
              <span>{displayBrand(hit.brands) ?? 'Marke unbekannt'} · {hit.quantity ?? 'Menge unbekannt'}</span>
              <CandidateNutrition hit={hit} request={request} />
            </div>
            <span className="rank-badge">#{index + 1}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function ResultScreen({
  result,
  decimals,
  onBack,
  onNewSearch,
  onToggleFavorite,
  onWeightResolved,
  onTotalResolved,
  onPortionChange,
  onChooseProduct,
  allowImages,
  favoritesEnabled,
  calibrationPersistenceEnabled
}: {
  result: CalculationResult;
  decimals: number;
  onBack: () => void;
  onNewSearch: () => void;
  onToggleFavorite: () => void | Promise<void>;
  onWeightResolved: (measurement: WeightMeasurement) => void | Promise<void>;
  onTotalResolved: (value: number, reuseScope?: WeightMeasurement['reuseScope']) => void | Promise<void>;
  onPortionChange: (amount: number, portionId: string) => void | Promise<void>;
  onChooseProduct: () => void;
  allowImages: boolean;
  favoritesEnabled: boolean;
  calibrationPersistenceEnabled: boolean;
}) {
  const hasUnitEditor = result.basis === '100g' && supportsUnitWeight(result.unit);
  const canPersistUnitCalibration = calibrationPersistenceEnabled
    && result.basis === '100g'
    && isCalibratableUnit(result.unit);
  const supportsGroupWeighing = hasUnitEditor && result.countability === 'countable' && isCountedFoodUnit(result.unit);
  const currentTotal = result.basis === '100g' ? result.totalMassG : result.totalVolumeMl;
  const defaultMeasuredCount = Number.isInteger(result.amount) && result.amount > 1 && result.amount <= 100
    ? String(result.amount)
    : '10';
  const [amountValue, setAmountValue] = useState(String(result.amount));
  const [weightMode, setWeightMode] = useState<'total' | 'single' | 'group'>(
    result.status === 'needs_unit_calibration' && hasUnitEditor ? 'single' : 'total'
  );
  const [totalValue, setTotalValue] = useState(inputNumber(currentTotal));
  const [weightValue, setWeightValue] = useState(inputNumber(result.unitWeightG));
  const [measuredCountValue, setMeasuredCountValue] = useState(defaultMeasuredCount);
  const [measuredTotalValue, setMeasuredTotalValue] = useState('');
  const [reuseGeneric, setReuseGeneric] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  useEffect(() => {
    const nextHasUnitEditor = result.basis === '100g' && supportsUnitWeight(result.unit);
    setAmountValue(String(result.amount));
    setWeightMode(result.status === 'needs_unit_calibration' && nextHasUnitEditor ? 'single' : 'total');
    setTotalValue(inputNumber(result.basis === '100g' ? result.totalMassG : result.totalVolumeMl));
    setWeightValue(inputNumber(result.unitWeightG));
    setMeasuredCountValue(Number.isInteger(result.amount) && result.amount > 1 && result.amount <= 100 ? String(result.amount) : '10');
    setMeasuredTotalValue('');
    setReuseGeneric(false);
    setEditError(null);
  }, [result.amount, result.unit, result.unitWeightG, result.totalMassG, result.totalVolumeMl, result.status, result.basis]);

  const parsedAmount = Number(amountValue.replace(',', '.'));
  const parsedTotal = Number(totalValue.replace(',', '.'));
  const parsedWeight = Number(weightValue.replace(',', '.'));
  const parsedMeasuredCount = Number(measuredCountValue.replace(',', '.'));
  const parsedMeasuredTotal = Number(measuredTotalValue.replace(',', '.'));
  const groupDerivation = deriveGroupCalibration(
    parsedMeasuredCount,
    parsedMeasuredTotal,
    result.amount,
    result.basis === '100g' ? result.carbohydratesPer100 : null
  );
  const derivedGroupWeight = groupDerivation?.unitWeightG ?? null;
  const derivedTotalWeight = hasUnitEditor
    && Number.isFinite(parsedTotal)
    && parsedTotal > 0
    && Number.isFinite(result.amount)
    && result.amount > 0
    ? parsedTotal / result.amount
    : null;
  const selectedPortion = result.portionOptions.find((option) => option.id === result.selectedPortionId)
    ?? result.portionOptions.find((option) => option.recommended)
    ?? result.portionOptions[0];
  const totalSliderMax = Math.max(
    sliderMaximum(Number.isFinite(parsedTotal) && parsedTotal > 0 ? parsedTotal : currentTotal, 'total'),
    Number.isFinite(parsedTotal) && parsedTotal > 0 ? parsedTotal : 0
  );
  const unitSliderMax = Math.max(
    sliderMaximum(Number.isFinite(parsedWeight) && parsedWeight > 0 ? parsedWeight : result.unitWeightG, 'unit'),
    Number.isFinite(parsedWeight) && parsedWeight > 0 ? parsedWeight : 0
  );
  const totalSliderValue = Number.isFinite(parsedTotal) && parsedTotal > 0 ? parsedTotal : 1;
  const unitSliderValue = Number.isFinite(parsedWeight) && parsedWeight > 0 ? parsedWeight : 0.1;
  const totalUnit = result.basis === '100g' ? 'g' : 'ml';
  const totalSliderMin = result.basis === '100g' ? 0.1 : 1;
  const totalSliderStep = result.basis === '100g' ? 0.1 : 1;

  const runEdit = async (action: () => void | Promise<void>) => {
    setEditError(null);
    try {
      await action();
    } catch (caught) {
      setEditError(caught instanceof Error ? caught.message : 'Die Änderung konnte nicht übernommen werden.');
    }
  };

  const submitAmount = () => {
    if (!selectedPortion || parsedAmount === result.amount) return;
    if (!isPlausibleFoodAmount(parsedAmount, selectedPortion.unit)) {
      setEditError('Die Menge muss größer als 0 und innerhalb der sicheren Berechnungsgrenze liegen.');
      return;
    }
    void runEdit(() => onPortionChange(parsedAmount, selectedPortion.id));
  };

  return (
    <div className="screen-content result-screen">
      <div className="subheader result-subheader">
        <button type="button" className="icon-button" onClick={onBack} aria-label="Zurück"><ArrowLeft size={21} /></button>
        <div>
          <h2>Ergebnis</h2>
          <p>{result.request.rawInput}</p>
        </div>
        {favoritesEnabled && (
          <button type="button" className={`icon-button favorite-button ${result.favorite ? 'active' : ''}`} onClick={() => { void runEdit(onToggleFavorite); }} aria-label="Favorit umschalten">
            <Star size={21} fill={result.favorite ? 'currentColor' : 'none'} />
          </button>
        )}
      </div>

      <section className="result-hero card">
        <div className="product-visual">
          {result.product.imageUrl && allowImages ? (
            <ProductImage src={result.product.imageUrl} alt={result.product.name} fallbackSize={52} />
          ) : (
            <div className="product-placeholder"><Package size={52} /></div>
          )}
        </div>
        <h2>{result.product.name}</h2>
        {result.product.brand && <p className="product-brand">{result.product.brand}</p>}

        <label className="portion-editor-label">
          <span><Weight size={17} /> Menge & Einheit</span>
          <div className="portion-editor">
            <input
              inputMode="decimal"
              type="number"
              min="0.01"
              step="0.01"
              value={amountValue}
              onChange={(event) => setAmountValue(event.target.value)}
              onBlur={submitAmount}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  submitAmount();
                  event.currentTarget.blur();
                }
              }}
              aria-label="Menge"
            />
            <select
              value={selectedPortion?.id ?? ''}
              onChange={(event) => {
                const amount = Number.isFinite(parsedAmount) && parsedAmount > 0 ? parsedAmount : result.amount;
                void runEdit(() => onPortionChange(amount, event.target.value));
              }}
              aria-label="Berechnungseinheit"
            >
              {result.portionOptions.map((option) => (
                <option key={option.id} value={option.id}>{portionOptionText(option)}</option>
              ))}
            </select>
          </div>
        </label>
        {editError && <p className="field-error" role="alert">{editError}</p>}

        {result.status === 'calculated' ? (
          <>
            <div className="big-result">{formatNumber(result.carbohydratesG, decimals)} <span>g</span></div>
            <h3>Kohlenhydrate</h3>
            <p className="result-basis">
              {result.totalMassG !== null
                ? `für ${formatNumber(result.totalMassG, 1)} g Gesamtgewicht`
                : result.totalVolumeMl !== null
                  ? `für ${formatNumber(result.totalVolumeMl, 1)} ml`
                  : result.methodLabel}
            </p>
          </>
        ) : result.status === 'needs_unit_calibration' ? (
          <div className="missing-weight missing-weight-intro">
            <div className="missing-icon"><Weight size={28} /></div>
            <h3>Gewicht je {unitLabels[result.unit]} fehlt</h3>
            <p>Der Nährwert ist bekannt, aber die Datenquelle belegt das Gewicht der angefragten Einheit nicht. Ergänze unten das Einzel- oder Gesamtgewicht; eine Portion oder Packung wird nicht stillschweigend als Stück verwendet.</p>
          </div>
        ) : (
          <div className="missing-weight">
            <Info size={30} />
            <h3>Kein belastbares Ergebnis</h3>
            <p>Für den verlangten Zustand oder die Produktauswahl liegen keine passenden Nährwerte vor.</p>
          </div>
        )}

        {result.carbohydratesPer100 !== null && (
          <div className={`manual-weight-panel ${result.status === 'needs_unit_calibration' ? 'attention' : ''}`}>
            <div className="manual-weight-heading">
              <div className="manual-weight-icon"><Weight size={20} /></div>
              <div>
                <strong>{result.status === 'needs_unit_calibration' ? 'Gewicht ergänzen' : 'Gewicht manuell anpassen'}</strong>
                <span>Direkteingabe und Schieberegler sind jederzeit möglich.</span>
              </div>
            </div>
            {hasUnitEditor && !calibrationPersistenceEnabled && (
              <p className="weight-editor-note">Das eingegebene Gewicht gilt nur für diese Berechnung. Dauerhafte Wiederverwendung ist in den Einstellungen separat aktivierbar.</p>
            )}

            {hasUnitEditor && (
              <fieldset className={`weight-mode-switch ${supportsGroupWeighing ? 'three-options' : 'two-options'}`}>
                <legend className="visually-hidden">Messmethode</legend>
                <button type="button" aria-pressed={weightMode === 'total'} className={weightMode === 'total' ? 'active' : ''} onClick={() => setWeightMode('total')}>
                  Gesamt
                </button>
                <button type="button" aria-pressed={weightMode === 'single'} className={weightMode === 'single' ? 'active' : ''} onClick={() => setWeightMode('single')}>
                  Eine Einheit
                </button>
                {supportsGroupWeighing && (
                  <button type="button" aria-pressed={weightMode === 'group'} className={weightMode === 'group' ? 'active' : ''} onClick={() => setWeightMode('group')}>
                    Mehrere wiegen
                  </button>
                )}
              </fieldset>
            )}

            {weightMode === 'total' || !hasUnitEditor ? (
              <>
                <label className="single-weight-input">
                  <span>{result.basis === '100g' ? 'Gesamtgewicht in g' : 'Gesamtmenge in ml'}</span>
                  <div className="weight-number-control">
                    <input
                      inputMode="decimal"
                      value={totalValue}
                      onChange={(event) => setTotalValue(event.target.value)}
                      placeholder={result.basis === '100g' ? 'z. B. 43' : 'z. B. 250'}
                      aria-label={result.basis === '100g' ? 'Gesamtgewicht' : 'Gesamtmenge'}
                    />
                    <span>{totalUnit}</span>
                  </div>
                </label>
                <div className="weight-slider-wrap">
                  <input
                    type="range"
                    min={totalSliderMin}
                    max={totalSliderMax}
                    step={totalSliderStep}
                    value={Math.max(totalSliderMin, Math.min(totalSliderValue, totalSliderMax))}
                    onChange={(event) => setTotalValue(event.target.value)}
                    aria-label={result.basis === '100g' ? 'Gesamtgewicht per Schieberegler' : 'Gesamtmenge per Schieberegler'}
                  />
                  <div className="weight-slider-scale"><span>{formatNumber(totalSliderMin, 1)} {totalUnit}</span><span>{formatNumber(totalSliderMax, 0)} {totalUnit}</span></div>
                </div>
                {derivedTotalWeight !== null && result.basis === '100g' && (
                  <div className="derived-weight">
                    <strong>{formatNumber(derivedTotalWeight, 2)} g</strong> je {unitLabels[result.unit]} bei {formatNumber(result.amount, 2)} {unitLabels[result.unit]}
                  </div>
                )}
                {result.basis === '100ml' && (
                  <p className="weight-editor-note">Die Datenquelle führt dieses Produkt pro 100 ml. Gramm wären ohne bekannte Dichte nicht zuverlässig, daher steuert der Regler hier Milliliter.</p>
                )}
                <button type="button"
                  className="primary-button full-width"
                  disabled={result.basis === '100g'
                    ? !isPlausibleTotalMass(parsedTotal)
                    : !isPlausibleTotalVolume(parsedTotal)}
                  onClick={() => { void runEdit(() => onTotalResolved(parsedTotal, reuseGeneric ? 'generic' : 'product')); }}
                >
                  <Calculator size={19} /> Gesamtmenge übernehmen
                </button>
              </>
            ) : weightMode === 'single' || !supportsGroupWeighing ? (
              <>
                <label className="single-weight-input">
                  <span>Gewicht für 1 {unitLabels[result.unit]} in g</span>
                  <div className="weight-number-control">
                    <input
                      inputMode="decimal"
                      value={weightValue}
                      onChange={(event) => setWeightValue(event.target.value)}
                      placeholder="z. B. 21,5"
                      aria-label={`Gewicht für 1 ${unitLabels[result.unit]}`}
                    />
                    <span>g</span>
                  </div>
                </label>
                <div className="weight-slider-wrap">
                  <input
                    type="range"
                    min="0.1"
                    max={unitSliderMax}
                    step="0.1"
                    value={Math.min(unitSliderValue, unitSliderMax)}
                    onChange={(event) => setWeightValue(event.target.value)}
                    aria-label={`Einzelgewicht für ${unitLabels[result.unit]} per Schieberegler`}
                  />
                  <div className="weight-slider-scale"><span>0,1 g</span><span>{formatNumber(unitSliderMax, 0)} g</span></div>
                </div>
                <button type="button"
                  className="primary-button full-width"
                  disabled={!isPlausibleUnitWeightForUnit(parsedWeight, result.unit)
                    || !isPlausibleTotalMass(parsedWeight * result.amount)}
                  onClick={() => { void runEdit(() => onWeightResolved({
                    unitWeightG: parsedWeight,
                    measuredPieces: 1,
                    measuredTotalWeightG: parsedWeight,
                    reuseScope: reuseGeneric ? 'generic' : 'product'
                  })); }}
                >
                  <Calculator size={19} /> Einzelgewicht übernehmen
                </button>
              </>
            ) : (
              <>
                <div className="group-weight-grid">
                  <label>
                    <span>Anzahl gemeinsam gewogen</span>
                    <input inputMode="numeric" type="number" min="2" step="1" value={measuredCountValue} onChange={(event) => setMeasuredCountValue(event.target.value)} />
                  </label>
                  <label>
                    <span>Gesamtgewicht in g</span>
                    <input inputMode="decimal" type="number" min="0.01" step="0.01" value={measuredTotalValue} onChange={(event) => setMeasuredTotalValue(event.target.value)} placeholder="z. B. 28,8" />
                  </label>
                  {derivedGroupWeight !== null && (
                    <div className="derived-weight">
                      <strong>{formatNumber(derivedGroupWeight, 2)} g</strong> je {unitLabels[result.unit]}
                      {groupDerivation?.carbsPerUnitG !== null && groupDerivation?.carbsPerUnitG !== undefined && (
                        <span>{formatNumber(groupDerivation.carbsPerUnitG, 2)} g KH je {unitLabels[result.unit]}</span>
                      )}
                      {groupDerivation?.requestedTotalCarbsG !== null && groupDerivation?.requestedTotalCarbsG !== undefined && (
                        <span>{formatNumber(groupDerivation.requestedTotalCarbsG, decimals)} g KH für {formatNumber(result.amount, 2)} {unitLabels[result.unit]}</span>
                      )}
                    </div>
                  )}
                </div>
                <button type="button"
                  className="primary-button full-width"
                  disabled={derivedGroupWeight === null}
                  onClick={() => {
                    if (derivedGroupWeight !== null) {
                      void runEdit(() => onWeightResolved({
                        unitWeightG: derivedGroupWeight,
                        measuredPieces: parsedMeasuredCount,
                        measuredTotalWeightG: parsedMeasuredTotal,
                        reuseScope: reuseGeneric ? 'generic' : 'product'
                      }));
                    }
                  }}
                >
                  <Calculator size={19} /> Gruppenwägung übernehmen
                </button>
              </>
            )}
            {canPersistUnitCalibration && !result.product.barcode && (
              <label className="generic-calibration-choice">
                <input
                  type="checkbox"
                  checked={reuseGeneric}
                  onChange={(event) => setReuseGeneric(event.target.checked)}
                />
                <span>Dieses gemessene Gewicht ausdrücklich für gleichnamige Lebensmittel wiederverwenden</span>
              </label>
            )}
          </div>
        )}
      </section>

      <section className="detail-card card">
        <DetailRow icon={<Database />} label="Quelle" value={result.sourceLabel} />
        {result.dataFetchedAt && (
          <DetailRow
            icon={<Clock3 />}
            label="Datenstand"
            value={new Date(result.dataFetchedAt).toLocaleString('de-DE')}
          />
        )}
        {result.dataCacheAgeMs !== null && (
          <DetailRow icon={<Clock3 />} label="Cache-Alter bei Berechnung" value={formatCacheAge(result.dataCacheAgeMs)} />
        )}
        <DetailRow icon={<Calculator />} label={`Kohlenhydrate / ${result.basis}`} value={`${formatNumber(result.carbohydratesPer100, 1)} g`} />
        {result.product.barcode && <DetailRow icon={<Barcode />} label="Barcode" value={result.product.barcode} />}
        {result.product.packageDescription && <DetailRow icon={<Package />} label="Packung" value={result.product.packageDescription} />}
        {result.unitWeightG !== null && !['g', 'kg', 'ml'].includes(result.unit) && (
          <DetailRow icon={<Weight />} label={`Gewicht je ${unitLabels[result.unit]}`} value={`${formatNumber(result.unitWeightG, 2)} g`} />
        )}
        {result.product.servingWeightG && result.product.servingWeightG !== result.unitWeightG && (
          <DetailRow icon={<Weight />} label="Herstellerportion" value={`${formatNumber(result.product.servingWeightG, 2)} g`} />
        )}
        {result.sampleSize && <DetailRow icon={<Gauge />} label="Vergleichsprodukte" value={String(result.sampleSize)} />}
        <DetailRow
          icon={<ShieldCheck />}
          label="Sicherheit"
          value={<span className={`confidence ${result.confidence}`}>{confidenceLabel(result.confidence)}</span>}
        />
      </section>

      {result.notes.length > 0 && (
        <section className="notes-card card">
          <strong><Info size={18} /> Hinweise</strong>
          {result.notes.map((note) => <p key={note}>{note}</p>)}
        </section>
      )}

      <aside className="health-data-note card" role="note">
        <ShieldCheck size={18} />
        <p><strong>Etikett und Zubereitung prüfen.</strong> Dieses Ergebnis nicht ungeprüft für Therapie- oder Insulindosierungen verwenden. {resultDataAttribution(result)}</p>
      </aside>

      {result.candidates.length > 1 && (
        <details className="technical-card card">
          <summary><Gauge size={18} /> Verwendete Produkte / DTO <ChevronDown size={18} /></summary>
          <div className="technical-list">
            {result.candidates.map((candidate) => (
              <div key={candidate.code ?? displayProductName(candidate)}>
                <span>{displayProductName(candidate)}</span>
                <strong><CandidateNutrition hit={candidate} request={result.request} /></strong>
              </div>
            ))}
          </div>
        </details>
      )}

      <div className="result-actions">
        {result.candidates.length > 1 && <button type="button" className="secondary-button" onClick={onChooseProduct}><Package size={19} /> Produkt wählen</button>}
        <button type="button" className="primary-button" onClick={onNewSearch}><Search size={19} /> Neu suchen</button>
      </div>
    </div>
  );
}

function DetailRow({ icon, label, value }: { icon: ReactNode; label: string; value: ReactNode }) {
  return (
    <div className="detail-row">
      <span className="detail-icon">{icon}</span>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function HistoryScreen({
  title,
  entries,
  onOpen,
  onDelete,
  emptyText,
  allowImages
}: {
  title: string;
  entries: CalculationResult[];
  onOpen: (result: CalculationResult) => void;
  onDelete: (id: string) => void;
  emptyText: string;
  allowImages: boolean;
}) {
  return (
    <div className="screen-content">
      <section className="list-heading">
        <h2>{title}</h2>
        <p>{entries.length} Einträge lokal auf diesem Gerät</p>
      </section>
      {entries.length === 0 ? (
        <div className="empty-state card"><Clock3 size={34} /><h3>Noch nichts gespeichert</h3><p>{emptyText}</p></div>
      ) : (
        <div className="history-list">
          {entries.map((entry) => (
            <article className="history-card card" key={entry.id}>
              <button type="button" className="history-open" onClick={() => onOpen(entry)}>
                <div className="history-image">
                  <ProductImage src={allowImages ? entry.product.imageUrl : null} alt="" fallbackSize={24} />
                </div>
                <div>
                  <strong>{entry.product.name}</strong>
                  <span>{formatNumber(entry.amount, 2)} {unitLabels[entry.unit]} · {new Date(entry.createdAt).toLocaleDateString('de-DE')}</span>
                </div>
                <b>{entry.carbohydratesG !== null ? `${formatNumber(entry.carbohydratesG, 1)} g` : 'offen'}</b>
              </button>
              <button type="button" className="delete-button" onClick={() => {
                if (window.confirm(`„${entry.product.name}“ aus dem Verlauf löschen?`)) onDelete(entry.id);
              }} aria-label={`${entry.product.name} löschen`}><Trash2 size={17} /></button>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

function SettingsScreen({
  settings,
  apiUsage,
  cacheStats,
  issue,
  apiTrace,
  onChange,
  onClearHistory,
  onClearCalibrations,
  onClearApiCache,
  onSendDiagnosticsMail
}: {
  settings: AppSettings;
  apiUsage: ApiUsageSnapshot;
  cacheStats: ApiCacheStats;
  issue: UiIssue | null;
  apiTrace: ApiTraceNotice | null;
  onChange: (settings: AppSettings) => void;
  onClearHistory: () => void;
  onClearCalibrations: () => void;
  onClearApiCache: () => void;
  onSendDiagnosticsMail: () => void;
}) {
  const patch = (next: Partial<AppSettings>) => onChange({ ...settings, ...next });
  const gatewayValidation = validateHttpEndpoint(settings.dataGatewayUrl);
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await copyText(diagnosticsBundleText(issue, apiTrace, apiUsage));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_600);
  };
  return (
    <div className="screen-content settings-screen">
      <section className="list-heading">
        <h2>Einstellungen</h2>
        <p>Alle Netzwerk-API-Aufrufe laufen ausschließlich über den konfigurierten Daten-Gateway; Berechnung und optionale Offline-Daten bleiben lokal.</p>
      </section>

      <section className="settings-card card">
        <div className="setting-title"><Sparkles size={20} /><div><strong>Optionaler KI-Parser</strong><span>Nur Sprach-/Textstrukturierung; keine Nährwertschätzung</span></div></div>
        <label className="toggle-row"><span>OpenAI-Parsing verwenden</span><input type="checkbox" checked={settings.aiEnabled} onChange={(event) => patch({ aiEnabled: event.target.checked })} /></label>
        <p className="setting-note">Nur nach deiner Aktivierung wird der Suchtext über denselben Daten-Gateway an OpenAI übertragen; es findet keine Nährwertschätzung statt. Antworten werden mit <code>store:false</code> angefragt, mögliche Abuse-Monitoring-Logs können dennoch bis zu 30 Tage bestehen. <a href="https://platform.openai.com/docs/guides/your-data" target="_blank" rel="noreferrer">Datenschutzhinweise von OpenAI</a>. Bei fehlender Capability bleibt der lokale Parser aktiv.</p>
      </section>

      <section className="settings-card card">
        <div className="setting-title"><Gauge size={20} /><div><strong>Suche & Darstellung</strong><span>Eigener Suchindex primär, lokale Berechnung</span></div></div>
        <label className="toggle-row"><span>Deutschen Markt bevorzugen</span><input type="checkbox" checked={settings.preferGermanMarket} onChange={(event) => patch({ preferGermanMarket: event.target.checked })} /></label>
        <details className="advanced-fields">
          <summary>Technische Produkt-API-Strategie <ChevronDown size={17} /></summary>
          <label>
            <span>Produktdaten-Adapter im Gateway</span>
            <select value={settings.productApiMode} onChange={(event) => patch({ productApiMode: event.target.value as ProductApiMode })}>
              <option value="hybrid">Hybrid (empfohlen)</option>
              <option value="v3">Nur OFF API v3.6</option>
              <option value="v2">Nur OFF API v2 (Kompatibilität)</option>
            </select>
          </label>
          <p className="setting-note">Der Gateway führt die Adapterstrategie aus. Hybrid nutzt v3.6 primär und ergänzt v2 nur bei fehlenden, berechnungsrelevanten Feldern.</p>
        </details>
        <label>
          <span>Suchtreffer</span>
          <select value={settings.searchPageSize} onChange={(event) => patch({ searchPageSize: Number(event.target.value) as 10 | 15 | 20 })}>
            <option value={10}>10</option><option value={15}>15</option><option value={20}>20</option>
          </select>
        </label>
        <label>
          <span>Nachkommastellen</span>
          <select value={settings.decimalPlaces} onChange={(event) => patch({ decimalPlaces: Number(event.target.value) as 0 | 1 | 2 })}>
            <option value={0}>0</option><option value={1}>1</option><option value={2}>2</option>
          </select>
        </label>
        <label className="toggle-row"><span>Verlauf speichern</span><input type="checkbox" checked={settings.saveHistory} onChange={(event) => patch({ saveHistory: event.target.checked })} /></label>
        <label className="toggle-row"><span>Aktuelle Suche wiederherstellen</span><input type="checkbox" checked={settings.saveSearchSession} onChange={(event) => patch({ saveSearchSession: event.target.checked })} /></label>
        <label className="toggle-row"><span>Eigene Stückgewichte speichern</span><input type="checkbox" checked={settings.saveCalibrations} onChange={(event) => patch({ saveCalibrations: event.target.checked })} /></label>
        <label className="toggle-row"><span>API-Daten für Offline-Nutzung speichern</span><input type="checkbox" checked={settings.cacheApiData} onChange={(event) => patch({ cacheApiData: event.target.checked })} /></label>
        <p className="setting-note">Alle lokalen Datenspeicher sind beim ersten Start aus. Verlauf, aktuelle Sitzung, eigene Stückgewichte und API-Cache brauchen jeweils ein separates Opt-in. Deaktivieren löscht den zugehörigen Bestand; der API-Schalter entfernt zusätzlich den OFF-Bildcache.</p>
      </section>

      <section className="settings-card card">
        <div className="setting-title"><ShieldCheck size={20} /><div><strong>API-Diagnose & Zwischenspeicher</strong><span>Daten-Gateway, cache-first, deduplizierte GET-Anfragen</span></div></div>
        <label>
          <span>Daten-Gateway für Netzsuche (optional)</span>
          <input
            inputMode="url"
            value={settings.dataGatewayUrl}
            onChange={(event) => patch({ dataGatewayUrl: event.target.value })}
            placeholder="/ oder https://gateway.example"
            maxLength={300}
            aria-invalid={Boolean(gatewayValidation.error)}
            aria-describedby="gateway-help"
          />
        </label>
        {gatewayValidation.error && <p className="setting-note setting-warning" role="alert">{gatewayValidation.error} Der ungültige Wert wird nicht verwendet.</p>}
        <p className="setting-note" id="gateway-help">
          Ohne gültigen Gateway wird keine Netzwerk-Suche gestartet. Manuelle Berechnung, Verlauf und vorhandene Offline-Daten bleiben verfügbar. Unterstützt werden ein Same-Origin-Gateway oder ein externer HTTPS-Gateway mit der versionierten API der App.
        </p>
        <p className="setting-note">
          Suchbegriffe, Barcodes und Produktdaten-Anfragen gehen ausschließlich an den konfigurierten Gateway. Produktbilder können direkt von <code>images.openfoodfacts.org</code> geladen werden; dabei sieht das Bild-CDN technisch die IP-Adresse und angeforderte Bild-URL. Offline verfügbar sind nur bereits gespeicherte App-Assets und Daten.
        </p>
        <div className="api-budget-grid">
          <div>
            <span>Browser → Gateway: Suchen (letzte Minute)</span>
            <strong>{apiUsage.search.used}</strong>
            <small>{apiUsage.search.retryAfterMs > 0 ? `Server-Hinweis: ${formatCountdown(apiUsage.search.retryAfterMs)}` : 'Tatsächlich gesendete Anfragen'}</small>
          </div>
          <div>
            <span>Browser → Gateway: Produktdetails (letzte Minute)</span>
            <strong>{apiUsage.product.used}</strong>
            <small>{apiUsage.product.retryAfterMs > 0 ? `Server-Hinweis: ${formatCountdown(apiUsage.product.retryAfterMs)}` : 'Tatsächlich gesendete Anfragen'}</small>
          </div>
        </div>
        <div className="cache-stats-row">
          <span><Database size={16} /> {cacheStats.entries} Cache-Einträge</span>
          <span>{cacheStats.freshEntries} frisch · {cacheStats.staleEntries} Reserve</span>
          <span>ca. {formatBytes(cacheStats.approximateBytes)}</span>
          <span>{cacheStats.persistence === 'indexeddb' ? 'IndexedDB' : cacheStats.persistence === 'localstorage' ? 'localStorage-Fallback' : 'Arbeitsspeicher'}</span>
        </div>
        {cacheStats.persistenceIssue !== 'none' && (
          <p className="setting-note setting-warning" role="status">
            {cacheStats.persistenceIssue === 'quota-exceeded'
              ? 'Der Browser-Speicher ist voll; neue API-Daten bleiben kontrolliert im kleineren Fallback.'
              : 'IndexedDB ist derzeit nicht verfügbar; API-Daten verwenden den kontrollierten Fallback.'}
          </p>
        )}
        <p className="setting-note">
          Cache-Schlüssel trennen Gateway, Contract-Version, Seitengröße und Suchbegriff. Treffer bleiben 24 Stunden frisch und bis zu 30 Tage als Ausfallreserve; Produktdetails 30 beziehungsweise 180 Tage. Retry-After ist nur ein Serverhinweis und sperrt keine Bedienaktion.
        </p>
        <button type="button" className="secondary-button" onClick={onClearApiCache}>API-Zwischenspeicher leeren</button>
        <details className="api-diagnostics" open={Boolean(issue || apiTrace)}>
          <summary>
            Diagnose & Fehlerbericht {issue ? '(aktueller Fehler)' : apiTrace ? '(letzter API-Lauf)' : '(bereit)'} <ChevronDown size={17} />
          </summary>
          {issue ? (
            <>
              <p className="diagnostic-context">
                {new Date(issue.occurredAt).toLocaleString('de-DE')} · Browser online: {navigator.onLine ? 'ja' : 'nein'} · App v{APP_VERSION}
              </p>
              <div className="api-issue-technical">
                <span>{issue.title}</span>
                <code>{issue.technical}</code>
              </div>
            </>
          ) : (
            <p className="setting-note">Es liegt aktuell kein aktiver Fehler vor. Ein Diagnosebericht kann trotzdem gesendet werden.</p>
          )}
          {apiTrace && (
            <p className="setting-note">
              Letzter Lauf: {apiTrace.label} · Quelle: {backendLabel(apiTrace.meta.originBackend ?? apiTrace.meta.backend)}
            </p>
          )}
          {issue?.attempts?.length ? <AttemptDiagnostics attempts={issue.attempts} /> : null}
          {!issue?.attempts?.length && apiTrace?.meta.attempts?.length ? <AttemptDiagnostics attempts={apiTrace.meta.attempts} /> : null}
          <div className="api-issue-actions">
            <button type="button" className="primary-button compact" onClick={onSendDiagnosticsMail}>
              <Mail size={16} /> Diagnose per E-Mail senden
            </button>
            <button type="button" className="secondary-button compact" onClick={() => { void copy(); }}>
              <Copy size={16} /> {copied ? 'Kopiert' : 'Diagnose kopieren'}
            </button>
          </div>
        </details>
      </section>

      <section className="settings-card card danger-zone">
        <div className="setting-title"><Trash2 size={20} /><div><strong>Lokale Daten</strong><span>Nur auf diesem Gerät gespeichert</span></div></div>
        <button type="button" className="secondary-button" onClick={onClearHistory}>Verlauf löschen</button>
        <button type="button" className="secondary-button" onClick={onClearCalibrations}>Gespeicherte Stückgewichte löschen</button>
      </section>

      <section className="about-card card">
        <Info size={20} />
        <div><strong>KH Checker v{APP_VERSION}</strong><p>Progressive Web App mit Gateway-only-Netzwerkzugriff, lokaler Offline-Reserve, sofortigem Retry und deterministischer Portionsberechnung.</p></div>
      </section>
    </div>
  );
}

export default function App() {
  const [tab, setTab] = useState<Tab>('search');
  const [query, setQuery] = useState('');
  const [manualMode, setManualMode] = useState(false);
  const [manualValues, setManualValues] = useState<ManualFormValues>(DEFAULT_MANUAL);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [settingsReady, setSettingsReady] = useState(false);
  const [workflow, dispatchWorkflow] = useReducer(
    searchWorkflowReducer,
    restoreSearchWorkflowState({ view: 'home' })
  );
  const searchView = workflow.screen.view;
  const request = workflowRequest(workflow);
  const hits = useMemo(() => [...workflowHits(workflow)], [workflow]);
  const result = workflowResult(workflow);
  const loading = workflow.activity.status === 'pending';
  const issue = currentWorkflowIssue(workflow);
  const [historyEntries, setHistoryEntries] = useState<CalculationResult[]>([]);
  const [listening, setListening] = useState(false);
  const [apiTrace, setApiTrace] = useState<ApiTraceNotice | null>(null);
  const [online, setOnline] = useState(() => typeof navigator === 'undefined' || navigator.onLine);
  const [pwaNotice, setPwaNotice] = useState<PwaStatusNotice | null>(null);
  const [capabilityWarnings] = useState<string[]>(() => {
    const warnings: string[] = [];
    const missingNetwork = missingNetworkCapabilities();
    if (missingNetwork.length) {
      warnings.push(`Netzwerksuche ist in diesem Browser nicht sicher verfügbar (${missingNetwork.join(', ')} fehlt). Die manuelle Berechnung bleibt vollständig nutzbar.`);
    }
    if (!('serviceWorker' in navigator)) {
      warnings.push('Dieser Browser unterstützt keine Offline-Installation; die Kernfunktionen bleiben im geöffneten Tab nutzbar.');
    }
    try {
      if (typeof indexedDB === 'undefined') {
        warnings.push('Dauerhafter Offline-Speicher fehlt; lokale Daten werden nur eingeschränkt gespeichert.');
      }
    } catch {
      warnings.push('Dauerhafter Offline-Speicher ist blockiert; die App verwendet einen kontrollierten Fallback.');
    }
    return warnings;
  });
  const [apiUsage, setApiUsage] = useState<ApiUsageSnapshot>(() => getApiUsageSnapshot());
  const [cacheStats, setCacheStats] = useState<ApiCacheStats>({
    entries: 0,
    freshEntries: 0,
    staleEntries: 0,
    approximateBytes: 0,
    persistence: 'memory',
    persistenceIssue: 'none'
  });
  const retryActionRef = useRef<(() => void) | null>(null);
  const activeAbort = useRef<AbortController | null>(null);
  const settingsRef = useRef(settings);
  const applyingExternalSettingsRef = useRef(false);
  const issueFocusRef = useRef<HTMLElement | null>(null);
  const historyInitializedRef = useRef(false);
  const applyingHistoryRef = useRef(false);
  const screenFocusRef = useRef<HTMLDivElement | null>(null);
  const pendingHistoryRestoreRef = useRef<{ scrollY: number; focusId: string | null } | null>(null);
  const screenFocusInitializedRef = useRef(false);
  const lastHistoryRouteRef = useRef('');
  const historyScreensRef = useRef(new Map<string, SearchScreen>());
  const snapshotRef = useRef<SessionSnapshot>({
    tab, searchView, query, manualMode, manualValues, request, hits, result
  });

  snapshotRef.current = { tab, searchView, query, manualMode, manualValues, request, hits, result };
  settingsRef.current = settings;

  function setSearchView(view: SearchView): void {
    if (view === 'home') dispatchWorkflow({ type: 'show-home', request });
    else if (view === 'candidates' && request && hits.length) {
      dispatchWorkflow({ type: 'show-candidates', request, hits: hits as [SearchHit, ...SearchHit[]] });
    }
  }

  function setRequest(next: ParsedFoodRequest | null): void {
    if (next) dispatchWorkflow({ type: 'begin-request', request: next });
    else dispatchWorkflow({ type: 'show-home' });
  }

  function showCandidateList(nextRequest: ParsedFoodRequest, nextHits: SearchHit[]): void {
    if (!nextHits.length) return;
    dispatchWorkflow({
      type: 'show-candidates',
      request: nextRequest,
      hits: nextHits as [SearchHit, ...SearchHit[]]
    });
  }

  function setResult(next: CalculationResult | null): void {
    if (next) {
      if (workflow.screen.view === 'result') dispatchWorkflow({ type: 'update-result', result: next });
      else dispatchWorkflow({ type: 'show-result', result: next, hits });
    } else {
      dispatchWorkflow({ type: 'show-home' });
    }
  }

  function setLoading(next: boolean, operation: 'search' | 'product' | 'manual' | 'voice' | 'restore' = 'search'): void {
    dispatchWorkflow(next ? { type: 'start', operation } : { type: 'finish' });
  }

  function setIssue(next: UiIssue | null): void {
    dispatchWorkflow(next ? { type: 'issue', issue: next } : { type: 'clear-issue' });
  }

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const storedSettings = await loadSettings().catch(() => null);
      const safeSettings = sanitizeSettings(storedSettings);
      const storedHistory = safeSettings.saveHistory
        ? await getHistory().catch(() => [])
        : [];
      if (!safeSettings.saveHistory) await clearHistory().catch(() => undefined);
      if (!safeSettings.saveCalibrations) await clearCalibrations().catch(() => undefined);
      if (safeSettings.cacheApiData) await pruneApiCache().catch(() => undefined);
      else await Promise.all([
        clearApiCache(),
        clearOffProductImageCache(APP_VERSION)
      ]).catch(() => undefined);
      if (cancelled) return;
      setSettings(safeSettings);
      if (safeSettings.saveSearchSession) {
        const session = loadSession();
        if (session) {
          setTab(session.tab);
          setQuery(session.query);
          setManualMode(session.manualMode);
          setManualValues(session.manualValues);
          const restored = restoreSearchWorkflowState({
            view: session.searchView,
            request: session.request,
            hits: session.hits,
            result: session.result
          });
          if (restored.screen.view === 'result') {
            dispatchWorkflow({ type: 'show-result', result: restored.screen.result, hits: restored.screen.hits });
          } else if (restored.screen.view === 'candidates') {
            dispatchWorkflow({ type: 'show-candidates', request: restored.screen.request, hits: restored.screen.hits });
          } else {
            dispatchWorkflow({ type: 'show-home', request: restored.screen.request });
          }
        }
      } else {
        clearSession();
      }
      setHistoryEntries(storedHistory.map(normalizeStoredResult));
      setApiUsage(getApiUsageSnapshot());
      setCacheStats(await getApiCacheStats().catch(() => ({
        entries: 0,
        freshEntries: 0,
        staleEntries: 0,
        approximateBytes: 0,
        persistence: 'memory' as const,
        persistenceIssue: 'unavailable' as const
      })));
      setSettingsReady(true);
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!settingsReady) return;
    if (applyingExternalSettingsRef.current) {
      applyingExternalSettingsRef.current = false;
      return;
    }
    saveSettings(settings).catch(() => undefined);
  }, [settings, settingsReady]);

  useEffect(() => {
    if (!settingsReady || settings.saveHistory) return;
    void clearHistory().then(() => setHistoryEntries([])).catch(() => undefined);
  }, [settings.saveHistory, settingsReady]);

  useEffect(() => {
    if (!settingsReady || settings.saveCalibrations) return;
    void clearCalibrations().catch(() => undefined);
  }, [settings.saveCalibrations, settingsReady]);

  useEffect(() => {
    if (!settingsReady || settings.cacheApiData) return;
    cancelPendingApiRequests();
    clearApiGovernor();
    void Promise.all([clearApiCache(), clearOffProductImageCache(APP_VERSION)]).then(async () => {
      setApiUsage(getApiUsageSnapshot());
      setCacheStats(await getApiCacheStats());
    }).catch(() => undefined);
  }, [settings.cacheApiData, settingsReady]);

  useEffect(() => {
    if (!settingsReady) return;
    if (!settings.saveSearchSession) {
      clearSession();
      return;
    }
    saveSession({ tab, searchView, query, manualMode, manualValues, request, hits, result });
  }, [tab, searchView, query, manualMode, manualValues, request, hits, result, settings.saveSearchSession, settingsReady]);

  useEffect(() => {
    if (!settingsReady) return;
    const onStorage = (event: StorageEvent) => {
      if (event.key === 'kh-checker-settings-v3') {
        void loadSettings().then((stored) => {
          const synchronized = sanitizeSettings(stored);
          if (!synchronized.cacheApiData) {
            cancelPendingApiRequests();
            clearApiGovernor();
          }
          if (!synchronized.saveHistory) setHistoryEntries([]);
          if (sameSettings(settingsRef.current, synchronized)) return;
          applyingExternalSettingsRef.current = true;
          setSettings(synchronized);
        }).catch(() => undefined);
        return;
      }
      if (event.key === 'kh-checker-history-deletions-v3' || event.key === 'kh-checker-history-v3') {
        if (event.key === 'kh-checker-history-deletions-v3') {
          synchronizeExternalRepositoryMutation('history');
        }
        if (settings.saveHistory) {
          void getHistory()
            .then((entries) => setHistoryEntries(entries.map(normalizeStoredResult)))
            .catch(() => undefined);
        }
        else setHistoryEntries([]);
      }
      if (event.key === 'kh-checker-calibration-deletions-v3') {
        synchronizeExternalRepositoryMutation('calibrations');
      }
      if (event.key === 'kh-checker-api-cache-deletions-v3') {
        cancelPendingApiRequests();
        synchronizeExternalRepositoryMutation('api-cache');
        void getApiCacheStats().then(setCacheStats).catch(() => undefined);
      } else if (event.key === 'kh-checker-v2.2-api-cache-fallback') {
        void getApiCacheStats().then(setCacheStats).catch(() => undefined);
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [settings.saveHistory, settingsReady]);

  useEffect(() => {
    const persist = () => {
      if (settings.saveSearchSession) saveSession(snapshotRef.current);
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') persist();
    };
    const onPageHide = () => persist();
    const onOnline = () => {
      setOnline(true);
      setApiUsage(getApiUsageSnapshot());
    };
    const onOffline = () => setOnline(false);
    const onPwaStatus = (event: Event) => {
      const detail = (event as CustomEvent<Partial<PwaStatusNotice>>).detail;
      setPwaNotice(detail?.message ? {
        message: detail.message,
        updateAvailable: detail.updateAvailable === true,
        applyUpdate: detail.applyUpdate
      } : null);
    };
    const onPwaUpdateAvailable = (event: Event) => {
      const detail = (event as CustomEvent<{ apply?: () => void | Promise<void> }>).detail;
      setPwaNotice({
        message: 'Eine neue App-Version ist verfügbar. Aktualisiere erst, wenn deine aktuelle Eingabe abgeschlossen ist.',
        updateAvailable: true,
        applyUpdate: detail?.apply
      });
    };

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    window.addEventListener('kh:pwa-status', onPwaStatus);
    window.addEventListener('kh:pwa-update-available', onPwaUpdateAvailable);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('kh:pwa-status', onPwaStatus);
      window.removeEventListener('kh:pwa-update-available', onPwaUpdateAvailable);
      activeAbort.current?.abort();
      activeAbort.current = null;
    };
  }, [settings.saveSearchSession]);

  useEffect(() => {
    const onPopState = (event: PopStateEvent) => {
      const state = event.state as AppHistoryState | null;
      if (!state?.khChecker || !isTab(state.tab)) return;
      applyingHistoryRef.current = true;
      pendingHistoryRestoreRef.current = {
        scrollY: typeof state.scrollY === 'number' && Number.isFinite(state.scrollY) ? Math.max(0, state.scrollY) : 0,
        focusId: typeof state.focusId === 'string' ? state.focusId : null
      };
      setTab(state.tab);
      const screen = historyScreensRef.current.get(state.entryId);
      if (screen?.view === 'result') {
        dispatchWorkflow({ type: 'show-result', result: screen.result, hits: screen.hits });
      } else if (screen?.view === 'candidates') {
        dispatchWorkflow({ type: 'show-candidates', request: screen.request, hits: screen.hits });
      } else {
        dispatchWorkflow({ type: 'show-home', request: screen?.view === 'home' ? screen.request : null });
      }
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  useEffect(() => {
    let frame: number | null = null;
    const persistViewport = () => {
      const state = window.history.state as AppHistoryState | null;
      if (!state?.khChecker) return;
      const active = document.activeElement;
      window.history.replaceState({
        ...state,
        scrollY: Math.max(0, window.scrollY),
        focusId: active instanceof HTMLElement && active.id ? active.id : state.focusId ?? null
      }, '', window.location.href);
    };
    const onScroll = () => {
      if (frame !== null) return;
      frame = window.requestAnimationFrame(() => {
        frame = null;
        persistViewport();
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    document.addEventListener('focusin', persistViewport);
    return () => {
      window.removeEventListener('scroll', onScroll);
      document.removeEventListener('focusin', persistViewport);
      if (frame !== null) window.cancelAnimationFrame(frame);
    };
  }, []);

  useEffect(() => {
    const currentState = window.history.state as AppHistoryState | null;
    if (!applyingHistoryRef.current && currentState?.khChecker) {
      const activeElement = document.activeElement;
      window.history.replaceState({
        ...currentState,
        scrollY: Math.max(0, window.scrollY),
        focusId: activeElement instanceof HTMLElement && activeElement.id ? activeElement.id : null
      }, '', window.location.href);
    }
    const entryId = createId('navigation');
    historyScreensRef.current.set(entryId, workflow.screen);
    while (historyScreensRef.current.size > 32) {
      const oldest = historyScreensRef.current.keys().next().value;
      if (typeof oldest !== 'string') break;
      historyScreensRef.current.delete(oldest);
    }
    const state = createNavigationHistoryState(tab, workflow.screen.view, entryId);
    const hash = `#/${tab}${tab === 'search' ? `/${workflow.screen.view}` : ''}`;
    if (!historyInitializedRef.current) {
      window.history.replaceState(state, '', hash);
      historyInitializedRef.current = true;
      lastHistoryRouteRef.current = hash;
      return;
    }
    if (applyingHistoryRef.current) {
      applyingHistoryRef.current = false;
      lastHistoryRouteRef.current = hash;
      return;
    }
    if (lastHistoryRouteRef.current === hash) {
      window.history.replaceState(state, '', hash);
      return;
    }
    window.history.pushState(state, '', hash);
    lastHistoryRouteRef.current = hash;
  }, [tab, workflow.screen]);

  useEffect(() => {
    const routeKey = `${tab}:${searchView}`;
    if (!screenFocusInitializedRef.current) {
      screenFocusInitializedRef.current = true;
      try { window.history.scrollRestoration = 'manual'; } catch { /* unsupported */ }
      return;
    }
    const restore = pendingHistoryRestoreRef.current;
    pendingHistoryRestoreRef.current = null;
    window.requestAnimationFrame(() => {
      screenFocusRef.current?.setAttribute('data-active-route', routeKey);
      const focusTarget = restore?.focusId ? document.getElementById(restore.focusId) : null;
      const target = focusTarget instanceof HTMLElement ? focusTarget : screenFocusRef.current;
      try { target?.focus({ preventScroll: true }); } catch { target?.focus(); }
      window.scrollTo(0, restore?.scrollY ?? 0);
    });
  }, [tab, searchView]);

  useEffect(() => {
    if (!issue) return;
    issueFocusRef.current?.focus();
  }, [issue]);

  const favorites = useMemo(() => historyEntries.filter((entry) => entry.favorite), [historyEntries]);
  const missingNetwork = missingNetworkCapabilities();
  const configuredGateway = validateHttpEndpoint(settings.dataGatewayUrl);
  const gatewayError = settingsReady
    ? missingNetwork.length
      ? `Browser-Funktionen für die Netzwerksuche fehlen: ${missingNetwork.join(', ')}.`
      : configuredGateway.error ?? (!configuredGateway.value ? 'Kein Daten-Gateway konfiguriert.' : null)
    : null;

  async function refreshHistory() {
    try {
      setHistoryEntries((await getHistory()).map(normalizeStoredResult));
    } catch {
      // A persistence failure must never invalidate an otherwise valid result.
    }
  }

  async function commitResult(next: CalculationResult) {
    const normalized = normalizeStoredResult(next);
    dispatchWorkflow({ type: 'show-result', result: normalized, hits: normalized.candidates });
    if (settings.saveHistory) {
      try {
        await saveResult(normalized);
        await refreshHistory();
      } catch {
        // Keep the successful calculation visible; storage is optional.
      }
    }
  }

  async function updateCurrentResult(next: CalculationResult) {
    const stable = result
      ? { ...normalizeStoredResult(next), id: result.id, createdAt: result.createdAt, favorite: result.favorite }
      : normalizeStoredResult(next);
    dispatchWorkflow({ type: 'update-result', result: stable });
    if (settings.saveHistory) {
      try {
        await saveResult(stable);
        await refreshHistory();
      } catch {
        // Keep the in-memory edit available.
      }
    }
  }

  async function parseInput(input: string, controller: AbortController): Promise<ParsedFoodRequest> {
    const safeSettings = sanitizeSettings(settings);
    if (safeSettings.aiEnabled) {
      try {
        const parsed = await parseFoodRequestWithAi(input, configuredGatewayUrl(), controller.signal);
        ensureControllerActive(controller);
        return parsed;
      } catch {
        ensureControllerActive(controller);
        return parseFoodRequestLocal(input);
      }
    }
    return parseFoodRequestLocal(input);
  }

  function refreshApiUsage(): ApiUsageSnapshot {
    const snapshot = getApiUsageSnapshot();
    setApiUsage(snapshot);
    void getApiCacheStats().then(setCacheStats).catch(() => undefined);
    return snapshot;
  }

  function configuredGatewayUrl(): string {
    const missing = missingNetworkCapabilities();
    if (missing.length) {
      throw new DataSourceError(
        `Netzwerksuche ist in diesem Browser nicht verfügbar (${missing.join(', ')} fehlt). Die manuelle Berechnung bleibt nutzbar.`,
        'configuration'
      );
    }
    const validation = validateHttpEndpoint(settings.dataGatewayUrl);
    if (validation.error || !validation.value) {
      throw new DataSourceError(
        validation.error || 'Kein Daten-Gateway konfiguriert. Die manuelle und lokale Nutzung bleibt verfügbar.',
        'configuration'
      );
    }
    return validation.value;
  }

  function configuredProductApiMode(): ProductApiMode {
    const candidate = settings.productApiMode;
    if (candidate === 'v2' || candidate === 'v3' || candidate === 'hybrid') return candidate;
    return 'hybrid';
  }

  function findSavedCalibration(
    input: Parameters<typeof findCalibration>[0]
  ): ReturnType<typeof findCalibration> {
    return settings.saveCalibrations ? findCalibration(input) : Promise.resolve(null);
  }

  function observeApiMeta(responseMeta: ApiResponseMeta | undefined, label: string): void {
    refreshApiUsage();
    if (!responseMeta) return;
    setIssue(null);
    setApiTrace((previous) => appendApiTrace(previous, label, responseMeta));
  }

  function observeRecoveredError(caught: unknown, label: string): void {
    if (!(caught instanceof DataSourceError) || caught.kind === 'aborted') return;
    const lastAttempt = caught.attempts[caught.attempts.length - 1];
    const recoveredMeta: ApiResponseMeta = {
      cacheStatus: 'network',
      fetchedAt: new Date().toISOString(),
      sourceUrl: lastAttempt?.url ?? '',
      backend: lastAttempt?.backend,
      originBackend: lastAttempt?.backend,
      networkAttempted: true,
      durationMs: caught.attempts.reduce((sum, attempt) => sum + attempt.durationMs, 0),
      attempts: caught.attempts,
      fallbackReason: caught.kind === 'rate-limit'
        ? 'rate-limit'
        : caught.kind === 'timeout'
          ? 'timeout'
          : caught.kind === 'parse'
            ? 'parse'
            : caught.kind === 'http'
              ? 'http'
              : 'network',
      fallbackStatus: caught.status,
      fallbackOrigin: caught.status === 503 ? 'remote-overload' : caught.status === 429 ? 'remote-limit' : undefined,
      retryAt: caught.retryAt ? new Date(caught.retryAt).toISOString() : undefined
    };
    setApiTrace((previous) => appendApiTrace(previous, label, recoveredMeta));
    refreshApiUsage();
  }

  function handleOperationError(
    caught: unknown,
    fallback: string,
    retryLabel: string,
    retryAction: () => void
  ) {
    if (caught instanceof DataSourceError && caught.kind === 'aborted') return;
    retryActionRef.current = retryAction;
    const occurredAt = new Date().toISOString();

    if (caught instanceof DataSourceError) {
      const attempts = caught.attempts;
      const failedAttempts = attempts.filter((attempt) => !['success', 'cache-hit'].includes(attempt.outcome));
      const failedAttempt = failedAttempts[failedAttempts.length - 1];
      const technical = failedAttempt
        ? attemptTechnicalText(failedAttempt)
        : `${caught.name}: ${caught.message}`;
      const title: Record<DataSourceError['kind'], string> = {
        configuration: 'Daten-Gateway nicht konfiguriert',
        aborted: 'Anfrage abgebrochen',
        timeout: 'API-Zeitüberschreitung',
        network: 'Netzwerk- oder CORS-Fehler',
        parse: 'Ungültige API-Antwort',
        http: `API-Fehler${caught.status ? ` HTTP ${caught.status}` : ''}`,
        'rate-limit': `API-Hinweis${caught.status ? ` HTTP ${caught.status}` : ''}`
      };
      const message: Record<DataSourceError['kind'], string> = {
        configuration: 'Für eine neue Produktsuche ist ein Daten-Gateway erforderlich. Manuelle Berechnung und lokal gespeicherte Ergebnisse funktionieren weiterhin.',
        aborted: '',
        timeout: 'Die Datenquelle hat innerhalb des sicheren Zeitlimits nicht geantwortet. Die Suche bleibt entsperrt und kann sofort neu gestartet werden.',
        network: 'Der Browser konnte den API-Endpunkt nicht erreichen oder dessen Antwort wegen CORS nicht lesen. Unten steht der originale technische Fehler.',
        parse: 'Der Endpunkt war erreichbar, lieferte aber kein lesbares JSON. Der Antwortanfang wird unten angezeigt.',
        http: caught.status === 404
          ? 'Der Endpunkt meldet, dass kein Datensatz vorhanden ist.'
          : 'Der Server hat die Anfrage mit einem HTTP-Fehler abgelehnt. Der Status und die Antwort stehen unten.',
        'rate-limit': 'Der Server meldet ein Limit oder eine Überlastung. Retry-After wird als Hinweis angezeigt; jede Nutzeraktion kann sofort erneut versuchen.'
      };
      setIssue({
        kind: caught.kind === 'configuration'
          ? 'configuration'
          : !online || caught.kind === 'network' && typeof navigator !== 'undefined' && !navigator.onLine
            ? 'offline'
            : caught.status === 404
              ? 'empty'
              : 'error',
        title: title[caught.kind],
        message: message[caught.kind],
        technical,
        attempts,
        occurredAt,
        retryLabel
      });
      setApiTrace(null);
      refreshApiUsage();
      return;
    }

    const message = regularErrorMessage(caught, fallback);
    setIssue({
      kind: /keine|nicht gefunden/i.test(message) ? 'empty' : 'error',
      title: 'Anfrage nicht abgeschlossen',
      message,
      technical: caught instanceof Error ? `${caught.name}: ${caught.message}` : String(caught),
      attempts: [],
      occurredAt,
      retryLabel
    });
    setApiTrace(null);
  }

  async function hydrateCandidate(
    parsed: ParsedFoodRequest,
    hit: SearchHit,
    controller: AbortController,
    manualUnitWeight?: number | null
  ): Promise<{ candidate: SearchHit; product?: OffProduct; result: CalculationResult }> {
    let candidate = hit;
    let product: OffProduct | undefined;
    const calibration = await findSavedCalibration({
      productName: displayProductName(candidate),
      brand: displayBrand(candidate.brands),
      barcode: candidate.code ?? null,
      unit: parsed.amount.unit,
      allowGenericScope: false
    });
    ensureControllerActive(controller);
    let next = buildExactResult(parsed, candidate, undefined, calibration, manualUnitWeight);

    // Search result DTOs are intentionally compact and may omit quantity or
    // serving metadata even when the product page contains it. Hydrate only the
    // product that was actually selected so individual portions such as
    // “2 × 21.5 g” can be reconstructed without a request fan-out.
    if (candidate.code) {
      try {
        const response = await getProductByBarcode(candidate.code, controller.signal, {
          gatewayUrl: configuredGatewayUrl(),
          productApiMode: configuredProductApiMode(),
          seedProduct: productSeedFromSearchHit(candidate),
          cacheEnabled: settings.cacheApiData
        });
        ensureControllerActive(controller);
        observeApiMeta(response.api_meta, 'Produktdetails');
        product = response.product;
        if (product) candidate = mergeSearchHit(candidate, syntheticHit(product, response.api_meta));
        next = buildExactResult(parsed, candidate, product, calibration, manualUnitWeight);
      } catch (caught) {
        ensureControllerActive(controller);
        if (caught instanceof DataSourceError && caught.kind === 'aborted') throw caught;
        observeRecoveredError(caught, 'Produktdetails fehlgeschlagen – Suchtreffer weiterverwendet');
        // The search DTO remains a valid deterministic fallback.
      }
    }

    ensureControllerActive(controller);
    return { candidate, product, result: next };
  }

  async function executeSearch(input: string, forcedRequest?: ParsedFoodRequest, manualUnitWeight?: number | null) {
    if (!settingsReady) {
      handleOperationError(
        new DataSourceError('Einstellungen werden noch geladen.', 'configuration'),
        'Bitte warte kurz.',
        'Erneut versuchen',
        () => { void executeSearch(input, forcedRequest, manualUnitWeight); }
      );
      return;
    }
    activeAbort.current?.abort();
    const controller = new AbortController();
    activeAbort.current = controller;
    setLoading(true, forcedRequest ? 'manual' : 'search');
    setIssue(null);
    setApiTrace(null);

    try {
      let parsed = forcedRequest ?? await parseInput(input, controller);
      ensureControllerActive(controller);
      if (parsed.status !== 'parsed') {
        throw new Error(parsed.clarificationQuestion ?? 'Die Anfrage konnte nicht eindeutig verstanden werden.');
      }
      setRequest(parsed);

      if (parsed.resolutionMode === 'barcode' && parsed.barcode) {
        const productApiMode = configuredProductApiMode();
        const productResponse = await getProductByBarcode(parsed.barcode, controller.signal, {
          gatewayUrl: configuredGatewayUrl(),
          productApiMode,
          cacheEnabled: settings.cacheApiData
        });
        ensureControllerActive(controller);
        observeApiMeta(productResponse.api_meta, 'Barcode-Produkt');
        if (!productResponse.product) throw new Error('Zu diesem Barcode wurde kein Produkt gefunden.');
        const hit = syntheticHit(productResponse.product, productResponse.api_meta);
        const calibration = await findSavedCalibration({
          productName: displayProductName(hit),
          brand: displayBrand(hit.brands),
          barcode: parsed.barcode,
          unit: parsed.amount.unit,
          allowGenericScope: false
        });
        ensureControllerActive(controller);
        await commitResult(buildExactResult(parsed, hit, productResponse.product, calibration, manualUnitWeight));
        return;
      }

      const baseReference = parsed.resolutionMode === 'generic_category'
        ? getBaseFoodReference(parsed.product.name)
        : null;
      if (baseReference) {
        const calibration = await findSavedCalibration({
          productName: parsed.product.name,
          brand: parsed.product.brand,
          barcode: null,
          unit: parsed.amount.unit,
          allowGenericScope: true
        });
        ensureControllerActive(controller);
        await commitResult(buildBaseFoodReferenceResult(parsed, baseReference, calibration, manualUnitWeight));
        return;
      }

      const searchOutcome = await searchFoodCandidatesOutcome(
        requestSearchQuery(parsed),
        settings.searchPageSize,
        controller.signal,
        {
          preserveVariants: parsed.resolutionMode === 'exact_product'
            || Boolean(parsed.product.brand)
            || parsed.product.name.trim().split(/\s+/).length >= 3,
          gatewayUrl: configuredGatewayUrl(),
          productOnly: parsed.product.name,
          cacheEnabled: settings.cacheApiData
        }
      );
      ensureControllerActive(controller);
      const searchResponse = requireSearchResponse(searchOutcome);
      observeApiMeta(searchResponse.api_meta, 'Produktsuche');

      if (!searchResponse.hits.length) {
        throw new Error('Keine passenden Produkte gefunden. Prüfe die Schreibweise oder ergänze Marke beziehungsweise Produkttyp.');
      }

      const responseHits = searchResponse.hits.map((hit) => ({ ...hit, api_meta: searchResponse.api_meta }));
      const ranked = rankExactCandidates(parsed.product.name, responseHits, settings.preferGermanMarket);
      const orderedHits = ranked.length ? ranked : responseHits;

      if (
        parsed.resolutionMode === 'generic_category'
        && !isGenericCategoryQuery(parsed.product.name)
        && shouldResolveAsExactProduct(parsed.product.name, orderedHits)
      ) {
        parsed = { ...parsed, resolutionMode: 'exact_product' };
        setRequest(parsed);
      }

      if (parsed.resolutionMode === 'generic_category') {
        const generic = resolveGenericCandidates(
          parsed.product.name,
          responseHits,
          settings.preferGermanMarket,
          parsed.amount.unitExplicit ? parsed.amount.unit : undefined
        );
        const genericHits = generic.hits.length ? generic.hits : orderedHits;
        const visibleHits = orderedHits.filter((candidate) => sameProductFamily(parsed.product.name, candidate));
        const candidateHits = visibleHits.length ? visibleHits : genericHits;
        // Prefer a concrete, correctly matching product only when the search DTO
        // already proves the requested unit or a genuine manufacturer serving.
        // The chosen product is then hydrated once to restore any quantity and
        // serving fields omitted from the compact search response.
        const previews = candidateHits.slice(0, 12).map((candidate) => {
          const preview = buildExactResult(parsed, candidate, undefined, null, manualUnitWeight);
          const option = preview.portionOptions.find((item) => item.id === preview.selectedPortionId);
          const explicitCounted = parsed.amount.unitExplicit && isCountedFoodUnit(parsed.amount.unit);
          const safe = explicitCounted
            ? preview.status === 'calculated' && preview.unit === parsed.amount.unit
            : preview.status === 'calculated' && Boolean(option && ['explicit-unit', 'manufacturer-serving', 'single-package'].includes(option.source));
          let score = candidateIdentityScore(parsed.product.name, candidate);
          if (option?.source === 'explicit-unit') score += 360;
          else if (option?.source === 'manufacturer-serving') score += 220;
          else if (option?.source === 'single-package') score += 120;
          if (explicitCounted && preview.unit === parsed.amount.unit) score += 300;
          return { candidate, preview, safe, score };
        }).filter((entry) => entry.safe).sort((a, b) => b.score - a.score);

        const bestPortioned = previews[0];
        if (bestPortioned && bestPortioned.score >= 600) {
          const hydrated = await hydrateCandidate(parsed, bestPortioned.candidate, controller, manualUnitWeight);
          ensureControllerActive(controller);
          await commitResult({
            ...hydrated.result,
            candidates: candidateHits,
            notes: [
              ...hydrated.result.notes,
              'Ein konkretes, gut passendes Produkt mit belegter Einzelportion wurde bevorzugt. Alle Alternativen bleiben über „Produkt wählen“ sichtbar.'
            ]
          });
          return;
        }

        if (generic.median === null && candidateHits.length > 0) {
          showCandidateList(parsed, candidateHits);
          return;
        }

        const calibration = await findSavedCalibration({
          productName: parsed.product.name,
          brand: parsed.product.brand,
          barcode: null,
          unit: parsed.amount.unit,
          allowGenericScope: true
        });
        ensureControllerActive(controller);
        await commitResult(buildGenericResult(parsed, generic, calibration, manualUnitWeight));
        return;
      }

      const candidates = orderedHits
        .filter((candidate) => sameProductFamily(parsed.product.name, candidate))
        .slice(0, 12);
      if (!candidates.length) {
        showCandidateList(parsed, orderedHits);
        return;
      }

      const prelim = candidates.map((candidate) => {
        const preview = buildExactResult(parsed, candidate, undefined, null, manualUnitWeight);
        const selected = preview.portionOptions.find((option) => option.id === preview.selectedPortionId);
        let score = candidateIdentityScore(parsed.product.name, candidate);
        if (preview.status === 'calculated') score += 220;
        if (selected?.source === 'explicit-unit') score += 160;
        else if (selected?.source === 'manufacturer-serving') score += 80;
        if (parsed.amount.unitExplicit && preview.unit === parsed.amount.unit) score += 180;
        return { candidate, preview, score };
      }).sort((a, b) => b.score - a.score);

      const best = prelim[0];
      if (!best || candidateIdentityScore(parsed.product.name, best.candidate) < 560) {
        showCandidateList(parsed, orderedHits);
        return;
      }

      const hydrated = await hydrateCandidate(parsed, best.candidate, controller, manualUnitWeight);
      ensureControllerActive(controller);
      await commitResult({ ...hydrated.result, candidates: orderedHits });
    } catch (caught) {
      if (!controller.signal.aborted) {
        handleOperationError(
          caught,
          'Die Suche konnte nicht abgeschlossen werden.',
          'Erneut versuchen',
          () => { void executeSearch(input, forcedRequest, manualUnitWeight); }
        );
      }
    } finally {
      if (activeAbort.current === controller) {
        activeAbort.current = null;
        setLoading(false);
      }
    }
  }

  async function selectCandidate(
    hit: SearchHit,
    parsed = request,
    manualUnitWeight?: number | null,
    existingController?: AbortController
  ) {
    if (!parsed) return;
    const controller = existingController ?? new AbortController();
    if (!existingController) {
      activeAbort.current?.abort();
      activeAbort.current = controller;
      setLoading(true);
      setIssue(null);
      setApiTrace(null);
    }

    try {
      const hydrated = await hydrateCandidate(parsed, hit, controller, manualUnitWeight);
      ensureControllerActive(controller);
      await commitResult(hydrated.result);
      refreshApiUsage();
    } catch (caught) {
      if (!controller.signal.aborted) {
        handleOperationError(
          caught,
          'Produkt konnte nicht geladen werden.',
          'Produkt erneut laden',
          () => { void selectCandidate(hit, parsed, manualUnitWeight); }
        );
      }
    } finally {
      if (!existingController && activeAbort.current === controller) {
        activeAbort.current = null;
        setLoading(false);
      }
    }
  }

  async function chooseGeneric() {
    if (!request) return;
    try {
      const genericRequest: ParsedFoodRequest = { ...request, resolutionMode: 'generic_category' };
      const calibration = await findSavedCalibration({
        productName: genericRequest.product.name,
        brand: genericRequest.product.brand,
        barcode: null,
        unit: genericRequest.amount.unit,
        allowGenericScope: true
      });
      const reference = getBaseFoodReference(genericRequest.product.name);
      setRequest(genericRequest);
      if (reference) {
        await commitResult(buildBaseFoodReferenceResult(genericRequest, reference, calibration));
        return;
      }
      const generic = resolveGenericCandidates(
        genericRequest.product.name,
        hits,
        settings.preferGermanMarket,
        genericRequest.amount.unitExplicit ? genericRequest.amount.unit : undefined
      );
      await commitResult(buildGenericResult(genericRequest, generic, calibration));
    } catch (caught) {
      handleOperationError(
        caught,
        'Das allgemeine Basislebensmittel konnte nicht sicher berechnet werden.',
        'Erneut versuchen',
        () => { void chooseGeneric(); }
      );
    }
  }

  async function showProductCandidates() {
    if (!request) return;
    if (hits.length) {
      showCandidateList(request, hits);
      return;
    }

    const controller = new AbortController();
    activeAbort.current?.abort();
    activeAbort.current = controller;
    setLoading(true);
    setIssue(null);
    setApiTrace(null);
    try {
      const outcome = await searchFoodCandidatesOutcome(
        requestSearchQuery(request),
        settings.searchPageSize,
        controller.signal,
        {
          preserveVariants: true,
          gatewayUrl: configuredGatewayUrl(),
          productOnly: request.product.name,
          cacheEnabled: settings.cacheApiData
        }
      );
      ensureControllerActive(controller);
      const response = requireSearchResponse(outcome);
      observeApiMeta(response.api_meta, 'Produktauswahl');
      const ranked = rankExactCandidates(request.product.name, response.hits, settings.preferGermanMarket);
      const nextHits = ranked.length ? ranked : response.hits;
      if (!nextHits.length) throw new Error('Keine konkreten Produkte zu dieser Basisanfrage gefunden.');
      showCandidateList(request, nextHits);
      refreshApiUsage();
    } catch (caught) {
      if (!controller.signal.aborted) {
        handleOperationError(
          caught,
          'Produkte konnten nicht geladen werden.',
          'Produkte erneut laden',
          () => { void showProductCandidates(); }
        );
      }
    } finally {
      if (activeAbort.current === controller) {
        activeAbort.current = null;
        setLoading(false);
      }
    }
  }

  async function handleManualSubmit() {
    if (!manualValues.productName.trim() || !isPlausibleFoodAmount(manualValues.amount, manualValues.unit)) {
      setIssue({
        kind: 'error',
        title: 'Manuelle Angaben prüfen',
        message: 'Produktname und eine plausible Menge größer als 0 sind erforderlich. Sehr große Chargen bitte auf mehrere Berechnungen aufteilen.',
        technical: 'ManualValidationError: invalid or implausible product amount',
        attempts: [],
        occurredAt: new Date().toISOString(),
        retryLabel: 'Erneut prüfen'
      });
      retryActionRef.current = () => { void handleManualSubmit(); };
      return;
    }
    if (manualValues.nutritionBasis === '100ml' && manualValues.unit !== 'ml') {
      setIssue({
        kind: 'error',
        title: 'Volumen in Millilitern angeben',
        message: 'Ein Etikettwert pro 100 ml kann nur mit dem Gesamtvolumen in Millilitern berechnet werden.',
        technical: 'ManualValidationError: 100ml basis without ml amount',
        attempts: [],
        occurredAt: new Date().toISOString(),
        retryLabel: 'Eingabe prüfen'
      });
      return;
    }
    if (manualValues.unitWeightG !== null && (
      !Number.isFinite(manualValues.unitWeightG)
      || manualValues.unitWeightG <= 0
      || !isPlausibleUnitWeightForUnit(manualValues.unitWeightG, manualValues.unit)
      || !isPlausibleTotalMass(manualValues.amount * manualValues.unitWeightG)
    )) {
      setIssue({
        kind: 'error',
        title: 'Stückgewicht prüfen',
        message: 'Das Stückgewicht muss größer als 0 sein und darf weder 5 kg je Einheit noch 100 kg Gesamtgewicht überschreiten.',
        technical: 'ManualValidationError: implausible unitWeightG',
        attempts: [],
        occurredAt: new Date().toISOString(),
        retryLabel: 'Erneut prüfen'
      });
      return;
    }
    if (!isValidCarbohydratesPer100(manualValues.carbsPer100, manualValues.nutritionBasis)) {
      const maximum = maximumCarbohydratesPer100(manualValues.nutritionBasis);
      setIssue({
        kind: 'error',
        title: 'Kohlenhydrate prüfen',
        message: `Trage den Etikettwert pro ${manualValues.nutritionBasis === '100g' ? '100 g' : '100 ml'} zwischen 0 und ${maximum} ein.`,
        technical: 'ManualValidationError: carbsPer100 missing or implausible',
        attempts: [],
        occurredAt: new Date().toISOString(),
        retryLabel: 'Eingabe prüfen'
      });
      return;
    }
    try {
      await commitResult(buildManualResult(manualValues));
    } catch (caught) {
      handleOperationError(caught, 'Die manuellen Angaben sind ungültig.', 'Eingabe prüfen', () => { void handleManualSubmit(); });
    }
  }

  function startVoice() {
    const Constructor = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!Constructor) {
      setIssue({
        kind: 'unsupported',
        title: 'Spracherkennung nicht verfügbar',
        message: 'Dieser Browser bietet keine kompatible Spracheingabe. Die Texteingabe bleibt vollständig nutzbar.',
        technical: 'SpeechRecognition API unavailable',
        attempts: [],
        occurredAt: new Date().toISOString(),
        retryLabel: 'Erneut prüfen'
      });
      retryActionRef.current = startVoice;
      return;
    }
    const recognition = new Constructor();
    recognition.lang = 'de-DE';
    recognition.interimResults = false;
    recognition.continuous = false;
    recognition.onresult = (event) => {
      const transcript = event.results[0]?.[0]?.transcript?.trim();
      if (transcript) setQuery(transcript);
    };
    recognition.onerror = (event) => {
      setIssue({
        kind: 'error',
        title: 'Spracheingabe fehlgeschlagen',
        message: 'Die Spracheingabe konnte nicht verarbeitet werden. Du kannst sofort erneut starten oder Text eingeben.',
        technical: `SpeechRecognitionError: ${event.error}`,
        attempts: [],
        occurredAt: new Date().toISOString(),
        retryLabel: 'Spracheingabe erneut starten'
      });
      retryActionRef.current = startVoice;
    };
    recognition.onend = () => setListening(false);
    startSpeechRecognitionSafely(recognition, setListening, (caught) => {
      setIssue({
        kind: 'error',
        title: 'Spracheingabe konnte nicht gestartet werden',
        message: 'Der Browser hat den Start der Spracheingabe abgelehnt. Du kannst die Texteingabe weiterhin verwenden.',
        technical: caught instanceof Error ? `${caught.name}: ${caught.message}` : String(caught),
        attempts: [],
        occurredAt: new Date().toISOString(),
        retryLabel: 'Spracheingabe erneut starten'
      });
      retryActionRef.current = startVoice;
    });
  }

  async function resolveWeight(measurement: WeightMeasurement) {
    const { unitWeightG, measuredPieces, measuredTotalWeightG, reuseScope } = measurement;
    if (!result) return;
    if (result.basis === '100ml') {
      throw new RangeError('Für Nährwerte pro 100 ml wird das Gesamtvolumen in Millilitern benötigt; ein Gewicht reicht ohne Dichte nicht aus.');
    }
    if (!isPlausibleUnitWeightForUnit(unitWeightG, result.unit)
      || !isPlausibleTotalMass(unitWeightG * result.amount)) {
      throw new RangeError('Das Einheiten- oder daraus folgende Gesamtgewicht liegt außerhalb der sicheren Berechnungsgrenze.');
    }

    const measuredCount = Number.isInteger(measuredPieces) && (measuredPieces ?? 0) >= 1
      ? Number(measuredPieces)
      : 1;
    const totalWeight = measuredTotalWeightG !== null
      && Number.isFinite(measuredTotalWeightG)
      && measuredTotalWeightG > 0
      ? measuredTotalWeightG
      : unitWeightG * measuredCount;
    if (!isPlausibleTotalMass(totalWeight)) {
      throw new RangeError('Das gemessene Gesamtgewicht muss größer als 0 und darf höchstens 100 kg sein.');
    }
    const calibration = createPieceCalibration({
      productName: result.mode === 'generic' ? result.request.product.name : result.product.name,
      displayName: result.product.name,
      brand: result.product.brand,
      barcode: result.product.barcode,
      unit: result.unit,
      measuredCount,
      measuredTotalWeightG: totalWeight,
      carbohydratesPer100g: result.basis === '100g' ? result.carbohydratesPer100 : null,
      scope: reuseScope === 'generic' ? 'generic_food' : undefined,
      smallestEdibleUnit: isCountedFoodUnit(result.unit)
    });
    if (isCalibratableUnit(result.unit) && !calibration) {
      throw new RangeError('Die Messung ist als Kalibrierung nicht plausibel. Bitte Anzahl und Gesamtgewicht prüfen.');
    }
    const next = normalizeStoredResult(recalculateResult(result, result.amount, unitWeightG));
    if (settings.saveCalibrations && calibration) await saveCalibration(calibration);
    await updateCurrentResult(next);
  }

  async function resolveTotalAmount(value: number, reuseScope: WeightMeasurement['reuseScope'] = 'product') {
    if (!result) return;

    if (result.basis === '100ml') {
      await updateCurrentResult(normalizeStoredResult(recalculateWithManualTotalVolume(result, value)));
      return;
    }

    const next = normalizeStoredResult(recalculateWithManualTotalMass(result, value));
    let calibration: ReturnType<typeof createPieceCalibration> = null;
    if (supportsUnitWeight(result.unit) && Number.isInteger(result.amount) && result.amount >= 1) {
      calibration = createPieceCalibration({
        productName: result.mode === 'generic' ? result.request.product.name : result.product.name,
        displayName: result.product.name,
        brand: result.product.brand,
        barcode: result.product.barcode,
        unit: result.unit,
        measuredCount: result.amount,
        measuredTotalWeightG: value,
        carbohydratesPer100g: result.carbohydratesPer100,
        scope: reuseScope === 'generic' ? 'generic_food' : undefined,
        smallestEdibleUnit: isCountedFoodUnit(result.unit)
      });
      if (isCalibratableUnit(result.unit) && !calibration) {
        throw new RangeError('Die abgeleitete Kalibrierung ist nicht plausibel. Bitte Menge und Gesamtgewicht prüfen.');
      }
    }
    if (settings.saveCalibrations && calibration) await saveCalibration(calibration);
    await updateCurrentResult(next);
  }

  async function toggleFavorite() {
    if (!result) return;
    const next = { ...result, favorite: !result.favorite };
    setResult(next);
    if (settings.saveHistory) {
      await saveResult(next);
      await refreshHistory();
    }
  }

  async function changePortion(amount: number, portionId: string) {
    if (!result) return;
    await updateCurrentResult(normalizeStoredResult(recalculateWithPortion(result, amount, portionId)));
  }

  function resetSearch() {
    activeAbort.current?.abort();
    activeAbort.current = null;
    setLoading(false);
    dispatchWorkflow({ type: 'reset' });
    setIssue(null);
    setApiTrace(null);
    retryActionRef.current = null;
    setQuery('');
    setManualValues(DEFAULT_MANUAL);
  }

  function openStored(entry: CalculationResult) {
    const normalized = normalizeStoredResult(entry);
    setTab('search');
    dispatchWorkflow({ type: 'show-result', result: normalized, hits: normalized.candidates });
  }

  async function removeStored(id: string) {
    await deleteResult(id);
    await refreshHistory();
  }

  const activeScreenLabel = tab === 'search'
    ? searchView === 'home' ? 'Suche' : searchView === 'candidates' ? 'Produktauswahl' : 'Ergebnis'
    : tab === 'history' ? 'Verlauf' : tab === 'favorites' ? 'Favoriten' : 'Einstellungen';

  return (
    <div className="app-shell">
      <main className="app-main">
        {tab === 'search' && <SearchHeader onHistory={() => setTab('history')} />}

        <RuntimeStatusRegion
          settingsReady={settingsReady}
          online={online}
          gatewayError={gatewayError}
          pending={loading}
          capabilityWarnings={capabilityWarnings}
          pwaNotice={pwaNotice}
          onApplyPwaUpdate={() => {
            const apply = pwaNotice?.applyUpdate;
            setPwaNotice(null);
            void Promise.resolve(apply?.()).catch(() => {
              setPwaNotice({ message: 'Die Aktualisierung konnte nicht gestartet werden. Bitte versuche es später erneut.' });
            });
          }}
          onConfigure={() => setTab('settings')}
          onDismissPwa={() => setPwaNotice(null)}
        />

        {issue && (
          <ApiIssueBanner
            issue={issue}
            bannerRef={issueFocusRef}
            onDismiss={() => {
              setIssue(null);
              retryActionRef.current = null;
            }}
            onRetry={() => {
              const retry = retryActionRef.current;
              setIssue(null);
              retry?.();
            }}
          />
        )}
        {!issue && apiTrace && <ApiTraceBanner notice={apiTrace} onDismiss={() => setApiTrace(null)} />}

        <section
          ref={screenFocusRef}
          className="screen-focus-root"
          aria-label={`${activeScreenLabel}-Ansicht`}
          tabIndex={-1}
        >
        {tab === 'search' && searchView === 'home' && (
          <HomeScreen
            query={query}
            setQuery={setQuery}
            onSubmit={() => executeSearch(query)}
            loading={loading}
            manualMode={manualMode}
            setManualMode={setManualMode}
            manualValues={manualValues}
            setManualValues={setManualValues}
            onManualSubmit={handleManualSubmit}
            listening={listening}
            onVoice={startVoice}
            settingsReady={settingsReady}
          />
        )}

        {tab === 'search' && searchView === 'candidates' && request && (
          <CandidateList
            request={request}
            hits={hits}
            onBack={() => setSearchView('home')}
            onSelect={(hit) => selectCandidate(hit)}
            onGeneric={chooseGeneric}
            loading={loading}
            allowImages={settings.cacheApiData}
          />
        )}

        {tab === 'search' && searchView === 'result' && result && (
          <ResultScreen
            key={result.id}
            result={result}
            decimals={settings.decimalPlaces}
            onBack={() => setSearchView(request?.resolutionMode === 'exact_product' && hits.length > 1 ? 'candidates' : 'home')}
            onNewSearch={resetSearch}
            onToggleFavorite={toggleFavorite}
            onWeightResolved={resolveWeight}
            onTotalResolved={resolveTotalAmount}
            onPortionChange={changePortion}
            onChooseProduct={showProductCandidates}
            allowImages={settings.cacheApiData}
            favoritesEnabled={settings.saveHistory}
            calibrationPersistenceEnabled={settings.saveCalibrations}
          />
        )}

        {tab === 'history' && (
          <HistoryScreen title="Verlauf" entries={historyEntries} onOpen={openStored} onDelete={removeStored} emptyText={settings.saveHistory ? 'Deine gespeicherten Berechnungen erscheinen hier.' : 'Die Verlaufsspeicherung ist deaktiviert. Du kannst sie in den Einstellungen ausdrücklich aktivieren.'} allowImages={settings.cacheApiData} />
        )}
        {tab === 'favorites' && (
          <HistoryScreen title="Favoriten" entries={favorites} onOpen={openStored} onDelete={removeStored} emptyText={settings.saveHistory ? 'Markiere ein gespeichertes Ergebnis mit dem Stern.' : 'Favoriten benötigen die ausdrücklich aktivierte Verlaufsspeicherung.'} allowImages={settings.cacheApiData} />
        )}
        {tab === 'settings' && (
          <SettingsScreen
            settings={settings}
            apiUsage={apiUsage}
            cacheStats={cacheStats}
            issue={issue}
            apiTrace={apiTrace}
            onChange={setSettings}
            onClearHistory={async () => {
              if (!window.confirm('Den gesamten lokalen Verlauf unwiderruflich löschen?')) return;
              await clearHistory().catch(() => undefined);
              await refreshHistory();
            }}
            onClearCalibrations={async () => {
              if (!window.confirm('Alle gespeicherten Stückgewichte löschen?')) return;
              await clearCalibrations().catch(() => undefined);
            }}
            onClearApiCache={async () => {
              if (!window.confirm('Gespeicherte API-Daten und Produktbilder löschen? Die Offline-App selbst bleibt erhalten.')) return;
              activeAbort.current?.abort();
              activeAbort.current = null;
              cancelPendingApiRequests();
              setLoading(false);
              await clearApiCache();
              await clearOffProductImageCache(APP_VERSION);
              clearApiGovernor();
              setApiUsage(getApiUsageSnapshot());
              setCacheStats(await getApiCacheStats());
              setApiTrace(null);
              setIssue(null);
              retryActionRef.current = null;
            }}
            onSendDiagnosticsMail={() => {
              window.location.href = diagnosticsMailtoHref(issue, apiTrace, apiUsage);
            }}
          />
        )}
        </section>
      </main>

      <nav className="bottom-nav" aria-label="Hauptnavigation">
        {[
          { id: 'search' as const, label: 'Suche', icon: Home },
          { id: 'history' as const, label: 'Verlauf', icon: Clock3 },
          { id: 'favorites' as const, label: 'Favoriten', icon: Heart },
          { id: 'settings' as const, label: 'Einstellungen', icon: Settings }
        ].map(({ id, label, icon: Icon }) => (
          <button type="button" id={`nav-${id}`} key={id} className={tab === id ? 'active' : ''} aria-current={tab === id ? 'page' : undefined} onClick={() => setTab(id)}>
            <Icon size={21} fill={id === 'favorites' && tab === id ? 'currentColor' : 'none'} />
            <span>{label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
