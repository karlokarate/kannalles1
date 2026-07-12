/**
 * KH Checker v2.2.4 canonical optional-gateway contract.
 *
 * AUTHORITATIVE GENERATOR INPUT
 * -----------------------------
 * This Hono + Zod definition is the source for:
 * - OpenAPI 3.1 JSON/YAML
 * - Orval Fetch client and URL builders
 * - TypeScript models
 * - browser/server Zod runtime validators
 * - MSW/Faker mocks
 * - API documentation
 * - contract tests
 *
 * Generated files must never be edited manually.
 */
import { readFileSync } from 'node:fs';
import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';

const packageJson = JSON.parse(
  readFileSync(new URL('../../package.json', import.meta.url), 'utf8')
);
export const APP_VERSION = String(packageJson.version);

export const FoodUnitSchema = z
  .enum(['g', 'kg', 'ml', 'piece', 'bar', 'slice', 'portion', 'package'])
  .openapi('FoodUnit');

export const ApiBackendSchema = z
  .enum([
    'gateway',
    'search-a-licious',
    'open-food-facts-legacy',
    'open-food-facts-v3',
    'open-food-facts-v2',
    'query-cache',
    'product-cache'
  ])
  .openapi('ApiBackend');

export const ApiAttemptOutcomeSchema = z
  .enum([
    'cache-hit',
    'success',
    'http-error',
    'rate-limit',
    'network-error',
    'timeout',
    'parse-error',
    'aborted'
  ])
  .openapi('ApiAttemptOutcome');

export const ApiAttemptDiagnosticSchema = z
  .object({
    backend: ApiBackendSchema,
    label: z.string().min(1),
    url: z.string().min(1),
    startedAt: z.iso.datetime(),
    durationMs: z.number().nonnegative(),
    outcome: ApiAttemptOutcomeSchema,
    status: z.number().int().min(100).max(599).optional(),
    errorName: z.string().optional(),
    errorMessage: z.string().optional(),
    responsePreview: z.string().max(500).optional(),
    retryAfterMs: z.number().nonnegative().optional(),
    cacheAgeMs: z.number().nonnegative().optional()
  })
  .strict()
  .openapi('ApiAttemptDiagnostic');

export const ApiResponseMetaSchema = z
  .object({
    cacheStatus: z.enum(['network', 'fresh-cache', 'stale-cache']),
    fetchedAt: z.iso.datetime(),
    sourceUrl: z.string(),
    backend: ApiBackendSchema.optional(),
    originBackend: ApiBackendSchema.optional(),
    networkAttempted: z.boolean().optional(),
    durationMs: z.number().nonnegative().optional(),
    cacheAgeMs: z.number().nonnegative().optional(),
    cacheKey: z.string().optional(),
    attempts: z.array(ApiAttemptDiagnosticSchema).optional(),
    fallbackReason: z
      .enum(['offline', 'rate-limit', 'network', 'timeout', 'http', 'parse', 'empty-result'])
      .optional(),
    fallbackStatus: z.number().int().min(100).max(599).optional(),
    fallbackOrigin: z.enum(['local-budget', 'remote-limit', 'remote-overload']).optional(),
    retryAt: z.iso.datetime().optional()
  })
  .strict()
  .openapi('ApiResponseMeta');

export const SearchNutrimentsSchema = z
  .object({
    carbohydrates_100g: z.number().optional(),
    carbohydrates_100ml: z.number().optional(),
    carbohydrates_serving: z.number().optional(),
    carbohydrates_prepared_100g: z.number().optional(),
    carbohydrates_prepared_100ml: z.number().optional(),
    carbohydrates_prepared_serving: z.number().optional()
  })
  .catchall(z.union([z.number(), z.string()]))
  .openapi('SearchNutriments');

