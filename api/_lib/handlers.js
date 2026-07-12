import {
  HealthResponseSchema,
  ProductPathSchema,
  ProductQuerySchema,
  ProductGatewayResponseSchema,
  SearchQuerySchema,
  SearchGatewayResponseSchema
} from '../../server/generated/search-api.schemas.mjs';
import {
  gatewayHealth,
  handleOptions,
  markDeprecatedAlias,
  productThroughGateway,
  searchThroughGateway,
  sendGatewayError,
  sendHttpError,
  setCors
} from './gateway.js';
import { clientBudgetIdentifierForRequest } from './client-identity.js';

function cacheHeaders(res, payload) {
  // Explicit browser persistence is owned by the consent-aware repository.
  // Shared HTTP/CDN caches must never retain user queries or bypass opt-out.
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-KH-Gateway-Cache', payload.api_meta?.cacheStatus || 'network');
}

function prepare(req, res, { deprecated, successorPath } = {}) {
  if (handleOptions(req, res)) return false;
  if (!setCors(res, req)) {
    sendHttpError(res, 403, 'Dieser Request-Origin ist nicht freigegeben.');
    return false;
  }
  if (deprecated) markDeprecatedAlias(res, successorPath);
  return true;
}

function methodNotAllowed(res, allow) {
  res.setHeader('Allow', allow);
  return sendHttpError(res, 405, 'Method not allowed');
}

export async function healthHandler(req, res, options = {}) {
  if (!prepare(req, res, options)) return;
  if (req.method !== 'GET') return methodNotAllowed(res, 'GET, OPTIONS');
  res.setHeader('Cache-Control', 'no-store');
  try {
    const payload = HealthResponseSchema.parse(await gatewayHealth());
    return res.status(payload.ready ? 200 : 503).json(payload);
  } catch (error) {
    return sendGatewayError(res, error, 'Gateway-Healthcheck fehlgeschlagen.');
  }
}

export async function searchHandler(req, res, options = {}) {
  if (!prepare(req, res, options)) return;
  if (req.method !== 'GET') return methodNotAllowed(res, 'GET, OPTIONS');
  const requestQuery = SearchQuerySchema.safeParse(req.query || {});
  if (!requestQuery.success) return sendHttpError(res, 400, 'Ungültige Suchparameter.');
  const requestedQuery = requestQuery.data.q;
  try {
    const payload = SearchGatewayResponseSchema.parse(
      await searchThroughGateway(requestedQuery, requestQuery.data.page_size, {
        searchApiMode: requestQuery.data.search_api,
        clientKey: clientBudgetIdentifierForRequest(req)
      })
    );
    cacheHeaders(res, payload);
    return res.status(200).json(payload);
  } catch (error) {
    return sendGatewayError(res, error, 'Produktsuche vorübergehend nicht verfügbar.', {
      query_requested: String(requestedQuery || ''),
      retryAllowedImmediately: true
    });
  }
}

export async function productHandler(req, res, options = {}) {
  if (!prepare(req, res, options)) return;
  if (req.method !== 'GET') return methodNotAllowed(res, 'GET, OPTIONS');
  const rawQuery = { ...(req.query || {}) };
  const code = rawQuery.code ?? req.params?.code;
  delete rawQuery.code;
  const [pathResult, queryResult] = [
    ProductPathSchema.safeParse({ code: String(code || '') }),
    ProductQuerySchema.safeParse(rawQuery)
  ];
  if (!pathResult.success || !queryResult.success) {
    return sendHttpError(res, 400, 'Ungültige Produktparameter.');
  }
  try {
    const payload = ProductGatewayResponseSchema.parse(await productThroughGateway(pathResult.data.code, {
      knownCarbohydrates: queryResult.data.known_carbs === '1',
      productApiMode: queryResult.data.product_api,
      clientKey: clientBudgetIdentifierForRequest(req)
    }));
    cacheHeaders(res, payload);
    return res.status(200).json(payload);
  } catch (error) {
    return sendGatewayError(res, error, 'Produktabruf fehlgeschlagen.');
  }
}
