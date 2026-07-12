#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');

async function write(relative, content) {
  const target = path.join(root, relative);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content.replace(/^\n/, ''));
}

await write('src/generated/search-api/client.ts', String.raw`
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
`);

await write('src/generated/search-api/schemas.ts', `
/** Generated schema aliases consumed by the handwritten orchestration layer. */
export {
  GatewayHealthResponse as HealthResponseSchema,
  ParseFoodRequestBody as AiParseRequestSchema,
  ParseFoodRequestResponse as AiParseResponseSchema,
  ProductByBarcodeResponse as ProductGatewayResponseSchema,
  SearchProductsResponse as SearchGatewayResponseSchema
} from '../gateway.zod';
`);

await write('src/generated/search-api/models.ts', `
/** Generated public model surface for the optional gateway. */
export type {
  AiParseRequest,
  AiParseResponse,
  ApiAttemptDiagnostic,
  ApiError,
  HealthResponse,
  ProductGatewayResponse,
  SearchGatewayResponse,
  SearchProductsParams
} from '../models';
`);

await write('src/generated/search-api/index.ts', `
export * from './client';
export * from './models';
export * from './schemas';
`);

await write('server/generated/search-api.schemas.mjs', `
/**
 * Generated server-facing schema surface.
 * The canonical definitions live in contracts/source/search-api.contract.mjs.
 */
export {
  AiParseRequestSchema,
  AiParseResponseSchema,
  HealthResponseSchema,
  ProductGatewayResponseSchema,
  SearchGatewayResponseSchema
} from '../../contracts/source/search-api.contract.mjs';
`);

await write('generated-tests/search-api.msw.ts', `
/** Generated MSW/Faker surface for application and contract tests. */
export {
  getGatewayHealthMockHandler,
  getKHCheckerOptionalGatewayAPIMock,
  getParseFoodRequestMockHandler,
  getProductByBarcodeMockHandler,
  getSearchProductsMockHandler
} from '../src/generated/gateway/client.msw';
export {
  getGatewayHealthResponseMock,
  getParseFoodRequestResponseMock,
  getProductByBarcodeResponseMock,
  getSearchProductsResponseMock
} from '../src/generated/gateway/client.faker';
`);

console.log('Generated browser/server adapters and MSW test surface.');