export const SearchHitSchema = z
  .object({
    code: z.string().optional(),
    product_name: z.string().optional(),
    product_name_de: z.string().optional(),
    product_name_en: z.string().optional(),
    generic_name: z.string().optional(),
    generic_name_de: z.string().optional(),
    generic_name_en: z.string().optional(),
    brands: z.union([z.string(), z.array(z.string())]).optional(),
    quantity: z.string().optional(),
    countries_tags: z.array(z.string()).optional(),
    categories_tags: z.array(z.string()).optional(),
    countries: z.unknown().optional(),
    categories: z.unknown().optional(),
    image_url: z.string().optional(),
    nutriments: SearchNutrimentsSchema.optional(),
    image_front_url: z.string().optional(),
    serving_size: z.string().optional(),
    serving_quantity: z.union([z.number(), z.string()]).optional(),
    product_quantity: z.union([z.number(), z.string()]).optional(),
    product_quantity_unit: z.string().optional(),
    nutrition_data_per: z.string().optional(),
    nutrition_data_prepared_per: z.string().optional(),
    data_quality_errors_tags: z.array(z.string()).optional(),
    unique_scans_n: z.number().optional(),
    completeness: z.number().optional(),
    _score: z.number().optional(),
    api_meta: ApiResponseMetaSchema.optional()
  })
  .passthrough()
  .openapi('SearchHit');

export const SearchGatewayResponseSchema = z
  .object({
    hits: z.array(SearchHitSchema),
    count: z.number().nonnegative().optional(),
    page: z.number().int().min(1).optional(),
    page_size: z.number().int().min(1).max(20).optional(),
    page_count: z.number().nonnegative().optional(),
    took: z.number().nonnegative().optional(),
    timed_out: z.boolean().optional(),
    warnings: z.array(z.unknown()).nullable().optional(),
    errors: z.array(z.unknown()).optional(),
    api_meta: ApiResponseMetaSchema.optional(),
    source: z.enum(['gateway', 'search-a-licious', 'open-food-facts-legacy', 'none']).optional(),
    gateway_attempts: z.array(ApiAttemptDiagnosticSchema).optional(),
    query_used: z.string().optional()
  })
  .passthrough()
  .openapi('SearchGatewayResponse');

export const OffProductSchema = z
  .object({
    code: z.string().optional(),
    product_name: z.string().optional(),
    product_name_de: z.string().optional(),
    generic_name: z.string().optional(),
    generic_name_de: z.string().optional(),
    brands: z.string().optional(),
    quantity: z.string().optional(),
    product_quantity: z.union([z.number(), z.string()]).optional(),
    product_quantity_unit: z.string().optional(),
    serving_size: z.string().optional(),
    serving_quantity: z.union([z.number(), z.string()]).optional(),
    image_front_url: z.string().optional(),
    categories_tags: z.array(z.string()).optional(),
    countries_tags: z.array(z.string()).optional(),
    data_quality_errors_tags: z.array(z.string()).optional(),
    nutrition_data_per: z.string().optional(),
    nutrition_data_prepared_per: z.string().optional(),
    nutriments: SearchNutrimentsSchema.optional()
  })
  .passthrough()
  .openapi('OffProduct');

export const ProductGatewayResponseSchema = z
  .object({
    status: z.string().optional(),
    code: z.string().optional(),
    product: OffProductSchema.optional(),
    errors: z.array(z.unknown()).optional(),
    warnings: z.array(z.unknown()).optional(),
    api_meta: ApiResponseMetaSchema.optional(),
    gateway_attempts: z.array(ApiAttemptDiagnosticSchema).optional()
  })
  .passthrough()
  .openapi('ProductGatewayResponse');

export const ApiErrorSchema = z
  .object({
    error: z.string().min(1),
    detail: z.string().optional(),
    attempts: z.array(ApiAttemptDiagnosticSchema).optional(),
    retryAt: z.iso.datetime().optional()
  })
  .strict()
  .openapi('ApiError');

