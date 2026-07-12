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
