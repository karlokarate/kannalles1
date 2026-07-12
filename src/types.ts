export type FoodUnit =
  | 'g'
  | 'kg'
  | 'ml'
  | 'piece'
  | 'bar'
  | 'slice'
  | 'portion'
  | 'package';

export type ParseStatus = 'parsed' | 'needs_clarification' | 'unsupported';
export type ResolutionMode = 'generic_category' | 'exact_product' | 'barcode';
export type Confidence = 'high' | 'medium' | 'low' | 'missing';
export type Countability = 'countable' | 'non_countable' | 'unknown';
export type SearchOutcomeStatus =
  | 'resolved'
  | 'needs_product_choice'
  | 'needs_unit_calibration'
  | 'not_found'
  | 'temporarily_unavailable';

export type ApiBackend =
  | 'gateway'
  | 'search-index'
  | 'search-a-licious'
  | 'open-food-facts-legacy'
  | 'open-food-facts-v3'
  | 'open-food-facts-v2'
  | 'query-cache'
  | 'product-cache';

export type ProductApiMode = 'hybrid' | 'v3' | 'v2';

export type ApiAttemptOutcome =
  | 'cache-hit'
  | 'success'
  | 'http-error'
  | 'rate-limit'
  | 'network-error'
  | 'timeout'
  | 'parse-error'
  | 'aborted';

export interface ApiAttemptDiagnostic {
  backend: ApiBackend;
  label: string;
  url: string;
  startedAt: string;
  durationMs: number;
  outcome: ApiAttemptOutcome;
  status?: number;
  errorName?: string;
  errorMessage?: string;
  responsePreview?: string;
  retryAfterMs?: number;
  cacheAgeMs?: number;
}

export interface ApiResponseMeta {
  cacheStatus: 'network' | 'fresh-cache' | 'stale-cache';
  fetchedAt: string;
  sourceUrl: string;
  backend?: ApiBackend;
  originBackend?: ApiBackend;
  networkAttempted?: boolean;
  durationMs?: number;
  cacheAgeMs?: number;
  cacheKey?: string;
  cacheLayer?: 'none' | 'browser-memory' | 'browser-indexeddb' | 'browser-localstorage' | 'gateway-memory' | 'gateway-redis';
  gatewayCacheStatus?: 'network' | 'fresh-cache' | 'stale-cache';
  attempts?: ApiAttemptDiagnostic[];
  /** Why cached data or a secondary backend was used. */
  fallbackReason?: 'offline' | 'rate-limit' | 'network' | 'timeout' | 'http' | 'parse' | 'empty-result';
  fallbackStatus?: number;
  /** `local-budget` is retained only for metadata written by releases before 2.2. */
  fallbackOrigin?: 'local-budget' | 'remote-limit' | 'remote-overload';
  retryAt?: string;
}

export interface ParsedFoodRequest {
  status: ParseStatus;
  rawInput: string;
  product: {
    name: string;
    brand: string | null;
    variant: string | null;
  };
  amount: {
    value: number;
    unit: FoodUnit;
    /** True only when the user explicitly supplied a number. */
    valueExplicit?: boolean;
    /** True only when the user explicitly supplied the unit word. */
    unitExplicit?: boolean;
  };
  resolutionMode: ResolutionMode;
  barcode: string | null;
  clarificationQuestion: string | null;
  parser: 'local' | 'openai';
}

export interface SearchNutriments {
  carbohydrates_100g?: number;
  carbohydrates_100ml?: number;
  carbohydrates_serving?: number;
  carbohydrates_prepared_100g?: number;
  carbohydrates_prepared_100ml?: number;
  carbohydrates_prepared_serving?: number;
  [key: string]: number | string | undefined;
}

