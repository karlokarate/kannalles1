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
