import type {
  OffAccountCredentials,
  OffProduct,
  OffProductResponse,
  ProductApiMode,
  SearchHit,
  SearchOutcome,
  SearchResponse
} from '../types';
import { normalizeOffBarcode } from './barcode';
import {
  cancelOfflineCatalogRequests,
  getOfflineCatalogProduct,
  searchOfflineCatalog
} from './catalog/catalogClient';
import type { CatalogProductRecord } from './catalog/catalogProtocol';
import { correctCommonFoodTypos } from './query';
import { clearApiGovernor, getApiUsageSnapshot } from './apiGovernor';

const MAX_SEARCH_QUERY_LENGTH = 120;

export const SEARCH_FIELDS = [
  'code',
  'product_name',
  'brands',
  'quantity',
  'product_quantity',
  'product_quantity_unit',
  'serving_size',
  'serving_quantity',
  'nutriments'
] as const;

export interface SearchFoodOptions {
  preserveVariants?: boolean;
  /** Retained only for source compatibility. Online product access is disabled. */
  gatewayUrl?: string;
  productOnly?: string;
  /** Retained only for source compatibility. */
  searchApiMode?: 'auto' | 'legacy-only';
  /** Retained only for source compatibility. The catalog is its own persistent source. */
  cacheEnabled?: boolean;
  /** Retained only for migration compatibility. Credentials are never used. */
  offAccount?: OffAccountCredentials | null;
}

export interface ProductRequestOptions {
  /** Retained only for source compatibility. Online product access is disabled. */
  gatewayUrl?: string;
  seedProduct?: OffProduct;
  productApiMode?: ProductApiMode;
  cacheEnabled?: boolean;
  offAccount?: OffAccountCredentials | null;
}

export interface OffAccountIdentity {
  userId: string;
  name: string | null;
}

type DataSourceErrorKind =
  | 'configuration'
  | 'http'
  | 'rate-limit'
  | 'network'
  | 'timeout'
  | 'parse'
  | 'aborted';

export { clearApiGovernor, getApiUsageSnapshot };

export class DataSourceError extends Error {
  readonly status?: number;
  readonly attempts = [];
  readonly retryAt?: number;

  constructor(
    message: string,
    readonly kind: DataSourceErrorKind,
    options: { status?: number; retryAt?: number; cause?: unknown } = {}
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'DataSourceError';
    this.status = options.status;
    this.retryAt = options.retryAt;
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  throw new DataSourceError('Die lokale Datenbankanfrage wurde abgebrochen.', 'aborted', {
    cause: signal.reason
  });
}

function asDataSourceError(error: unknown): DataSourceError {
  if (error instanceof DataSourceError) return error;
  if (error instanceof DOMException && error.name === 'AbortError') {
    return new DataSourceError(error.message, 'aborted', { cause: error });
  }
  const code = typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code?: unknown }).code ?? '')
    : '';
  const message = error instanceof Error ? error.message : String(error);
  const kind: DataSourceErrorKind = code.includes('SCHEMA')
    || code.includes('HASH')
    || code.includes('INTEGRITY')
    || code.includes('MANIFEST')
    ? 'parse'
    : 'configuration';
  return new DataSourceError(message || 'Die lokale Produktdatenbank ist nicht verfügbar.', kind, {
    cause: error
  });
}

export function cancelPendingApiRequests(): void {
  cancelOfflineCatalogRequests();
}