export interface SearchHit {
  code?: string;
  product_name?: string;
  product_name_de?: string;
  generic_name?: string;
  generic_name_de?: string;
  brands?: string | string[];
  quantity?: string;
  countries_tags?: string[];
  categories_tags?: string[];
  nutriments?: SearchNutriments;
  image_front_url?: string;
  serving_size?: string;
  serving_quantity?: number | string;
  product_quantity?: number | string;
  product_quantity_unit?: string;
  nutrition_data_per?: string;
  nutrition_data_prepared_per?: string;
  data_quality_errors_tags?: string[];
  unique_scans_n?: number;
  completeness?: number;
  _score?: number;
  api_meta?: ApiResponseMeta;
}

export interface SearchResponse {
  hits: SearchHit[];
  count?: number;
  page?: number;
  page_size?: number;
  page_count?: number;
  took?: number;
  timed_out?: boolean;
  warnings?: unknown[] | null;
  errors?: unknown[];
  api_meta?: ApiResponseMeta;
  source?: 'gateway' | 'search-index' | 'search-a-licious' | 'open-food-facts-legacy' | 'none';
  gateway_attempts?: ApiAttemptDiagnostic[];
  query_used?: string;
}

export interface SearchOutcomeQuery {
  raw: string;
  canonical: string;
  productOnly: string;
}

export interface SearchOutcomeDiagnostics {
  networkAttempted: boolean;
  cacheStatus: 'none' | 'fresh-cache' | 'stale-cache' | 'network';
  attempts: ApiAttemptDiagnostic[];
  retryAllowedImmediately: true;
  errorKind?: 'configuration' | 'http' | 'rate-limit' | 'network' | 'timeout' | 'parse' | 'aborted';
  statusCode?: number;
  message?: string;
  retryAt?: string;
}

/**
 * Total, contract-shaped result of one user-triggered search action. External
 * outages are represented as `temporarily_unavailable`, never as an unhandled
 * rejection that can escape into React rendering.
 */
export interface SearchOutcome {
  requestId: string;
  status: SearchOutcomeStatus;
  query: SearchOutcomeQuery;
  sourceMode: 'api' | 'clinic';
  candidates?: SearchHit[];
  result?: SearchResponse | null;
  diagnostics: SearchOutcomeDiagnostics;
}

export interface OffProduct {
  code?: string;
  product_name?: string;
  product_name_de?: string;
  generic_name?: string;
  generic_name_de?: string;
  brands?: string | string[];
  quantity?: string;
  product_quantity?: number | string;
  product_quantity_unit?: string;
  serving_size?: string;
  serving_quantity?: number | string;
  image_front_url?: string;
  categories_tags?: string[];
  countries_tags?: string[];
  data_quality_errors_tags?: string[];
  nutrition_data_per?: string;
  nutrition_data_prepared_per?: string;
  nutriments?: SearchNutriments;
}

export interface OffProductResponse {
  status?: string;
  code?: string;
  product?: OffProduct;
  errors?: unknown[];
  warnings?: unknown[];
  api_meta?: ApiResponseMeta;
  gateway_attempts?: ApiAttemptDiagnostic[];
}

export interface ProductSummary {
  barcode: string | null;
  name: string;
  brand: string | null;
  imageUrl: string | null;
  packageDescription: string | null;
  packageWeightG: number | null;
  servingDescription: string | null;
  servingWeightG: number | null;
  categories: string[];
}

export type PortionSource =
  | 'user-calibration'
  | 'explicit-unit'
  | 'explicit-multipack'
  | 'count-and-net-weight'
  | 'manufacturer-serving'
  | 'single-package'
  | 'package'
  | 'mass'
  | 'volume'
  | 'manual'
  | 'generic-consensus'
  | 'unresolved';

/**
 * A safe, user-selectable calculation basis. `weightG` is always the weight
 * of exactly one selected unit, never the total requested amount.
 */
