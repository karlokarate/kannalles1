#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
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
import type {
  AiParseRequest,
  AiParseResponse,
  ApiAttemptDiagnostic,
  ApiError,
  HealthResponse,
  ProductApiMode,
  ProductByBarcodeParams,
  ProductGatewayResponse,
  SearchApiMode,
  SearchGatewayResponse,
  SearchProductsParams
} from '../models';
import {
  AiParseResponseSchema,
  ApiErrorSchema,
  HealthResponseSchema,
  ProductPathSchema,
  ProductGatewayResponseSchema,
  SearchQuerySchema,
  SearchGatewayResponseSchema
} from './schemas';

function canonicalGatewayBase(base: string): { url: URL; relative: boolean } {
  const normalized = base.trim();
  if (!normalized) throw new Error('Gateway-URL fehlt.');
  if (/[\u0000-\u0020]/.test(normalized)) {
    throw new Error('Gateway-URL darf keine Leer- oder Steuerzeichen enthalten.');
  }
  if (normalized.startsWith('//')) {
    throw new Error('Protokoll-relative Gateway-URLs sind nicht erlaubt.');
  }

  const explicitScheme = /^[a-z][a-z\d+.-]*:/i.test(normalized);
  let url: URL;
  try {
    url = new URL(normalized, explicitScheme ? undefined : 'https://gateway.invalid/');
  } catch (cause) {
    throw new Error('Gateway-URL ist ungültig.', { cause });
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('Gateway-URL muss HTTP oder HTTPS verwenden.');
  }
  if (url.username || url.password) {
    throw new Error('Gateway-URL darf keine Zugangsdaten enthalten.');
  }
  if (url.search || url.hash) {
    throw new Error('Gateway-URL darf weder Query noch Fragment enthalten.');
  }
  url.pathname = url.pathname.endsWith('/') ? url.pathname : url.pathname + '/';
  return { url, relative: !explicitScheme };
}