export const HealthResponseSchema = z
  .object({
    ok: z.literal(true),
    version: z.string().regex(/^\d+\.\d+\.\d+$/),
    openaiConfigured: z.boolean(),
    gatewayCacheEntries: z.number().int().nonnegative(),
    inFlightRequests: z.number().int().nonnegative()
  })
  .strict()
  .openapi('HealthResponse');

export const AiParseRequestSchema = z
  .object({
    input: z.string().trim().min(1).max(200)
  })
  .strict()
  .openapi('AiParseRequest');

export const AiParseResponseSchema = z
  .object({
    status: z.enum(['parsed', 'needs_clarification', 'unsupported']),
    rawInput: z.string(),
    product: z
      .object({
        name: z.string(),
        brand: z.string().nullable(),
        variant: z.string().nullable()
      })
      .strict(),
    amount: z
      .object({
        value: z.number().positive(),
        unit: FoodUnitSchema
      })
      .strict(),
    resolutionMode: z.enum(['generic_category', 'exact_product', 'barcode']),
    barcode: z.string().nullable(),
    clarificationQuestion: z.string().nullable(),
    parser: z.literal('openai')
  })
  .strict()
  .openapi('AiParseResponse');

export const SearchQuerySchema = z
  .object({
    q: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .openapi({
        param: { name: 'q', in: 'query' },
        example: 'BiFi'
      }),
    page_size: z.coerce
      .number()
      .int()
      .min(1)
      .max(20)
      .default(15)
      .openapi({
        param: { name: 'page_size', in: 'query' },
        example: 15
      })
  })
  .strict();

export const ProductPathSchema = z
  .object({
    code: z
      .string()
      .regex(/^\d{8,14}$/)
      .openapi({
        param: { name: 'code', in: 'path' },
        example: '4000417025005'
      })
  })
  .strict();

export const ProductQuerySchema = z
  .object({
    known_carbs: z
      .literal('1')
      .optional()
      .openapi({
        param: { name: 'known_carbs', in: 'query' },
        example: '1'
      })
  })
  .strict();

const json = (schema) => ({
  'application/json': { schema }
});

const commonErrors = {
  400: {
    description: 'Ungültige Anfrage',
    content: json(ApiErrorSchema)
  },
  429: {
    description: 'Upstream- oder Parser-Limit. Retry-After ist nur ein Hinweis.',
    headers: {
      'Retry-After': {
        description: 'Delta-Sekunden oder HTTP-Datum',
        schema: { type: 'string' }
      }
    },
    content: json(ApiErrorSchema)
  },
  502: {
    description: 'Ungültige oder fehlgeschlagene Upstream-Antwort',
    content: json(ApiErrorSchema)
  },
  503: {
    description: 'Optionaler Dienst vorübergehend nicht verfügbar',
    headers: {
      'Retry-After': {
        description: 'Delta-Sekunden oder HTTP-Datum',
        schema: { type: 'string' }
      }
    },
    content: json(ApiErrorSchema)
  }
};

export const healthRoute = createRoute({
  method: 'get',
  path: '/api/health',
  tags: ['health'],
  operationId: 'gatewayHealth',
  summary: 'Status des optionalen Gateways lesen',
  responses: {
    200: {
      description: 'Gateway ist erreichbar',
      content: json(HealthResponseSchema)
    }
  }
});

export const searchRoute = createRoute({
  method: 'get',
  path: '/api/search',
  tags: ['search'],
  operationId: 'searchProducts',
  summary: 'Produkte über das explizit konfigurierte Gateway suchen',
  request: { query: SearchQuerySchema },
  responses: {
    200: {
      description: 'Suche abgeschlossen; auch null Treffer sind HTTP 200',
      content: json(SearchGatewayResponseSchema)
    },
    ...commonErrors
  }
});