export interface PortionOption {
  id: string;
  unit: FoodUnit;
  label: string;
  weightG: number | null;
  volumeMl: number | null;
  source: PortionSource;
  confidence: Confidence;
  note: string;
  recommended: boolean;
  /** True only for an edible unit, never for a sales package or generic mass. */
  smallestEdibleUnit?: boolean;
  /** Lower values rank before higher values in the deterministic selector. */
  priority?: number;
}

export interface CalculationResult {
  id: string;
  createdAt: string;
  request: ParsedFoodRequest;
  product: ProductSummary;
  mode: 'exact' | 'generic' | 'manual';
  status: 'calculated' | 'needs_unit_calibration' | 'not_found' | 'temporarily_unavailable';
  carbohydratesG: number | null;
  carbohydratesPer100: number | null;
  basis: '100g' | '100ml';
  totalMassG: number | null;
  totalVolumeMl: number | null;
  unitWeightG: number | null;
  amount: number;
  unit: FoodUnit;
  countability?: Countability;
  confidence: Confidence;
  sourceLabel: string;
  methodLabel: string;
  /** Immutable upstream data timestamp captured when this result was created. */
  dataFetchedAt: string | null;
  /** Browser/gateway cache age in milliseconds at calculation time. */
  dataCacheAgeMs: number | null;
  sampleSize: number | null;
  middleRange: { from: number; to: number } | null;
  candidates: SearchHit[];
  notes: string[];
  favorite: boolean;
  portionOptions: PortionOption[];
  selectedPortionId: string | null;
}

export interface ManualFormValues {
  productName: string;
  brand: string;
  amount: number;
  unit: FoodUnit;
  barcode: string;
  unitWeightG: number | null;
  /** Nutrition reference printed on the label. */
  nutritionBasis: '100g' | '100ml';
  carbsPer100: number | null;
}

export interface AppSettings {
  aiEnabled: boolean;
  decimalPlaces: 0 | 1 | 2;
  searchPageSize: 10 | 15 | 20;
  preferGermanMarket: boolean;
  saveHistory: boolean;
  /** Persist the current query/result screen across reloads on this device. */
  saveSearchSession: boolean;
  /** Persist user-entered unit calibrations for later calculations. */
  saveCalibrations: boolean;
  /** Persist API responses for offline use. Network access still requires the gateway. */
  cacheApiData: boolean;
  /** Required for network search; manual and previously cached flows remain local. */
  dataGatewayUrl: string;
  /** Product detail strategy: hybrid (v3->v2), v3-only, or v2-only. */
  productApiMode: ProductApiMode;
}

export interface WeightMeasurement {
  unitWeightG: number;
  measuredPieces: number | null;
  measuredTotalWeightG: number | null;
  /** Generic reuse is only persisted after an explicit user choice. */
  reuseScope?: 'product' | 'generic';
}

export type CalibrationScope = 'barcode' | 'exact_product' | 'generic_food';

export interface PieceCalibration {
  schemaVersion: 2;
  calibrationId: string;
  scope: CalibrationScope;
  scopeKey: string;
  product: {
    canonicalName: string;
    displayName: string;
    brandCanonical: string | null;
    barcode: string | null;
  };
  unit: {
    kind: Extract<FoodUnit, 'piece' | 'bar' | 'slice' | 'portion'>;
    label: string;
    smallestEdibleUnit: boolean;
  };
  measurement: {
    mode: 'single_unit' | 'group_weighing';
    measuredCount: number;
    measuredTotalWeightG: number;
  };
  derivedUnitWeightG: number;
  nutritionSnapshot?: {
    carbohydratesPer100g: number | null;
    derivedCarbsPerUnitG: number | null;
  };
  createdAt: string;
  updatedAt: string;
  active: boolean;
}

/** Record shape written by releases before the v2 calibration contract. */
export interface LegacyPieceCalibration {
  key: string;
  productName: string;
  barcode: string | null;
  unit: FoodUnit;
  weightG: number;
  measuredPieces: number | null;
  measuredTotalWeightG: number | null;
  updatedAt: string;
}
