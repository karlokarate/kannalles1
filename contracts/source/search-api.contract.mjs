/**
 * KH Checker canonical versioned data-gateway contract.
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
export const GATEWAY_API_VERSION = '1';

export const FoodUnitSchema = z
  .enum(['g', 'kg', 'ml', 'piece', 'bar', 'slice', 'portion', 'package'])
  .openapi('FoodUnit');

export const ApiBackendSchema = z
  .enum([
    'gateway',
    'search-index',
    'search-a-licious',
    'open-food-facts-legacy',
    'open-food-facts-v3',
    'open-food-facts-v2',
    'query-cache',
    'product-cache'
  ])
  .openapi('ApiBackend');

export const SearchApiModeSchema = z
  .enum(['auto', 'search-index', 'search-a-licious', 'legacy'])
  .openapi('SearchApiMode');

export const ProductApiModeSchema = z
  .enum(['hybrid', 'v3', 'v2'])
  .openapi('ProductApiMode');

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
    /** End-to-end freshness as presented to the current consumer. */
    cacheStatus: z.enum(['network', 'fresh-cache', 'stale-cache']),
    /** Layer that served this concrete response. */
    cacheLayer: z
      .enum([
        'none',
        'browser-memory',
        'browser-indexeddb',
        'browser-localstorage',
        'gateway-memory',
        'gateway-redis'
      ])
      .optional(),
    /** Gateway freshness retained when a browser cache wraps the response. */
    gatewayCacheStatus: z.enum(['network', 'fresh-cache', 'stale-cache']).optional(),
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
    carbohydrates_100g: z.number().finite().min(0).max(100).optional(),
    carbohydrates_100ml: z.number().finite().min(0).max(200).optional(),
    carbohydrates_serving: z.number().finite().nonnegative().optional(),
    carbohydrates_prepared_100g: z.number().finite().min(0).max(100).optional(),
    carbohydrates_prepared_100ml: z.number().finite().min(0).max(200).optional(),
    carbohydrates_prepared_serving: z.number().finite().nonnegative().optional()
  })
  .strict()
  .openapi('SearchNutriments');

export const SearchHitSchema = z
  .object({
    code: z.string().regex(/^\d{7,14}$/),
    product_name: z.string().max(500).optional(),
    product_name_de: z.string().max(500).optional(),
    product_name_en: z.string().max(500).optional(),
    generic_name: z.string().max(500).optional(),
    generic_name_de: z.string().max(500).optional(),
    generic_name_en: z.string().max(500).optional(),
    brands: z.union([z.string().max(500), z.array(z.string().max(120)).max(30)]).optional(),
    quantity: z.string().max(500).optional(),
    countries_tags: z.array(z.string()).optional(),
    categories_tags: z.array(z.string()).optional(),
    nutriments: SearchNutrimentsSchema.optional(),
    image_front_url: z.url().startsWith('https://images.openfoodfacts.org/').optional(),
    serving_size: z.string().max(500).optional(),
    serving_quantity: z.number().finite().optional(),
    product_quantity: z.number().finite().optional(),
    product_quantity_unit: z.string().max(500).optional(),
    nutrition_data_per: z.string().max(500).optional(),
    nutrition_data_prepared_per: z.string().max(500).optional(),
    data_quality_errors_tags: z.array(z.string()).optional(),
    unique_scans_n: z.number().finite().optional(),
    completeness: z.number().finite().optional(),
    _score: z.number().finite().optional()
  })
  .strict()
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
    api_meta: ApiResponseMetaSchema,
    source: z.enum(['gateway', 'search-index', 'search-a-licious', 'open-food-facts-legacy', 'none']),
    gateway_attempts: z.array(ApiAttemptDiagnosticSchema),
    query_used: z.string().min(1).max(120)
  })
  .strict()
  .openapi('SearchGatewayResponse');