function absoluteGatewayUrl(base: string, generatedPath: string): string {
  const canonical = canonicalGatewayBase(base);
  const joined = new URL(generatedPath.replace(/^\//, ''), canonical.url);
  return canonical.relative ? joined.pathname + joined.search : joined.toString();
}

export function buildGatewaySearchUrl(
  base: string,
  query: string,
  pageSize = 15,
  searchApi: SearchApiMode = 'auto'
): string {
  const parsedQuery = SearchQuerySchema.safeParse({ q: query, page_size: pageSize, search_api: searchApi });
  if (!parsedQuery.success) throw new Error('Suchparameter verletzen den API-Vertrag.');
  const params: SearchProductsParams = parsedQuery.data;
  return absoluteGatewayUrl(base, getSearchProductsUrl(params));
}

export function buildGatewayProductUrl(
  base: string,
  code: string,
  knownCarbohydrates = false,
  productApi: ProductApiMode = 'hybrid'
): string {
  const parsedPath = ProductPathSchema.safeParse({ code });
  if (!parsedPath.success) throw new Error('Barcode muss aus 7 bis 14 Ziffern bestehen.');
  const params: ProductByBarcodeParams = {
    known_carbs: knownCarbohydrates ? '1' : '0',
    product_api: productApi
  };
  return absoluteGatewayUrl(base, getProductByBarcodeUrl(encodeURIComponent(parsedPath.data.code), params));
}

export function buildGatewayHealthUrl(base: string): string {
  return absoluteGatewayUrl(base, getGatewayHealthUrl());
}

export function buildGatewayAiParseUrl(base: string): string {
  return absoluteGatewayUrl(base, getParseFoodRequestUrl());
}

export interface GatewayTransportResult<T> {
  data: T;
  status: number;
  headers: Headers;
  responseText: string;
  url: string;
}

export interface GatewayRequestOptions extends Omit<RequestInit, 'method' | 'body'> {
  signal?: AbortSignal;
}

export interface GatewayClientOptions {
  baseUrl: string;
  fetchImpl?: typeof fetch;
  defaultInit?: Omit<RequestInit, 'method' | 'body' | 'signal'>;
}

export class GatewayTransportError extends Error {
  readonly status: number | null;
  readonly responseText: string;
  readonly headers: Headers | null;
  readonly url: string;
  readonly apiError: ApiError | null;
  readonly code: string | null;
  readonly traceId: string | null;
  readonly retryAt: string | null;
  readonly attempts: ApiAttemptDiagnostic[];

  constructor(
    message: string,
    details: {
      status?: number;
      responseText?: string;
      headers?: Headers;
      url: string;
      apiError?: ApiError;
      cause?: unknown;
    }
  ) {
    super(message, details.cause === undefined ? undefined : { cause: details.cause });
    this.name = 'GatewayTransportError';
    this.status = details.status ?? null;
    this.responseText = details.responseText ?? '';
    this.headers = details.headers ?? null;
    this.url = details.url;
    this.apiError = details.apiError ?? null;
    this.code = details.apiError?.code ?? null;
    this.traceId = details.apiError?.traceId ?? null;
    this.retryAt = details.apiError?.retryAt ?? null;
    this.attempts = details.apiError?.attempts ?? [];
  }
}

export const MAX_GATEWAY_RESPONSE_BYTES = 1_048_576;

async function readBoundedResponseText(response: Response, url: string): Promise<string> {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_GATEWAY_RESPONSE_BYTES) {
    throw new GatewayTransportError('Daten-Gateway-Antwort überschreitet das Größenlimit.', {
      status: response.status,
      headers: response.headers,
      url
    });
  }
  if (!response.body) return response.text();

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let received = 0;
  let text = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > MAX_GATEWAY_RESPONSE_BYTES) {
        await reader.cancel();
        throw new GatewayTransportError('Daten-Gateway-Antwort überschreitet das Größenlimit.', {
          status: response.status,
          headers: response.headers,
          url
        });
      }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

function mergeHeaders(...sources: Array<HeadersInit | undefined>): Headers {
  const merged = new Headers();
  for (const source of sources) {
    if (!source) continue;
    new Headers(source).forEach((value, key) => merged.set(key, value));
  }
  return merged;
}

async function requestAndValidate<T>(
  fetchImpl: typeof fetch,
  url: string,
  schema: { parse(value: unknown): T },
  defaultInit: GatewayClientOptions['defaultInit'],
  options: GatewayRequestOptions = {},
  body?: unknown,
  acceptedStatuses: readonly number[] = []
): Promise<GatewayTransportResult<T>> {
  const headers = mergeHeaders(
    { Accept: 'application/json' },
    defaultInit?.headers,
    options.headers,
    body === undefined ? undefined : { 'Content-Type': 'application/json' }
  );
  let response: Response;
  try {
    response = await fetchImpl(url, {
      ...defaultInit,
      ...options,
      method: body === undefined ? 'GET' : 'POST',
      headers,
      body: body === undefined ? undefined : JSON.stringify(body)
    });
  } catch (cause) {
    throw new GatewayTransportError('Daten-Gateway ist nicht erreichbar.', { url, cause });
  }
  const responseText = await readBoundedResponseText(response, url);
  let json: unknown;
  try {
    json = JSON.parse(responseText);
  } catch (cause) {
    throw new GatewayTransportError('Daten-Gateway lieferte kein gültiges JSON.', {
      status: response.status, responseText, headers: response.headers, url, cause
    });
  }
  if (!response.ok && !acceptedStatuses.includes(response.status)) {
    const parsedError = ApiErrorSchema.safeParse(json);
    throw new GatewayTransportError(
      'Daten-Gateway antwortete mit HTTP ' + response.status + '.',
      {
        status: response.status,
        responseText,
        headers: response.headers,
        url,
        apiError: parsedError.success ? parsedError.data : undefined
      }
    );
  }
  let data: T;
  try {
    data = schema.parse(json);
  } catch (cause) {
    throw new GatewayTransportError('Daten-Gateway-Antwort verletzt den API-Vertrag.', {
      status: response.status, responseText, headers: response.headers, url, cause
    });
  }
  return { data, status: response.status, headers: response.headers, responseText, url };
}

export function createGatewayClient(options: GatewayClientOptions) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new Error('Keine Fetch-Implementierung verfügbar.');
  const baseUrl = options.baseUrl;
  return {
    health: (request?: GatewayRequestOptions) => requestAndValidate<HealthResponse>(
      fetchImpl,
      buildGatewayHealthUrl(baseUrl),
      HealthResponseSchema,
      options.defaultInit,
      request,
      undefined,
      [503]
    ),
    search: (
      input: { query: string; pageSize?: number; searchApi?: SearchApiMode },
      request?: GatewayRequestOptions
    ) => requestAndValidate<SearchGatewayResponse>(
      fetchImpl,
      buildGatewaySearchUrl(baseUrl, input.query, input.pageSize, input.searchApi),
      SearchGatewayResponseSchema,
      options.defaultInit,
      request
    ),
    product: (
      input: { code: string; knownCarbohydrates?: boolean; productApi?: ProductApiMode },
      request?: GatewayRequestOptions
    ) => requestAndValidate<ProductGatewayResponse>(
      fetchImpl,
      buildGatewayProductUrl(baseUrl, input.code, input.knownCarbohydrates, input.productApi),
      ProductGatewayResponseSchema,
      options.defaultInit,
      request
    ),
    parse: (input: AiParseRequest, request?: GatewayRequestOptions) => requestAndValidate<AiParseResponse>(
      fetchImpl,
      buildGatewayAiParseUrl(baseUrl),
      AiParseResponseSchema,
      options.defaultInit,
      request,
      input
    )
  };
}

export type GatewayClient = ReturnType<typeof createGatewayClient>;
`);

await write('src/generated/search-api/schemas.ts', `
/** Generated schema aliases consumed by the handwritten orchestration layer. */
import {
  AiParseRequest,
  SearchProductsQueryParams
} from '../gateway.zod';