export const productRoute = createRoute({
  method: 'get',
  path: '/api/product/{code}',
  tags: ['product'],
  operationId: 'productByBarcode',
  summary: 'Nur das ausgewählte Produkt hydratisieren',
  request: {
    params: ProductPathSchema,
    query: ProductQuerySchema
  },
  responses: {
    200: {
      description: 'Ausgewähltes Produkt',
      content: json(ProductGatewayResponseSchema)
    },
    404: {
      description: 'Kein Produkt für diesen Barcode',
      content: json(ApiErrorSchema)
    },
    ...commonErrors
  }
});

export const aiParseRoute = createRoute({
  method: 'post',
  path: '/api/ai/parse',
  tags: ['ai'],
  operationId: 'parseFoodRequest',
  summary: 'Mehrdeutige Nutzereingabe optional strukturieren',
  request: {
    body: {
      required: true,
      content: json(AiParseRequestSchema)
    }
  },
  responses: {
    200: {
      description: 'Strukturiertes Parser-Ergebnis',
      content: json(AiParseResponseSchema)
    },
    ...commonErrors
  }
});

export const gatewayContractApp = new OpenAPIHono();

// Handlers are never used by the production Express gateway. Registering them
// here gives Hono one executable, type-safe route graph from which OpenAPI 3.1
// is generated deterministically.
gatewayContractApp.openapi(healthRoute, (c) =>
  c.json(
    {
      ok: true,
      version: APP_VERSION,
      openaiConfigured: false,
      gatewayCacheEntries: 0,
      inFlightRequests: 0
    },
    200
  )
);

gatewayContractApp.openapi(searchRoute, (c) => {
  const { q, page_size } = c.req.valid('query');
  return c.json(
    {
      hits: [],
      count: 0,
      page: 1,
      page_size,
      source: 'gateway',
      query_used: q,
      gateway_attempts: []
    },
    200
  );
});

gatewayContractApp.openapi(productRoute, (c) => {
  const { code } = c.req.valid('param');
  return c.json({ status: 'success', code, gateway_attempts: [] }, 200);
});

gatewayContractApp.openapi(aiParseRoute, (c) => {
  const { input } = c.req.valid('json');
  return c.json(
    {
      status: 'parsed',
      rawInput: input,
      product: { name: input, brand: null, variant: null },
      amount: { value: 1, unit: 'portion' },
      resolutionMode: 'exact_product',
      barcode: null,
      clarificationQuestion: null,
      parser: 'openai'
    },
    200
  );
});

export function getGatewayOpenApiDocument() {
  const document = gatewayContractApp.getOpenAPI31Document({
    openapi: '3.1.0',
    info: {
      title: 'KH Checker optional gateway API',
      version: APP_VERSION,
      description:
        'Generatorvertrag für das optionale Gateway. Die statische GitHub-Pages-PWA bleibt ohne eigenen Server nutzbar; Cache-, Fallback-, Deduplizierungs-, Einheiten-, Kalibrierungs- und Berechnungslogik verbleibt im Projektcode.'
    },
    jsonSchemaDialect: 'https://json-schema.org/draft/2020-12/schema',
    security: [],
    servers: [
      { url: '/', description: 'Same-origin optionales Gateway' },
      { url: 'https://kh-api.example', description: 'Beispiel für ein externes HTTPS-Gateway' }
    ],
    tags: [
      { name: 'health', description: 'Gateway-Status' },
      { name: 'search', description: 'Produktsuche' },
      { name: 'product', description: 'Ausgewählte Produktdetails' },
      { name: 'ai', description: 'Optionaler Sprachparser' }
    ]
  });

  return {
    ...document,
    'x-kh-generator': {
      version: 1,
      authoritativeSource: 'contracts/source/search-api.contract.mjs',
      appVersion: APP_VERSION,
      appOnlyRelease: true,
      customServerRequired: false,
      retryAfterAdvisoryOnly: true,
      localCooldownAllowed: false,
      maximumDirectSearchBackendsPerAction: 2,
      productHydrationFanOutAllowed: false
    }
  };
}