export const OffProductSchema = z
  .object({
    code: z.string().regex(/^\d{7,14}$/),
    product_name: z.string().max(500).optional(),
    product_name_de: z.string().max(500).optional(),
    product_name_en: z.string().max(500).optional(),
    generic_name: z.string().max(500).optional(),
    generic_name_de: z.string().max(500).optional(),
    generic_name_en: z.string().max(500).optional(),
    brands: z.union([z.string().max(500), z.array(z.string().max(120)).max(30)]).optional(),
    quantity: z.string().max(500).optional(),
    product_quantity: z.number().finite().optional(),
    product_quantity_unit: z.string().max(500).optional(),
    serving_size: z.string().max(500).optional(),
    serving_quantity: z.number().finite().optional(),
    image_front_url: z.url().startsWith('https://images.openfoodfacts.org/').optional(),
    categories_tags: z.array(z.string()).optional(),
    countries_tags: z.array(z.string()).optional(),
    data_quality_errors_tags: z.array(z.string()).optional(),
    nutrition_data_per: z.string().max(500).optional(),
    nutrition_data_prepared_per: z.string().max(500).optional(),
    nutriments: SearchNutrimentsSchema.optional()
  })
  .strict()
  .openapi('OffProduct');

export const ProductGatewayResponseSchema = z
  .object({
    status: z.string().min(1),
    code: z.string().regex(/^\d{7,14}$/),
    product: OffProductSchema,
    api_meta: ApiResponseMetaSchema,
    gateway_attempts: z.array(ApiAttemptDiagnosticSchema)
  })
  .strict()
  .openapi('ProductGatewayResponse');

export const ApiErrorSchema = z
  .object({
    error: z.string().min(1),
    code: z.string().regex(/^[A-Z][A-Z0-9_]{1,79}$/),
    traceId: z.string().min(8),
    detail: z.string().optional(),
    attempts: z.array(ApiAttemptDiagnosticSchema).optional(),
    retryAt: z.iso.datetime().optional(),
    retryAllowedImmediately: z.boolean().optional(),
    query_requested: z.string().optional(),
    query_used: z.string().optional()
  })
  .strict()
  .openapi('ApiError');

const HealthCacheBackendSchema = z.object({
  requested: z.enum(['memory', 'redis']),
  effective: z.enum(['unknown', 'memory', 'redis']),
  connectivity: z.enum(['unknown', 'ready', 'unavailable']),
  degraded: z.boolean()
}).strict();

const healthResponseShape = {
  service: z.literal('kh-data-gateway'),
  apiVersion: z.literal(GATEWAY_API_VERSION),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  openaiConfigured: z.boolean(),
  searchIndexConfigured: z.boolean(),
  distributedCacheConfigured: z.boolean(),
  gatewayCacheEntries: z.number().int().nonnegative(),
  inFlightRequests: z.number().int().nonnegative(),
  build: z.object({
    runtime: z.literal('node'),
    commit: z.string().min(7).nullable(),
    builtAt: z.iso.datetime().nullable()
  }).strict(),
  capabilities: z.object({
    aiParse: z.boolean(),
    searchIndex: z.boolean(),
    offLegacyFallback: z.boolean(),
    offProductV3: z.boolean(),
    offProductV2: z.boolean(),
    distributedCoordination: z.boolean()
  }).strict(),
  components: z.object({
    aiParse: z.object({
      status: z.enum(['ready', 'disabled', 'unavailable']),
      reason: z.string().nullable()
    }).strict(),
    searchIndex: z.object({
      status: z.enum(['unknown', 'ready', 'disabled', 'unavailable']),
      reason: z.string().nullable()
    }).strict(),
    distributedCoordination: z.object({
      status: z.enum(['unknown', 'ready', 'disabled', 'unavailable']),
      reason: z.string().nullable()
    }).strict(),
    requestBudgets: z.object({
      status: z.enum(['ready', 'disabled', 'unavailable']),
      reason: z.string().nullable()
    }).strict(),
    offProductApi: z.object({
      status: z.enum(['unknown', 'ready', 'unavailable']),
      reason: z.string().nullable()
    }).strict()
  }).strict(),
  circuits: z.object({
    searchIndex: z.enum(['closed', 'open', 'half-open']),
    offLegacy: z.enum(['closed', 'open', 'half-open']),
    offProductV3: z.enum(['closed', 'open', 'half-open']),
    offProductV2: z.enum(['closed', 'open', 'half-open'])
  }).strict(),
  rateLimits: z.object({
    scope: z.enum(['instance', 'distributed']),
    searchIndexPerMinute: z.number().int().positive(),
    legacySearchPerMinute: z.number().int().positive(),
    productPerMinute: z.number().int().positive(),
    clientScoped: z.boolean(),
    clientSearchPerMinute: z.number().int().positive(),
    clientProductPerMinute: z.number().int().positive()
  }).strict()
};

