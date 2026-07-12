import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
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
  getSearchDocumentByBarcode,
  searchFoodCandidatesOutcome
} from './lib/api';
import type { ApiUsageSnapshot } from './lib/apiGovernor';
import {
  buildBaseFoodReferenceResult,
  buildExactResult,
  buildGenericResult,
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
  saveSettings
} from './lib/storage';
import { createPieceCalibration, deriveGroupCalibration, isCalibratableUnit } from './lib/calibration';
import type { ApiCacheStats } from './lib/storage';
import {
  displayBrand,
  displayProductName,
  formatNumber,
  normalizeText,
  unitLabels
} from './lib/format';
import './styles.css';

type Tab = 'search' | 'history' | 'favorites' | 'settings';
type SearchView = 'home' | 'candidates' | 'result';

const APP_VERSION = __APP_VERSION__;
const DEVELOPER_SUPPORT_EMAIL = 'chrisfischtopher@googlemail.com';
const MAX_SEARCH_QUERY_LENGTH = 120;
const SESSION_KEY = 'kh-checker-v2.0-session';
const RATE_LIMIT_DEFAULT_BLOCK_MS = 60 * 1000;

const DEFAULT_SETTINGS: AppSettings = {
  aiEnabled: false,
  aiParseUrl: import.meta.env.VITE_AI_PARSE_URL || '',
  decimalPlaces: 1,
  searchPageSize: 10,
  preferGermanMarket: true,
  saveHistory: true,
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
  carbsPer100g: null
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

interface UiIssue {
  title: string;
  message: string;
  technical: string;
  attempts: ApiAttemptDiagnostic[];
  occurredAt: string;
  retryLabel: string;
}

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

function productCompatibilityFallbackAttempted(meta: ApiResponseMeta | undefined): boolean {
  return meta?.originBackend === 'gateway'
    || meta?.originBackend === 'open-food-facts-v2'
    || Boolean(meta?.attempts?.some((attempt) => attempt.backend === 'open-food-facts-v2'));
}

interface EndpointValidation {
  value: string;
  error: string | null;
}

function validateHttpEndpoint(value: string): EndpointValidation {
  const clean = value.trim();
  if (!clean) return { value: '', error: null };
  try {
    const url = clean.startsWith('/')
      ? new URL(clean, window.location.origin)
      : new URL(clean);
    if (!/^https?:$/.test(url.protocol)) {
      return { value: '', error: 'Erlaubt sind nur HTTP- oder HTTPS-Endpunkte.' };
    }
    if (window.location.protocol === 'https:' && url.protocol === 'http:' && url.origin !== window.location.origin) {
      return { value: '', error: 'Eine HTTPS-App darf keinen externen HTTP-Gateway laden. Verwende HTTPS oder einen relativen Same-Origin-Pfad.' };
    }
    return { value: clean, error: null };
  } catch {
    return { value: '', error: 'Die Gateway-Adresse ist keine gültige URL.' };
  }
}

function requiredGatewayEndpoint(value: string): EndpointValidation {
  const validated = validateHttpEndpoint(value);
  if (validated.error) return validated;
  if (!validated.value) {
    return {
      value: '',
      error: 'Für diesen Release ist ein aktiver Daten-Gateway-Endpunkt erforderlich.'
    };
  }
  return validated;
}

function formatCountdown(milliseconds: number): string {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1000));
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest ? `${minutes}:${String(rest).padStart(2, '0')} min` : `${minutes} min`;
}

function latestRetryAtFromAttempts(attempts: ApiAttemptDiagnostic[], now = Date.now()): number | null {
  let latest: number | null = null;
  for (const attempt of attempts) {
    if (!Number.isFinite(attempt.retryAfterMs) || Number(attempt.retryAfterMs) <= 0) continue;
    const candidate = now + Number(attempt.retryAfterMs);
    if (latest === null || candidate > latest) latest = candidate;
  }
  return latest;
}

function isLocalAndroidViewer(): boolean {
  return ['127.0.0.1', 'localhost'].includes(window.location.hostname)
    && /\/storage\/emulated\//i.test(window.location.pathname);
}

function sanitizeSettings(value: AppSettings | null): AppSettings {
  const merged = { ...DEFAULT_SETTINGS, ...(value ?? {}) };
  const defaultGatewayUrl = DEFAULT_SETTINGS.dataGatewayUrl.trim();
  const persistedGatewayUrl = typeof merged.dataGatewayUrl === 'string'
    ? merged.dataGatewayUrl.trim()
    : '';
  // Old saved settings may still contain an empty gateway URL from releases
  // before the required gateway build variable was introduced.
  merged.dataGatewayUrl = persistedGatewayUrl || defaultGatewayUrl;
  if (!['hybrid', 'v3', 'v2'].includes(String(merged.productApiMode))) {
    merged.productApiMode = 'hybrid';
  }
  const endpoint = merged.aiParseUrl.trim();
  if (isLocalAndroidViewer()) {
    let validExternalEndpoint = false;
    try {
      const url = new URL(endpoint);
      validExternalEndpoint = /^https?:$/.test(url.protocol)
        && !['127.0.0.1', 'localhost'].includes(url.hostname);
    } catch {
      validExternalEndpoint = false;
    }
    if (!validExternalEndpoint) return { ...merged, aiEnabled: false, aiParseUrl: '' };
  }
  return merged;
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

function fallbackPortionOption(result: CalculationResult): PortionOption {
  const source = ['g', 'kg'].includes(result.unit) ? 'mass' : result.unit === 'ml' ? 'volume' : 'manual';
  return {
    id: `${result.unit}:${result.unitWeightG ?? 'variable'}:migration`,
    unit: result.unit,
    label: unitLabels[result.unit],
    weightG: result.unit === 'g' ? 1 : result.unit === 'kg' ? 1000 : result.unitWeightG,
    volumeMl: result.unit === 'ml' ? 1 : null,
    source,
    confidence: result.unitWeightG !== null || ['g', 'kg', 'ml'].includes(result.unit) ? result.confidence : 'missing',
    note: 'Aus einem älteren lokalen Eintrag übernommen.',
    recommended: true
  };
}

function normalizeStoredResult(value: CalculationResult): CalculationResult {
  const portionOptions = Array.isArray(value.portionOptions) && value.portionOptions.length
    ? value.portionOptions
    : [fallbackPortionOption(value)];
  const selectedPortionId = value.selectedPortionId && portionOptions.some((item) => item.id === value.selectedPortionId)
    ? value.selectedPortionId
    : (portionOptions.find((item) => item.recommended) ?? portionOptions[0])?.id ?? null;
  return {
    ...value,
    request: {
      ...value.request,
      amount: {
        ...value.request.amount,
        valueExplicit: value.request.amount.valueExplicit ?? true,
        unitExplicit: value.request.amount.unitExplicit ?? true
      }
    },
    portionOptions,
    selectedPortionId,
    notes: Array.isArray(value.notes) ? value.notes : [],
    candidates: Array.isArray(value.candidates) ? value.candidates : []
  };
}

function loadSession(): SessionSnapshot | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SessionSnapshot;
    return {
      ...parsed,
      result: parsed.result ? normalizeStoredResult(parsed.result) : null,
      hits: Array.isArray(parsed.hits) ? parsed.hits : [],
      manualValues: { ...DEFAULT_MANUAL, ...(parsed.manualValues ?? {}) }
    };
  } catch {
    return null;
  }
}

