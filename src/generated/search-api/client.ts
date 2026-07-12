/**
 * Generated adapter around the Orval URL builders.
 * Do not edit manually; run npm run api:generate.
 */
import {
  getGatewayHealthUrl,
  getParseFoodRequestUrl,
  getProductByBarcodeUrl,
  getSearchProductsUrl
} from '../gateway/client';
import type { ProductByBarcodeParams, SearchProductsParams } from '../models';

function absoluteGatewayUrl(base: string, generatedPath: string): string {
  const normalized = base.trim();
  if (!normalized) throw new Error('Gateway-URL fehlt.');
  const absoluteBase = /^https?:\/\//i.test(normalized)
    ? normalized
    : typeof window !== 'undefined'
      ? new URL(normalized, window.location.origin).toString()
      : normalized;
  const root = absoluteBase.endsWith('/') ? absoluteBase : absoluteBase + '/';
  return new URL(generatedPath.replace(/^\//, ''), root).toString();
}

export function buildGatewaySearchUrl(base: string, query: string, pageSize = 15): string {
  const params: SearchProductsParams = { q: query, page_size: pageSize };
  return absoluteGatewayUrl(base, getSearchProductsUrl(params));
}

export function buildGatewayProductUrl(
  base: string,
  code: string,
  knownCarbohydrates = false
): string {
  const params: ProductByBarcodeParams | undefined = knownCarbohydrates
    ? { known_carbs: '1' }
    : undefined;
  return absoluteGatewayUrl(base, getProductByBarcodeUrl(code, params));
}

export function buildGatewayHealthUrl(base: string): string {
  return absoluteGatewayUrl(base, getGatewayHealthUrl());
}

export function buildGatewayAiParseUrl(base: string): string {
  return absoluteGatewayUrl(base, getParseFoodRequestUrl());
}