export const HealthResponseSchema = z.discriminatedUnion('status', [
  z.object({
    ...healthResponseShape,
    ok: z.literal(true),
    ready: z.literal(true),
    status: z.literal('healthy'),
    cacheBackend: HealthCacheBackendSchema.extend({ degraded: z.literal(false) })
  }).strict(),
  z.object({
    ...healthResponseShape,
    ok: z.literal(true),
    ready: z.literal(true),
    status: z.literal('degraded'),
    cacheBackend: HealthCacheBackendSchema
  }).strict(),
  z.object({
    ...healthResponseShape,
    ok: z.literal(false),
    ready: z.literal(false),
    status: z.literal('unhealthy'),
    cacheBackend: HealthCacheBackendSchema
  }).strict()
]).openapi('HealthResponse');

export const AiParseRequestSchema = z
  .object({
    input: z.string().trim().min(1).max(200).regex(/\S/)
  })
  .strict()
  .openapi('AiParseRequest');

const aiAmountVariant = (unit, maximum) => z.object({
  value: z.number().positive().max(maximum),
  unit: z.literal(unit)
}).strict();

const AiParseAmountSchema = z.discriminatedUnion('unit', [
  aiAmountVariant('g', 100_000),
  aiAmountVariant('kg', 100),
  aiAmountVariant('ml', 100_000),
  aiAmountVariant('piece', 1_000),
  aiAmountVariant('bar', 1_000),
  aiAmountVariant('slice', 1_000),
  aiAmountVariant('portion', 1_000),
  aiAmountVariant('package', 1_000)
]);

const aiParseResponseShape = {
  status: z.enum(['parsed', 'needs_clarification', 'unsupported']),
  rawInput: z.string().trim().min(1).max(200).regex(/\S/),
  product: z
    .object({
      name: z.string().trim().min(1).max(120).regex(/\S/),
      brand: z.string().trim().min(1).max(80).nullable(),
      variant: z.string().trim().min(1).max(80).nullable()
    })
    .strict(),
  amount: AiParseAmountSchema,
  clarificationQuestion: z.string().trim().min(1).max(240).nullable(),
  parser: z.literal('openai')
};

export const AiParseResponseSchema = z
  .discriminatedUnion('resolutionMode', [
    z.object({
      ...aiParseResponseShape,
      resolutionMode: z.literal('generic_category'),
      barcode: z.null()
    }).strict(),
    z.object({
      ...aiParseResponseShape,
      resolutionMode: z.literal('exact_product'),
      barcode: z.null()
    }).strict(),
    z.object({
      ...aiParseResponseShape,
      resolutionMode: z.literal('barcode'),
      barcode: z.string().regex(/^\d{7,14}$/)
    }).strict()
  ])
  .openapi('AiParseResponse');

export const SearchQuerySchema = z
  .object({
    q: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .regex(/\S/)
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
      }),
    search_api: SearchApiModeSchema.default('auto').openapi({
      param: { name: 'search_api', in: 'query' },
      example: 'auto',
      description: 'auto nutzt den eigenen Index primär und OFF Legacy nur als Reserve.'
    })
  })
  .strict();

export const ProductPathSchema = z
  .object({
    code: z
      .string()
      .regex(/^\d{7,14}$/)
      .openapi({
        param: { name: 'code', in: 'path' },
        example: '1234567'
      })
  })
  .strict();

