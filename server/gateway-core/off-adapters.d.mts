import type { OffProduct, OffProductResponse, SearchResponse } from '../../src/types';

export const SEARCH_FIELDS: readonly string[];
export const SEARCH_INDEX_FIELDS: readonly string[];
export const PRODUCT_V2_FIELDS: readonly string[];
export const PRODUCT_V3_FIELDS: readonly string[];

export function adaptV2ProductResponse(data: unknown): OffProductResponse;
export function adaptV3ProductResponse(data: unknown): OffProductResponse;
export function mergeProductResponses(v3Data: unknown, v2Data: unknown): OffProductResponse;
export function hasCarbohydrateData(product: OffProduct | undefined): boolean;
export function normalizeIndexSearch(
  data: unknown,
  query: string,
  source: 'search-index' | 'search-a-licious'
): SearchResponse;
export function normalizeLegacySearch(data: unknown, query: string): SearchResponse;