export {
  AiParseResponse as AiParseResponseSchema,
  ApiError as ApiErrorSchema,
  HealthResponse as HealthResponseSchema,
  ProductByBarcodeParams as ProductPathSchema,
  ProductByBarcodeQueryParams as ProductQuerySchema,
  ProductGatewayResponse as ProductGatewayResponseSchema,
  SearchGatewayResponse as SearchGatewayResponseSchema
} from '../gateway.zod';

export const AiParseRequestSchema = AiParseRequest.transform((value) => ({
  ...value,
  input: value.input.trim()
}));

const IntegerSearchQuerySchema = SearchProductsQueryParams.refine(
  (value) => Number.isInteger(value.page_size),
  { path: ['page_size'], message: 'page_size muss ganzzahlig sein.' }
);

export const SearchQuerySchema = IntegerSearchQuerySchema.transform((value) => ({
  ...value,
  q: value.q.trim()
}));
`);

await write('src/generated/search-api/models.ts', `
/** Generated public model surface for the versioned data gateway. */
export type {
  AiParseRequest,
  AiParseResponse,
  ApiAttemptDiagnostic,
  ApiError,
  HealthResponse,
  ProductApiMode,
  ProductGatewayResponse,
  SearchApiMode,
  SearchGatewayResponse,
  SearchProductsParams
} from '../models';
`);

await write('src/generated/search-api/index.ts', `
export * from './client';
export * from './models';
export * from './schemas';
`);

const rawGatewayZodTypeScript = await readFile(path.join(root, 'src/generated/gateway.zod.ts'), 'utf8');
const zodImport = "import * as zod from 'zod';";
if (!rawGatewayZodTypeScript.includes(zodImport)) {
  throw new Error('Orval Zod output no longer contains the expected Zod namespace import.');
}
// Zod's optional JIT capability probe uses Function(), which is correctly
// blocked by the app CSP. Explicit jitless mode avoids both the violation and
// an unnecessary exception while retaining the same validation semantics.
const gatewayZodTypeScript = rawGatewayZodTypeScript.replace(
  zodImport,
  `${zodImport}\n\nzod.config({ jitless: true });`
);
await write('src/generated/gateway.zod.ts', gatewayZodTypeScript);
const typeOnlyLines = gatewayZodTypeScript.match(/^export type .*;\r?$/gm) ?? [];
if (typeOnlyLines.length < 1) throw new Error('Orval Zod output no longer contains the expected type-only exports.');
const gatewayZodJavaScript = gatewayZodTypeScript.replace(/^export type .*;\r?\n?/gm, '');
if (/^export\s+(?:type|interface)\b/m.test(gatewayZodJavaScript)) {
  throw new Error('Unhandled TypeScript-only declaration remains in the server Zod graph.');
}
await write('server/generated/gateway.zod.mjs', `
/**
 * Generated standalone server Zod graph. Canonical input:
 * contracts/source/search-api.contract.mjs -> OpenAPI -> Orval Zod.
 * Do not edit manually.
 */
${gatewayZodJavaScript.trimEnd()}
`);

await write('server/generated/search-api.schemas.mjs', `
/**
 * Generated server-facing schema surface.
 * The canonical definitions live in contracts/source/search-api.contract.mjs;
 * this runtime module intentionally has no Hono/OpenAPI dependency.
 */
import * as zod from 'zod';
import {
  AiParseRequest,
  SearchProductsQueryParams
} from './gateway.zod.mjs';

export {
  AiParseResponse as AiParseResponseSchema,
  ApiError as ApiErrorSchema,
  HealthResponse as HealthResponseSchema,
  ProductByBarcodeParams as ProductPathSchema,
  ProductByBarcodeQueryParams as ProductQuerySchema,
  ProductGatewayResponse as ProductGatewayResponseSchema,
  SearchGatewayResponse as SearchGatewayResponseSchema
} from './gateway.zod.mjs';

export const AiParseRequestSchema = AiParseRequest.transform((value) => ({
  ...value,
  input: value.input.trim()
}));

const IntegerSearchQuerySchema = SearchProductsQueryParams.refine(
  (value) => Number.isInteger(value.page_size),
  { path: ['page_size'], message: 'page_size muss ganzzahlig sein.' }
);

export const SearchQuerySchema = zod.preprocess((value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const query = { ...value };
  if (typeof query.page_size === 'string') query.page_size = Number(query.page_size);
  return query;
}, IntegerSearchQuerySchema).transform((value) => ({
  ...value,
  q: value.q.trim()
}));
`);
for (const generatedModule of [
  'server/generated/gateway.zod.mjs',
  'server/generated/search-api.schemas.mjs'
]) {
  const syntax = spawnSync(process.execPath, ['--check', path.join(root, generatedModule)], {
    cwd: root, encoding: 'utf8', windowsHide: true
  });
  if (syntax.status !== 0) {
    throw new Error(`Generated server module is not valid JavaScript (${generatedModule}): ${syntax.stderr || syntax.stdout}`);
  }
}

await write('generated-tests/search-api.msw.ts', `
/** Generated MSW/Faker surface for application and contract tests. */
export {
  getGatewayHealthMockHandler,
  getKHCheckerDataGatewayAPIMock,
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