export const ProductQuerySchema = z
  .object({
    known_carbs: z
      .enum(['0', '1'])
      .default('0')
      .openapi({
        param: { name: 'known_carbs', in: 'query' },
        example: '1'
      }),
    product_api: ProductApiModeSchema.default('hybrid').openapi({
      param: { name: 'product_api', in: 'query' },
      example: 'hybrid'
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
  },
  413: {
    description: 'JSON-Request überschreitet das Gateway-Größenlimit',
    content: json(ApiErrorSchema)
  },
  504: {
    description: 'Die absolute Gateway-Deadline wurde überschritten',
    content: json(ApiErrorSchema)
  },
  500: {
    description: 'Unerwarteter interner Gateway-Fehler',
    content: json(ApiErrorSchema)
  }
};

export const healthRoute = createRoute({
  method: 'get',
  path: '/api/v1/health',
  tags: ['health'],
  operationId: 'gatewayHealth',
  summary: 'Status und Capabilities des Daten-Gateways lesen',
  responses: {
    200: {
      description: 'Gateway ist bereit oder kontrolliert degradiert',
      content: json(HealthResponseSchema)
    },
    503: {
      description: 'Gateway-Prozess lebt, ist aber nicht bereit',
      content: json(HealthResponseSchema)
    }
  }
});

export const searchRoute = createRoute({
  method: 'get',
  path: '/api/v1/search',
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
  path: '/api/v1/product/{code}',
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
  path: '/api/v1/ai/parse',
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
      ready: true,
      status: 'degraded',
      service: 'kh-data-gateway',
      apiVersion: GATEWAY_API_VERSION,
      version: APP_VERSION,
      openaiConfigured: false,
      searchIndexConfigured: false,
      distributedCacheConfigured: false,
      cacheBackend: {
        requested: 'memory', effective: 'memory', connectivity: 'ready', degraded: true
      },
      gatewayCacheEntries: 0,
      inFlightRequests: 0,
      build: { runtime: 'node', commit: null, builtAt: null },
      capabilities: {
        aiParse: false,
        searchIndex: false,
        offLegacyFallback: true,
        offProductV3: true,
        offProductV2: true,
        distributedCoordination: false
      },
      components: {
        aiParse: { status: 'disabled', reason: 'OPENAI_API_KEY is not configured' },
        searchIndex: { status: 'disabled', reason: 'SEARCH_INDEX_URL is not configured' },
        distributedCoordination: { status: 'disabled', reason: 'REDIS_COORDINATION_URL is not configured' },
        requestBudgets: { status: 'disabled', reason: 'Production client budgets are not required' },
        offProductApi: { status: 'ready', reason: null }
      },
      circuits: {
        searchIndex: 'closed',
        offLegacy: 'closed',
        offProductV3: 'closed',
        offProductV2: 'closed'
      },
      rateLimits: {
        scope: 'instance',
        searchIndexPerMinute: 60,
        legacySearchPerMinute: 10,
        productPerMinute: 15,
        clientScoped: false,
        clientSearchPerMinute: 6,
        clientProductPerMinute: 10
      }
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
      gateway_attempts: [],
      api_meta: {
        cacheStatus: 'network',
        cacheLayer: 'none',
        fetchedAt: '2026-01-01T00:00:00.000Z',
        sourceUrl: 'upstream://search-index/search',
        backend: 'gateway',
        originBackend: 'search-index'
      }
    },
    200
  );
});

gatewayContractApp.openapi(productRoute, (c) => {
  const { code } = c.req.valid('param');
  return c.json({
    status: 'success',
    code,
    product: { code },
    gateway_attempts: [],
    api_meta: {
      cacheStatus: 'network',
      cacheLayer: 'none',
      fetchedAt: '2026-01-01T00:00:00.000Z',
      sourceUrl: 'upstream://open-food-facts-v3/product',
      backend: 'gateway',
      originBackend: 'open-food-facts-v3'
    }
  }, 200);
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
      title: 'KH Checker data gateway API',
      version: APP_VERSION,
      description:
        'Kanonischer Vertrag des versionierten Daten-Gateways. Die statische PWA bleibt für manuelle und lokale Funktionen ohne Gateway nutzbar; globale Suche läuft ausschließlich über diese API.'
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
      gatewayApiVersion: GATEWAY_API_VERSION,
      authoritativeSource: 'contracts/source/search-api.contract.mjs',
      appVersion: APP_VERSION,
      deploymentMode: 'full-stack',
      gatewayRequiredForGlobalSearch: true,
      gatewayOptionalForManualAndOfflineUse: true,
      gatewayRuntime: 'node',
      browserUpstreamPolicy: 'gateway-only',
      legacyCompatibilityAliases: {
        '/api/health': '/api/v1/health',
        '/api/search': '/api/v1/search',
        '/api/product/{code}': '/api/v1/product/{code}',
        '/api/ai/parse': '/api/v1/ai/parse'
      },
      retryAfterAdvisoryOnly: true,
      localCooldownAllowed: false,
      maximumDirectSearchBackendsPerAction: 2,
      productHydrationFanOutAllowed: false
    }
  };
}