function saveSession(snapshot: SessionSnapshot): void {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(snapshot));
  } catch {
    // Local storage can be unavailable in private mode. The app remains usable.
  }
}

function syntheticHit(product: OffProduct): SearchHit {
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
    completeness: 1
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

function hasCarbohydrateData(hit: SearchHit): boolean {
  const nutrients = hit.nutriments ?? {};
  return [
    nutrients.carbohydrates_100g,
    nutrients.carbohydrates_100ml,
    nutrients.carbohydrates_prepared_100g,
    nutrients.carbohydrates_prepared_100ml
  ].some((value) => typeof value === 'number' && Number.isFinite(value));
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
  onRetry
}: {
  issue: UiIssue;
  onDismiss: () => void;
  onRetry: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await copyText(diagnosticsText(issue));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_600);
  };

  return (
    <section className="api-issue-banner" role="alert">
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
        : 'API-Anfrage erfolgreich und lokal gespeichert';
  const origin = backendLabel(meta.originBackend ?? meta.backend);

  return (
    <section className={`api-trace-banner ${state}`} role="status">
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
  searchBlockedRemainingMs
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
  searchBlockedRemainingMs: number;
}) {
  const searchBlocked = searchBlockedRemainingMs > 0;
  return (
    <div className="screen-content home-screen">
      <section className="hero-copy">
        <span className="eyebrow">Direkt suchen & berechnen</span>
        <h2>Welches Produkt oder Lebensmittel?</h2>
        <p>Suche reale Markenprodukte oder generische Basislebensmittel und passe die Portion direkt im Ergebnis an.</p>
      </section>

      <div className="mode-switch" role="tablist" aria-label="Eingabemodus">
        <button type="button" role="tab" aria-selected={!manualMode} className={!manualMode ? 'active' : ''} onClick={() => setManualMode(false)}>
          <Search size={17} /> Suche
        </button>
        <button type="button" role="tab" aria-selected={manualMode} className={manualMode ? 'active' : ''} onClick={() => setManualMode(true)}>
          <Calculator size={17} /> Manuell
        </button>
      </div>

      {!manualMode ? (
        <section className="search-panel card">
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
                disabled={searchBlocked}
              >
                <Mic size={21} />
                {listening ? 'Ich höre zu …' : 'Sprechen'}
              </button>
              <button type="submit" className="primary-button" disabled={!query.trim() || searchBlocked}>
                {loading ? <LoaderCircle className="spin" size={20} /> : <Search size={20} />}
                {searchBlocked
                  ? `Warte ${formatCountdown(searchBlockedRemainingMs)}`
                  : loading
                    ? 'Suche neu starten'
                    : 'Suchen'}
              </button>
            </div>
            <p className="request-policy-note">
              Cache zuerst. Bei Retry-After/Rate-Limit pausiert die App neue Netzwerksuchen kurz und zeigt den verbleibenden Zeitraum an.
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
          searchBlockedRemainingMs={searchBlockedRemainingMs}
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
  loading,
  searchBlockedRemainingMs
}: {
  values: ManualFormValues;
  onChange: (values: ManualFormValues) => void;
  onSubmit: () => void;
  loading: boolean;
  searchBlockedRemainingMs: number;
}) {
  const patch = (next: Partial<ManualFormValues>) => onChange({ ...values, ...next });
  const searchBlocked = searchBlockedRemainingMs > 0;

  return (
    <form
      className="manual-form card"
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
          <input type="number" min="0.01" step="0.01" value={values.amount} onChange={(event) => patch({ amount: Number(event.target.value) })} required aria-label="Menge" />
          <select value={values.unit} onChange={(event) => patch({ unit: event.target.value as FoodUnit })} aria-label="Einheit">
            {UNIT_OPTIONS.map((unit) => <option key={unit.value} value={unit.value}>{unit.label}</option>)}
          </select>
        </div>
      </label>

      <details className="advanced-fields">
        <summary>Optionale genaue Angaben <ChevronDown size={17} /></summary>
        <div className="field-grid two-columns">
          <label>
            <span>Barcode</span>
            <input inputMode="numeric" value={values.barcode} onChange={(event) => patch({ barcode: event.target.value.replace(/\D/g, '') })} placeholder="8–14 Ziffern" aria-label="Barcode" />
          </label>
          <label>
            <span>KH pro 100 g</span>
            <input type="number" min="0" max="100" step="0.1" value={values.carbsPer100g ?? ''} onChange={(event) => patch({ carbsPer100g: event.target.value ? Number(event.target.value) : null })} placeholder="vom Etikett" aria-label="Kohlenhydrate pro 100 Gramm" />
          </label>
          {!['g', 'kg', 'ml'].includes(values.unit) && (
            <label>
              <span>Gewicht für 1 {unitLabels[values.unit]} (g)</span>
              <input type="number" min="0" step="0.01" value={values.unitWeightG ?? ''} onChange={(event) => patch({ unitWeightG: event.target.value ? Number(event.target.value) : null })} placeholder="z. B. 21,5" aria-label="Gewicht einer Einheit in Gramm" />
            </label>
          )}
        </div>
      </details>

      <button type="submit" className="primary-button full-width" disabled={!values.productName.trim() || searchBlocked}>
        {loading ? <LoaderCircle className="spin" size={20} /> : <Calculator size={20} />}
        {searchBlocked
          ? `Warte ${formatCountdown(searchBlockedRemainingMs)}`
          : loading
            ? 'Berechnung neu starten'
            : 'Berechnen'}
      </button>
    </form>
  );
}

function CandidateList({
  request,
  hits,
  onBack,
  onSelect,
  onGeneric,
  loading
}: {
  request: ParsedFoodRequest;
  hits: SearchHit[];
  onBack: () => void;
  onSelect: (hit: SearchHit) => void;
  onGeneric: () => void;
  loading: boolean;
}) {
  return (
    <div className="screen-content">
      <div className="subheader">
        <button type="button" className="icon-button" onClick={onBack}><ArrowLeft size={21} /></button>
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
          <button type="button" className="candidate-card card" key={hit.code ?? `${normalizeText(displayProductName(hit))}-${normalizeText(displayBrand(hit.brands) ?? '')}-${hit.quantity ?? ''}`} onClick={() => onSelect(hit)} disabled={loading}>
            <div className="candidate-image">
              {hit.image_front_url ? <img src={hit.image_front_url} alt="" loading="lazy" /> : <Package size={28} />}
            </div>
            <div className="candidate-copy">
              <strong>{displayProductName(hit)}</strong>
              <span>{displayBrand(hit.brands) ?? 'Marke unbekannt'} · {hit.quantity ?? 'Menge unbekannt'}</span>
              <small>{formatNumber(hit.nutriments?.carbohydrates_100g ?? null, 1)} g KH / 100 g</small>
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
  onChooseProduct
}: {
  result: CalculationResult;
  decimals: number;
  onBack: () => void;
  onNewSearch: () => void;
  onToggleFavorite: () => void;
  onWeightResolved: (measurement: WeightMeasurement) => void;
  onTotalResolved: (value: number, reuseScope?: WeightMeasurement['reuseScope']) => void;
  onPortionChange: (amount: number, portionId: string) => void;
  onChooseProduct: () => void;
}) {
  const hasUnitEditor = supportsUnitWeight(result.unit);
  const canPersistUnitCalibration = isCalibratableUnit(result.unit);
  const supportsGroupWeighing = result.countability === 'countable' && isCountedFoodUnit(result.unit);
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

  useEffect(() => {
    const nextHasUnitEditor = supportsUnitWeight(result.unit);
    setAmountValue(String(result.amount));
    setWeightMode(result.status === 'needs_unit_calibration' && nextHasUnitEditor ? 'single' : 'total');
    setTotalValue(inputNumber(result.basis === '100g' ? result.totalMassG : result.totalVolumeMl));
    setWeightValue(inputNumber(result.unitWeightG));
    setMeasuredCountValue(Number.isInteger(result.amount) && result.amount > 1 && result.amount <= 100 ? String(result.amount) : '10');
    setMeasuredTotalValue('');
    setReuseGeneric(false);
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

  const submitAmount = () => {
    if (selectedPortion && Number.isFinite(parsedAmount) && parsedAmount > 0 && parsedAmount !== result.amount) {
      onPortionChange(parsedAmount, selectedPortion.id);
    }
  };

  return (
    <div className="screen-content result-screen">
      <div className="subheader result-subheader">
        <button type="button" className="icon-button" onClick={onBack}><ArrowLeft size={21} /></button>
        <div>
          <h2>Ergebnis</h2>
          <p>{result.request.rawInput}</p>
        </div>
        <button type="button" className={`icon-button favorite-button ${result.favorite ? 'active' : ''}`} onClick={onToggleFavorite} aria-label="Favorit umschalten">
          <Star size={21} fill={result.favorite ? 'currentColor' : 'none'} />
        </button>
      </div>

      <section className="result-hero card">
        <div className="product-visual">
          {result.product.imageUrl ? (
            <img src={result.product.imageUrl} alt={result.product.name} />
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
                onPortionChange(amount, event.target.value);
              }}
              aria-label="Berechnungseinheit"
            >
              {result.portionOptions.map((option) => (
                <option key={option.id} value={option.id}>{portionOptionText(option)}</option>
              ))}
            </select>
          </div>
        </label>

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

            {hasUnitEditor && (
              <div className={`weight-mode-switch ${supportsGroupWeighing ? 'three-options' : 'two-options'}`} role="tablist" aria-label="Messmethode">
                <button type="button" role="tab" aria-selected={weightMode === 'total'} className={weightMode === 'total' ? 'active' : ''} onClick={() => setWeightMode('total')}>
                  Gesamt
                </button>
                <button type="button" role="tab" aria-selected={weightMode === 'single'} className={weightMode === 'single' ? 'active' : ''} onClick={() => setWeightMode('single')}>
                  Eine Einheit
                </button>
                {supportsGroupWeighing && (
                  <button type="button" role="tab" aria-selected={weightMode === 'group'} className={weightMode === 'group' ? 'active' : ''} onClick={() => setWeightMode('group')}>
                    Mehrere wiegen
                  </button>
                )}
              </div>
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
                  disabled={!Number.isFinite(parsedTotal) || parsedTotal <= 0}
                  onClick={() => onTotalResolved(parsedTotal, reuseGeneric ? 'generic' : 'product')}
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
                  disabled={!Number.isFinite(parsedWeight) || parsedWeight <= 0}
                  onClick={() => onWeightResolved({
                    unitWeightG: parsedWeight,
                    measuredPieces: 1,
                    measuredTotalWeightG: parsedWeight,
                    reuseScope: reuseGeneric ? 'generic' : 'product'
                  })}
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
                      onWeightResolved({
                        unitWeightG: derivedGroupWeight,
                        measuredPieces: parsedMeasuredCount,
                        measuredTotalWeightG: parsedMeasuredTotal,
                        reuseScope: reuseGeneric ? 'generic' : 'product'
                      });
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

      {result.candidates.length > 1 && (
        <details className="technical-card card">
          <summary><Gauge size={18} /> Verwendete Produkte / DTO <ChevronDown size={18} /></summary>
          <div className="technical-list">
            {result.candidates.map((candidate) => (
              <div key={candidate.code ?? displayProductName(candidate)}>
                <span>{displayProductName(candidate)}</span>
                <strong>{formatNumber(candidate.nutriments?.carbohydrates_100g ?? candidate.nutriments?.carbohydrates_prepared_100g ?? null, 1)} g / 100 g</strong>
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
  emptyText
}: {
  title: string;
  entries: CalculationResult[];
  onOpen: (result: CalculationResult) => void;
  onDelete: (id: string) => void;
  emptyText: string;
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
                  {entry.product.imageUrl ? <img src={entry.product.imageUrl} alt="" loading="lazy" /> : <Package size={24} />}
                </div>
                <div>
                  <strong>{entry.product.name}</strong>
                  <span>{formatNumber(entry.amount, 2)} {unitLabels[entry.unit]} · {new Date(entry.createdAt).toLocaleDateString('de-DE')}</span>
                </div>
                <b>{entry.carbohydratesG !== null ? `${formatNumber(entry.carbohydratesG, 1)} g` : 'offen'}</b>
              </button>
              <button type="button" className="delete-button" onClick={() => onDelete(entry.id)} aria-label="Eintrag löschen"><Trash2 size={17} /></button>
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
  const gatewayValidation = requiredGatewayEndpoint(settings.dataGatewayUrl);
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
        <p>Alle API-Aufrufe laufen ausschließlich über den konfigurierten Serverless-Gateway; Berechnung und Cache bleiben lokal.</p>
      </section>

      <section className="settings-card card">
        <div className="setting-title"><Sparkles size={20} /><div><strong>Optionaler KI-Parser</strong><span>Nur Sprach-/Textstrukturierung; keine Nährwertschätzung</span></div></div>
        <label className="toggle-row"><span>OpenAI-Parsing verwenden</span><input type="checkbox" checked={settings.aiEnabled} onChange={(event) => patch({ aiEnabled: event.target.checked })} /></label>
        {settings.aiEnabled && (
          <label>
            <span>Eigener Parser-Endpunkt</span>
            <input value={settings.aiParseUrl} onChange={(event) => patch({ aiParseUrl: event.target.value })} placeholder="https://…/api/parse-food-request" />
          </label>
        )}
        <p className="setting-note">Ein OpenAI-Schlüssel gehört niemals in die statische App. Ohne Endpunkt bleibt der lokale Parser aktiv.</p>
      </section>

      <section className="settings-card card">
        <div className="setting-title"><Gauge size={20} /><div><strong>Suche & Darstellung</strong><span>Search-a-licious-first, lokale Berechnung</span></div></div>
        <label className="toggle-row"><span>Deutschen Markt bevorzugen</span><input type="checkbox" checked={settings.preferGermanMarket} onChange={(event) => patch({ preferGermanMarket: event.target.checked })} /></label>
        <label>
          <span>Produktdaten-API</span>
          <select value={settings.productApiMode} onChange={(event) => patch({ productApiMode: event.target.value as ProductApiMode })}>
            <option value="hybrid">Hybrid (v3.6 primär, v2 nur bei fehlenden Feldern)</option>
            <option value="v3">Nur OFF API v3.6</option>
            <option value="v2">Nur OFF API v2</option>
          </select>
        </label>
        <p className="setting-note">
          Hybrid reduziert Last und bleibt kompatibel: v2 wird nur nachgezogen, wenn v3 für die Berechnung relevante Produktfelder nicht liefert.
        </p>
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
      </section>

      <section className="settings-card card">
        <div className="setting-title"><ShieldCheck size={20} /><div><strong>API-Diagnose & Zwischenspeicher</strong><span>Gateway-only, cache-first, deduplizierte GET-Anfragen</span></div></div>
        <label>
          <span>Vercel-Daten-Gateway (erforderlich)</span>
          <input
            inputMode="url"
            value={settings.dataGatewayUrl}
            onChange={(event) => patch({ dataGatewayUrl: event.target.value })}
            placeholder="https://dein-gateway.vercel.app"
            maxLength={300}
            aria-invalid={Boolean(gatewayValidation.error)}
            aria-describedby="gateway-help"
          />
        </label>
        {gatewayValidation.error && <p className="setting-note setting-warning" role="alert">{gatewayValidation.error} Der ungültige Wert wird nicht verwendet.</p>}
        <p className="setting-note" id="gateway-help">
          Ohne gültigen Gateway wird keine Netzwerk-Suche gestartet. Der Gateway muss die Endpunkte /api/search und /api/product/:code bereitstellen und die OFF-Header serverseitig setzen (z. B. Vercel, Cloud Run oder eigene Serverless-Umgebung).
        </p>
        <div className="api-budget-grid">
          <div>
            <span>Reale Produktsuchen / Minute</span>
            <strong>{apiUsage.search.used} / {apiUsage.search.limit}</strong>
            <small>{apiUsage.search.retryAfterMs > 0 ? `Server-Hinweis: ${formatCountdown(apiUsage.search.retryAfterMs)}` : `${apiUsage.search.remaining} bis zum Richtwert`}</small>
          </div>
          <div>
            <span>Produktdetails / Minute</span>
            <strong>{apiUsage.product.used} / {apiUsage.product.limit}</strong>
            <small>{apiUsage.product.retryAfterMs > 0 ? `Server-Hinweis: ${formatCountdown(apiUsage.product.retryAfterMs)}` : `${apiUsage.product.remaining} bis zum Richtwert`}</small>
          </div>
        </div>
        <div className="cache-stats-row">
          <span><Database size={16} /> {cacheStats.entries} Cache-Einträge</span>
          <span>{cacheStats.freshEntries} frisch · {cacheStats.staleEntries} Reserve</span>
          <span>ca. {formatBytes(cacheStats.approximateBytes)}</span>
          <span>{cacheStats.persistence === 'indexeddb' ? 'IndexedDB' : cacheStats.persistence === 'localstorage' ? 'localStorage-Fallback' : 'Arbeitsspeicher'}</span>
        </div>
        <p className="setting-note">
          Gleiche und typografisch gleichwertige Suchbegriffe werden über einen backend-unabhängigen Schlüssel wiederverwendet. Treffer bleiben 24 Stunden frisch und bis zu 30 Tage als Ausfallreserve; Produktdetails 30 beziehungsweise 180 Tage. Retry-After wird als temporäre Suchpause übernommen.
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
        <div><strong>KH Checker v{APP_VERSION}</strong><p>Pages-first-PWA mit direkter OFF-Suche, Search-a-licious als Primärweg, genau einem Legacy-Fallback, sofortigem Retry und deterministischer Portionsberechnung.</p></div>
      </section>
    </div>
  );
}

const initialSession = loadSession();

export default function App() {
  const [tab, setTab] = useState<Tab>(initialSession?.tab ?? 'search');
  const [searchView, setSearchView] = useState<SearchView>(initialSession?.searchView ?? 'home');
  const [query, setQuery] = useState(initialSession?.query ?? '');
  const [manualMode, setManualMode] = useState(initialSession?.manualMode ?? false);
  const [manualValues, setManualValues] = useState<ManualFormValues>(initialSession?.manualValues ?? DEFAULT_MANUAL);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [settingsReady, setSettingsReady] = useState(false);
  const [request, setRequest] = useState<ParsedFoodRequest | null>(initialSession?.request ?? null);
  const [hits, setHits] = useState<SearchHit[]>(initialSession?.hits ?? []);
  const [result, setResult] = useState<CalculationResult | null>(initialSession?.result ?? null);
  const [historyEntries, setHistoryEntries] = useState<CalculationResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [listening, setListening] = useState(false);
  const [issue, setIssue] = useState<UiIssue | null>(null);
  const [apiTrace, setApiTrace] = useState<ApiTraceNotice | null>(null);
  const [apiUsage, setApiUsage] = useState<ApiUsageSnapshot>(() => getApiUsageSnapshot());
  const [cacheStats, setCacheStats] = useState<ApiCacheStats>({
    entries: 0,
    freshEntries: 0,
    staleEntries: 0,
    approximateBytes: 0,
    persistence: 'memory'
  });
  const [searchBlockedUntil, setSearchBlockedUntil] = useState(0);
  const [searchClock, setSearchClock] = useState(() => Date.now());
  const retryActionRef = useRef<(() => void) | null>(null);
  const activeAbort = useRef<AbortController | null>(null);
  const snapshotRef = useRef<SessionSnapshot>({
    tab, searchView, query, manualMode, manualValues, request, hits, result
  });

  snapshotRef.current = { tab, searchView, query, manualMode, manualValues, request, hits, result };

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [storedSettings, storedHistory] = await Promise.allSettled([
        loadSettings(),
        getHistory()
      ]);
      await pruneApiCache().catch(() => undefined);
      if (cancelled) return;
      if (storedSettings.status === 'fulfilled') setSettings(sanitizeSettings(storedSettings.value));
      if (storedHistory.status === 'fulfilled') setHistoryEntries(storedHistory.value.map(normalizeStoredResult));
      setApiUsage(getApiUsageSnapshot());
      setCacheStats(await getApiCacheStats().catch(() => ({
        entries: 0,
        freshEntries: 0,
        staleEntries: 0,
        approximateBytes: 0,
        persistence: 'memory' as const
      })));
      setSettingsReady(true);
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!settingsReady) return;
    saveSettings(settings).catch(() => undefined);
  }, [settings, settingsReady]);

  useEffect(() => {
    if (searchBlockedUntil <= Date.now()) {
      setSearchClock(Date.now());
      return;
    }
    const intervalId = window.setInterval(() => {
      const now = Date.now();
      setSearchClock(now);
      if (now >= searchBlockedUntil) {
        window.clearInterval(intervalId);
      }
    }, 1_000);
    return () => window.clearInterval(intervalId);
  }, [searchBlockedUntil]);

  useEffect(() => {
    saveSession({ tab, searchView, query, manualMode, manualValues, request, hits, result });
  }, [tab, searchView, query, manualMode, manualValues, request, hits, result]);

  useEffect(() => {
    const persist = () => saveSession(snapshotRef.current);
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') persist();
    };
    const onPageHide = () => persist();
    const onOnline = () => { setApiUsage(getApiUsageSnapshot()); };

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('online', onOnline);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('online', onOnline);
      activeAbort.current?.abort();
      activeAbort.current = null;
    };
  }, []);

  const favorites = useMemo(() => historyEntries.filter((entry) => entry.favorite), [historyEntries]);

  async function refreshHistory() {
    setHistoryEntries((await getHistory()).map(normalizeStoredResult));
  }

  async function commitResult(next: CalculationResult) {
    const normalized = normalizeStoredResult(next);
    setResult(normalized);
    setSearchView('result');
    if (settings.saveHistory) {
      await saveResult(normalized);
      await refreshHistory();
    }
  }

  async function updateCurrentResult(next: CalculationResult) {
    const stable = result
      ? { ...normalizeStoredResult(next), id: result.id, createdAt: result.createdAt, favorite: result.favorite }
      : normalizeStoredResult(next);
    setResult(stable);
    if (settings.saveHistory) {
      await saveResult(stable);
      await refreshHistory();
    }
  }

  async function parseInput(input: string, controller: AbortController): Promise<ParsedFoodRequest> {
    const safeSettings = sanitizeSettings(settings);
    if (safeSettings.aiEnabled && safeSettings.aiParseUrl.trim()) {
      try {
        const parsed = await parseFoodRequestWithAi(input, safeSettings.aiParseUrl, controller.signal);
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
    const validation = requiredGatewayEndpoint(settings.dataGatewayUrl);
    if (validation.error || !validation.value) {
      throw new DataSourceError(
        validation.error || 'Kein Daten-Gateway konfiguriert.',
        'http',
        { status: 503 }
      );
    }
    return validation.value;
  }

  function configuredProductApiMode(): ProductApiMode {
    const candidate = settings.productApiMode;
    if (candidate === 'v2' || candidate === 'v3' || candidate === 'hybrid') return candidate;
    return 'hybrid';
  }

  function observeApiMeta(responseMeta: ApiResponseMeta | undefined, label: string): void {
    refreshApiUsage();
    if (!responseMeta) return;
    setIssue(null);
    setApiTrace((previous) => appendApiTrace(previous, label, responseMeta));
  }

  function observeRecoveredError(caught: unknown, label: string): void {
    if (!(caught instanceof DataSourceError) || caught.kind === 'aborted') return;
    const lastAttempt = caught.attempts.at(-1);
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
      if (caught.kind === 'rate-limit' || caught.status === 429 || caught.status === 503) {
        const now = Date.now();
        const computedRetryAt = caught.retryAt
          ?? latestRetryAtFromAttempts(caught.attempts, now)
          ?? now + RATE_LIMIT_DEFAULT_BLOCK_MS;
        if (computedRetryAt > now) {
          setSearchBlockedUntil((previous) => Math.max(previous, computedRetryAt));
        }
      }
      const attempts = caught.attempts;
      const failedAttempts = attempts.filter((attempt) => !['success', 'cache-hit'].includes(attempt.outcome));
      const failedAttempt = [...failedAttempts].reverse().find((attempt) => attempt.backend !== 'gateway')
        ?? failedAttempts.at(-1);
      const technical = failedAttempt
        ? attemptTechnicalText(failedAttempt)
        : `${caught.name}: ${caught.message}`;
      const failedBackends = new Set(failedAttempts.map((attempt) => attempt.backend));
      const bothPublicSearchBackendsFailed = failedBackends.has('open-food-facts-legacy')
        && failedBackends.has('search-a-licious')
        && !failedBackends.has('gateway');
      const title: Record<DataSourceError['kind'], string> = {
        aborted: 'Anfrage abgebrochen',
        timeout: 'API-Zeitüberschreitung',
        network: 'Netzwerk- oder CORS-Fehler',
        parse: 'Ungültige API-Antwort',
        http: `API-Fehler${caught.status ? ` HTTP ${caught.status}` : ''}`,
        'rate-limit': `API-Hinweis${caught.status ? ` HTTP ${caught.status}` : ''}`
      };
      const message: Record<DataSourceError['kind'], string> = {
        aborted: '',
        timeout: 'Die Datenquelle hat innerhalb des sicheren Zeitlimits nicht geantwortet. Die Suche bleibt entsperrt und kann sofort neu gestartet werden.',
        network: 'Der Browser konnte den API-Endpunkt nicht erreichen oder dessen Antwort wegen CORS nicht lesen. Unten steht der originale technische Fehler.',
        parse: 'Der Endpunkt war erreichbar, lieferte aber kein lesbares JSON. Der Antwortanfang wird unten angezeigt.',
        http: caught.status === 404
          ? 'Der Endpunkt meldet, dass kein Datensatz vorhanden ist.'
          : 'Der Server hat die Anfrage mit einem HTTP-Fehler abgelehnt. Der Status und die Antwort stehen unten.',
        'rate-limit': 'Der Server meldet ein Limit oder eine Überlastung. Die App übernimmt Retry-After und pausiert neue Netzwerksuchen für die empfohlene Wartezeit.'
      };
      setIssue({
        title: bothPublicSearchBackendsFailed ? 'Öffentliche Produktsuche vorübergehend nicht erreichbar' : title[caught.kind],
        message: bothPublicSearchBackendsFailed
          ? 'Search-a-licious und die OFF-Legacy-Suche waren bei diesem Versuch beide nicht erreichbar. Bereits gespeicherte Treffer bleiben verfügbar; neue Netzwerksuchen werden kurz gemäß Retry-After pausiert.'
          : message[caught.kind],
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
    let compatibilityFallbackAttempted = false;
    const calibration = await findCalibration({
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
          seedProduct: productSeedFromSearchHit(candidate)
        });
        ensureControllerActive(controller);
        compatibilityFallbackAttempted = productCompatibilityFallbackAttempted(response.api_meta);
        observeApiMeta(response.api_meta, 'Produktdetails');
        product = response.product;
        if (product) candidate = mergeSearchHit(candidate, syntheticHit(product));
        next = buildExactResult(parsed, candidate, product, calibration, manualUnitWeight);
      } catch (caught) {
        ensureControllerActive(controller);
        if (caught instanceof DataSourceError && caught.kind === 'aborted') throw caught;
        observeRecoveredError(caught, 'Produktdetails fehlgeschlagen – Suchtreffer weiterverwendet');
        // The search DTO remains a valid deterministic fallback.
      }
    }

    // OFF v3 can omit nutriments. Use exactly one compact v2 fallback for the
    // already selected barcode; never fetch the large unfiltered document.
    if (!hasCarbohydrateData(candidate) && candidate.code && !compatibilityFallbackAttempted) {
      try {
        const fallbackHit = await getSearchDocumentByBarcode(candidate.code, controller.signal, {
          gatewayUrl: configuredGatewayUrl(),
          productApiMode: configuredProductApiMode()
        });
        ensureControllerActive(controller);
        observeApiMeta(fallbackHit.api_meta, 'Produkt-Fallback');
        candidate = mergeSearchHit(candidate, fallbackHit);
        next = buildExactResult(parsed, candidate, product, calibration, manualUnitWeight);
      } catch (caught) {
        ensureControllerActive(controller);
        if (caught instanceof DataSourceError && caught.kind === 'aborted') throw caught;
        observeRecoveredError(caught, 'Produkt-Fallback fehlgeschlagen');
      }
    }

    ensureControllerActive(controller);
    return { candidate, product, result: next };
  }

  async function executeSearch(input: string, forcedRequest?: ParsedFoodRequest, manualUnitWeight?: number | null) {
    if (Date.now() < searchBlockedUntil) {
      handleOperationError(
        new DataSourceError('Suche ist wegen aktivem Retry-After kurz pausiert.', 'rate-limit', {
          status: 429,
          retryAt: searchBlockedUntil,
          attempts: []
        }),
        'Die Suche ist vorübergehend pausiert.',
        'Nach Wartezeit erneut suchen',
        () => { void executeSearch(input, forcedRequest, manualUnitWeight); }
      );
      return;
    }
    activeAbort.current?.abort();
    const controller = new AbortController();
    activeAbort.current = controller;
    setLoading(true);
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
        const productResponse = await getProductByBarcode(parsed.barcode, controller.signal, {
          gatewayUrl: configuredGatewayUrl(),
          productApiMode: configuredProductApiMode()
        });
        ensureControllerActive(controller);
        observeApiMeta(productResponse.api_meta, 'Barcode-Produkt');
        if (!productResponse.product) throw new Error('Zu diesem Barcode wurde kein Produkt gefunden.');
        let hit = syntheticHit(productResponse.product);
        if (!hasCarbohydrateData(hit) && !productCompatibilityFallbackAttempted(productResponse.api_meta)) {
          try {
            const fallbackHit = await getSearchDocumentByBarcode(parsed.barcode, controller.signal, {
              gatewayUrl: configuredGatewayUrl(),
              productApiMode: configuredProductApiMode()
            });
            ensureControllerActive(controller);
            observeApiMeta(fallbackHit.api_meta, 'Barcode-Fallback');
            hit = mergeSearchHit(hit, fallbackHit);
          } catch (caught) {
            ensureControllerActive(controller);
            if (caught instanceof DataSourceError && caught.kind === 'aborted') throw caught;
            observeRecoveredError(caught, 'Barcode-Fallback fehlgeschlagen');
          }
        }
        const calibration = await findCalibration({
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
        setHits([]);
        const calibration = await findCalibration({
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
          productOnly: parsed.product.name
        }
      );
      ensureControllerActive(controller);
      const searchResponse = requireSearchResponse(searchOutcome);
      observeApiMeta(searchResponse.api_meta, 'Produktsuche');

      if (!searchResponse.hits.length) {
        throw new Error('Keine passenden Produkte gefunden. Prüfe die Schreibweise oder ergänze Marke beziehungsweise Produkttyp.');
      }

      const ranked = rankExactCandidates(parsed.product.name, searchResponse.hits, settings.preferGermanMarket);
      const orderedHits = ranked.length ? ranked : searchResponse.hits;

      if (
        parsed.resolutionMode === 'generic_category'
        && !isGenericCategoryQuery(parsed.product.name)
        && shouldResolveAsExactProduct(parsed.product.name, orderedHits)
      ) {
        parsed = { ...parsed, resolutionMode: 'exact_product' };
        setRequest(parsed);
      }

      if (parsed.resolutionMode === 'generic_category') {
        const generic = resolveGenericCandidates(parsed.product.name, searchResponse.hits, settings.preferGermanMarket);
        const genericHits = generic.hits.length ? generic.hits : orderedHits;
        const visibleHits = orderedHits.filter((candidate) => sameProductFamily(parsed.product.name, candidate));
        const candidateHits = visibleHits.length ? visibleHits : genericHits;
        setHits(candidateHits);

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
          setSearchView('candidates');
          return;
        }

        const calibration = await findCalibration({
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

      setHits(orderedHits);
      const candidates = orderedHits
        .filter((candidate) => sameProductFamily(parsed.product.name, candidate))
        .slice(0, 12);
      if (!candidates.length) {
        setSearchView('candidates');
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
        setSearchView('candidates');
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
    const genericRequest: ParsedFoodRequest = { ...request, resolutionMode: 'generic_category' };
    const calibration = await findCalibration({
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
    const generic = resolveGenericCandidates(genericRequest.product.name, hits, settings.preferGermanMarket);
    await commitResult(buildGenericResult(genericRequest, generic, calibration));
  }

  async function showProductCandidates() {
    if (!request) return;
    if (hits.length) {
      setSearchView('candidates');
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
          productOnly: request.product.name
        }
      );
      ensureControllerActive(controller);
      const response = requireSearchResponse(outcome);
      observeApiMeta(response.api_meta, 'Produktauswahl');
      const ranked = rankExactCandidates(request.product.name, response.hits, settings.preferGermanMarket);
      const nextHits = ranked.length ? ranked : response.hits;
      if (!nextHits.length) throw new Error('Keine konkreten Produkte zu dieser Basisanfrage gefunden.');
      setHits(nextHits);
      setSearchView('candidates');
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
    if (manualValues.carbsPer100g !== null) {
      await commitResult(buildManualResult(manualValues));
      return;
    }

    const forcedRequest: ParsedFoodRequest = {
      status: 'parsed',
      rawInput: `${manualValues.amount} ${unitLabels[manualValues.unit]} ${manualValues.brand} ${manualValues.productName}`.replace(/\s+/g, ' ').trim(),
      product: { name: manualValues.productName, brand: manualValues.brand || null, variant: null },
      amount: { value: manualValues.amount, unit: manualValues.unit, valueExplicit: true, unitExplicit: true },
      resolutionMode: manualValues.barcode ? 'barcode' : manualValues.brand ? 'exact_product' : 'generic_category',
      barcode: manualValues.barcode || null,
      clarificationQuestion: null,
      parser: 'local'
    };
    await executeSearch(forcedRequest.rawInput, forcedRequest, manualValues.unitWeightG);
  }

  function startVoice() {
    const Constructor = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!Constructor) {
      setIssue({
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
    setListening(true);
    recognition.start();
  }

  async function resolveWeight(measurement: WeightMeasurement) {
    const { unitWeightG, measuredPieces, measuredTotalWeightG, reuseScope } = measurement;
    if (!result || !Number.isFinite(unitWeightG) || unitWeightG <= 0) return;

    const measuredCount = Number.isInteger(measuredPieces) && (measuredPieces ?? 0) >= 1
      ? Number(measuredPieces)
      : 1;
    const totalWeight = measuredTotalWeightG !== null
      && Number.isFinite(measuredTotalWeightG)
      && measuredTotalWeightG > 0
      ? measuredTotalWeightG
      : unitWeightG * measuredCount;
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
    if (calibration) await saveCalibration(calibration);
    await updateCurrentResult(recalculateResult(result, result.amount, unitWeightG));
  }

  async function resolveTotalAmount(value: number, reuseScope: WeightMeasurement['reuseScope'] = 'product') {
    if (!result || !Number.isFinite(value) || value <= 0) return;

    if (result.basis === '100ml') {
      await updateCurrentResult(recalculateWithManualTotalVolume(result, value));
      return;
    }

    const next = recalculateWithManualTotalMass(result, value);
    if (supportsUnitWeight(result.unit) && Number.isInteger(result.amount) && result.amount >= 1) {
      const calibration = createPieceCalibration({
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
      if (calibration) await saveCalibration(calibration);
    }
    await updateCurrentResult(next);
  }

  async function toggleFavorite() {
    if (!result) return;
    const next = { ...result, favorite: !result.favorite };
    setResult(next);
    await saveResult(next);
    await refreshHistory();
  }

  async function changePortion(amount: number, portionId: string) {
    if (!result || amount <= 0) return;
    await updateCurrentResult(recalculateWithPortion(result, amount, portionId));
  }

  function resetSearch() {
    activeAbort.current?.abort();
    activeAbort.current = null;
    setLoading(false);
    setSearchView('home');
    setRequest(null);
    setHits([]);
    setResult(null);
    setIssue(null);
    setApiTrace(null);
    retryActionRef.current = null;
    setQuery('');
    setManualValues(DEFAULT_MANUAL);
  }

  function openStored(entry: CalculationResult) {
    const normalized = normalizeStoredResult(entry);
    setTab('search');
    setResult(normalized);
    setRequest(normalized.request);
    setHits(normalized.candidates);
    setSearchView('result');
  }

  async function removeStored(id: string) {
    await deleteResult(id);
    await refreshHistory();
  }

  return (
    <div className="app-shell">
      <main className="app-main">
        {tab === 'search' && <SearchHeader onHistory={() => setTab('history')} />}

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
            searchBlockedRemainingMs={Math.max(0, searchBlockedUntil - searchClock)}
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
          />
        )}

        {tab === 'search' && searchView === 'result' && result && (
          <ResultScreen
            result={result}
            decimals={settings.decimalPlaces}
            onBack={() => setSearchView(request?.resolutionMode === 'exact_product' && hits.length > 1 ? 'candidates' : 'home')}
            onNewSearch={resetSearch}
            onToggleFavorite={toggleFavorite}
            onWeightResolved={resolveWeight}
            onTotalResolved={resolveTotalAmount}
            onPortionChange={changePortion}
            onChooseProduct={showProductCandidates}
          />
        )}

        {tab === 'history' && (
          <HistoryScreen title="Verlauf" entries={historyEntries} onOpen={openStored} onDelete={removeStored} emptyText="Deine Berechnungen erscheinen hier automatisch." />
        )}
        {tab === 'favorites' && (
          <HistoryScreen title="Favoriten" entries={favorites} onOpen={openStored} onDelete={removeStored} emptyText="Markiere ein Ergebnis mit dem Stern." />
        )}
        {tab === 'settings' && (
          <SettingsScreen
            settings={settings}
            apiUsage={apiUsage}
            cacheStats={cacheStats}
            issue={issue}
            apiTrace={apiTrace}
            onChange={setSettings}
            onClearHistory={async () => { await clearHistory(); await refreshHistory(); }}
            onClearCalibrations={async () => { await clearCalibrations(); }}
            onClearApiCache={async () => {
              activeAbort.current?.abort();
              activeAbort.current = null;
              cancelPendingApiRequests();
              setLoading(false);
              await clearApiCache();
              if ('caches' in window) {
                const names = await caches.keys();
                const ownedCaches = names.filter((name) =>
                  name.startsWith('kh-v2')
                  || name.includes('kh-checker')
                  || name.startsWith('workbox-precache')
                );
                await Promise.all(ownedCaches.map((name) => caches.delete(name)));
              }
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
      </main>

      <nav className="bottom-nav" aria-label="Hauptnavigation">
        {[
          { id: 'search' as const, label: 'Suche', icon: Home },
          { id: 'history' as const, label: 'Verlauf', icon: Clock3 },
          { id: 'favorites' as const, label: 'Favoriten', icon: Heart },
          { id: 'settings' as const, label: 'Einstellungen', icon: Settings }
        ].map(({ id, label, icon: Icon }) => (
          <button type="button" key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>
            <Icon size={21} fill={id === 'favorites' && tab === id ? 'currentColor' : 'none'} />
            <span>{label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