export function canonicalizeSearchQuery(productName: string): string {
  const printable = Array.from(correctCommonFoodTypos(productName), (character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127 ? ' ' : character;
  }).join('');
  return printable
    .replace(/[<>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_SEARCH_QUERY_LENGTH);
}

function positiveNumber(value: number | null): number | undefined {
  return value !== null && Number.isFinite(value) && value > 0 ? value : undefined;
}

function recordToHit(record: CatalogProductRecord): SearchHit {
  const servingQuantity = positiveNumber(record.servingQuantityG);
  const productQuantity = positiveNumber(record.productQuantityG);
  return {
    code: record.code,
    product_name: record.name,
    brands: record.brand ?? undefined,
    quantity: productQuantity === undefined ? undefined : `${productQuantity} g`,
    product_quantity: productQuantity,
    product_quantity_unit: productQuantity === undefined ? undefined : 'g',
    serving_size: servingQuantity === undefined ? undefined : `${servingQuantity} g`,
    serving_quantity: servingQuantity,
    nutrition_data_per: '100g',
    nutriments: {
      carbohydrates_100g: record.carbohydratesPer100g
    },
    _score: record.rank === null ? undefined : -record.rank,
    completeness: 1
  };
}

function recordToProduct(record: CatalogProductRecord): OffProduct {
  const hit = recordToHit(record);
  return {
    code: hit.code,
    product_name: hit.product_name,
    brands: hit.brands,
    quantity: hit.quantity,
    product_quantity: hit.product_quantity,
    product_quantity_unit: hit.product_quantity_unit,
    serving_size: hit.serving_size,
    serving_quantity: hit.serving_quantity,
    nutrition_data_per: '100g',
    nutriments: hit.nutriments
  };
}

function requestId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `catalog-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }
}

export async function searchFoodCandidates(
  productName: string,
  pageSize = 15,
  signal?: AbortSignal,
  _options: SearchFoodOptions = {}
): Promise<SearchResponse> {
  throwIfAborted(signal);
  const query = canonicalizeSearchQuery(productName);
  if (!query) {
    throw new DataSourceError('Bitte gib einen Suchbegriff ein.', 'http', { status: 400 });
  }
  const limit = pageSize >= 20 ? 20 : pageSize >= 15 ? 15 : 10;
  try {
    const records = await searchOfflineCatalog(query, limit, signal);
    throwIfAborted(signal);
    const hits = records.map(recordToHit);
    return {
      hits,
      count: hits.length,
      page: 1,
      page_size: limit,
      page_count: hits.length ? 1 : 0,
      took: undefined,
      timed_out: false,
      warnings: null,
      errors: [],
      source: 'none',
      gateway_attempts: [],
      query_used: query
    };
  } catch (error) {
    throw asDataSourceError(error);
  }
}

export async function searchFoodCandidatesOutcome(
  productName: string,
  pageSize = 15,
  signal?: AbortSignal,
  options: SearchFoodOptions = {}
): Promise<SearchOutcome> {
  const canonical = canonicalizeSearchQuery(productName);
  const base = {
    requestId: requestId(),
    query: {
      raw: productName,
      canonical,
      productOnly: options.productOnly ?? canonical
    },
    sourceMode: 'api' as const
  };
  try {
    const result = await searchFoodCandidates(productName, pageSize, signal, options);
    return {
      ...base,
      status: result.hits.length ? 'resolved' : 'not_found',
      candidates: result.hits,
      result,
      diagnostics: {
        networkAttempted: false,
        cacheStatus: 'fresh-cache',
        attempts: [],
        retryAllowedImmediately: true
      }
    };
  } catch (error) {
    const typed = asDataSourceError(error);
    if (typed.kind === 'aborted') throw typed;
    return {
      ...base,
      status: 'temporarily_unavailable',
      candidates: [],
      result: null,
      diagnostics: {
        networkAttempted: false,
        cacheStatus: 'none',
        attempts: [],
        retryAllowedImmediately: true,
        errorKind: typed.kind,
        statusCode: typed.status,
        message: typed.message
      }
    };
  }
}

export async function getProductByBarcode(
  codeInput: string,
  signal?: AbortSignal,
  options: ProductRequestOptions = {}
): Promise<OffProductResponse> {
  throwIfAborted(signal);
  const code = normalizeOffBarcode(codeInput);
  if (!code) {
    throw new DataSourceError('Der Barcode ist ungültig.', 'http', { status: 400 });
  }
  try {
    const record = await getOfflineCatalogProduct(code, signal);
    throwIfAborted(signal);
    if (record) {
      return {
        status: 'success',
        code,
        product: recordToProduct(record),
        errors: [],
        warnings: [],
        gateway_attempts: []
      };
    }
    if (options.seedProduct?.code === code) {
      return {
        status: 'success',
        code,
        product: options.seedProduct,
        errors: [],
        warnings: [],
        gateway_attempts: []
      };
    }
    throw new DataSourceError('Für diesen Barcode wurde im lokalen Katalog kein Produkt gefunden.', 'http', {
      status: 404
    });
  } catch (error) {
    throw asDataSourceError(error);
  }
}

export async function authenticateOffAccount(
  _credentials: Pick<OffAccountCredentials, 'userId' | 'password'>,
  _signal?: AbortSignal
): Promise<OffAccountIdentity> {
  throw new DataSourceError(
    'Online-Zugriffe sind deaktiviert. Ein Open-Food-Facts-Konto wird für den lokalen Katalog nicht verwendet.',
    'configuration'
  );
}
