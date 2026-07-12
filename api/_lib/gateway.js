import { readFileSync } from 'node:fs';
import {
  GatewayError,
  createGatewayCore,
  gatewayErrorPayload
} from '../../server/gateway-core/index.mjs';
import { ApiErrorSchema } from '../../server/generated/search-api.schemas.mjs';

const packageJson = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
const gateway = globalThis.__KH_SHARED_GATEWAY_CORE__ ?? createGatewayCore({
  version: String(packageJson.version)
});
globalThis.__KH_SHARED_GATEWAY_CORE__ = gateway;

function normalizeOrigin(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (raw === '*') return '*';
  try {
    return new URL(raw).origin;
  } catch {
    return raw.replace(/\/+$/, '');
  }
}

function corsDecision(req) {
  const requested = String(req?.headers?.origin || '').trim();
  const configured = String(process.env.CORS_ORIGINS || '').trim();
  if (!requested) return { allowed: true, origin: '' };
  const trustForwardedHeaders = process.env.TRUST_PROXY === '1';
  const forwardedProtocol = trustForwardedHeaders
    ? String(req?.headers?.['x-forwarded-proto'] || '').split(',', 1)[0].trim()
    : '';
  const protocol = forwardedProtocol || (req?.socket?.encrypted ? 'https' : 'http');
  const forwardedHost = trustForwardedHeaders
    ? String(req?.headers?.['x-forwarded-host'] || '').split(',', 1)[0].trim()
    : '';
  const host = String(forwardedHost || req?.headers?.host || '').split(',', 1)[0].trim();
  const normalized = normalizeOrigin(requested);
  if (host && normalized === normalizeOrigin(`${protocol}://${host}`)) {
    return { allowed: true, origin: normalized };
  }
  const allowed = new Set(configured.split(',').map(normalizeOrigin).filter(Boolean));
  const paidAiEndpoint = Boolean(String(process.env.OPENAI_API_KEY || '').trim())
    && /\/api\/(?:v1\/)?ai\/parse(?:[/?]|$)/.test(String(req?.url || req?.originalUrl || ''));
  // A wildcard may be useful for a deliberately public read gateway, but must
  // never turn the paid AI parser into an unauthenticated cross-origin relay.
  if (allowed.has('*') && !paidAiEndpoint) return { allowed: true, origin: '*' };
  return allowed.has(normalized)
    ? { allowed: true, origin: normalized }
    : { allowed: false, origin: '' };
}

export function setCors(res, req = res?.req) {
  const decision = corsDecision(req);
  if (decision.origin) res.setHeader('Access-Control-Allow-Origin', decision.origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader(
    'Access-Control-Expose-Headers',
    'Retry-After,X-KH-Gateway-Cache,X-KH-Gateway-Version,Deprecation,Link,Allow'
  );
  res.setHeader('Access-Control-Max-Age', '86400');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-KH-Gateway-Version', '1');
  return decision.allowed;
}

export function handleOptions(req, res) {
  const allowed = setCors(res, req);
  if (req.method !== 'OPTIONS') return false;
  if (!allowed) {
    sendHttpError(res, 403, 'Dieser Request-Origin ist nicht freigegeben.');
    return true;
  }
  res.status(204).end();
  return true;
}

export function markDeprecatedAlias(res, successorPath) {
  res.setHeader('Deprecation', 'true');
  res.setHeader('Link', `<${successorPath}>; rel="successor-version"`);
}

export function getGatewayCore() {
  return gateway;
}

export function gatewayHealth() {
  return gateway.health();
}

export function closeGateway() {
  return gateway.close();
}

export function searchThroughGateway(query, pageSize, options = {}) {
  return gateway.search(query, pageSize, options);
}

export function productThroughGateway(code, options = {}) {
  return gateway.product(code, options);
}

export function sendGatewayError(res, error, publicMessage, extra = {}, options = {}) {
  const payload = gatewayErrorPayload(error, publicMessage, { traceId: options.traceId });
  console.error('Gateway request failed', {
    traceId: payload.body.traceId,
    status: payload.status,
    code: typeof error?.code === 'string' ? error.code : 'UNEXPECTED_ERROR',
    name: error instanceof Error ? error.name : typeof error
  });
  if (error?.retryAt && Number.isFinite(Number(error.retryAt))) {
    const seconds = Math.max(1, Math.ceil((Number(error.retryAt) - Date.now()) / 1_000));
    res.setHeader('Retry-After', String(seconds));
  }
  res.setHeader('Cache-Control', 'no-store');
  const candidate = { ...payload.body, ...extra };
  const validated = ApiErrorSchema.safeParse(candidate);
  res.status(payload.status).json(validated.success
    ? validated.data
    : { error: publicMessage, code: 'GATEWAY_ERROR', traceId: payload.body.traceId });
}

export function sendHttpError(res, status, publicMessage, options = {}) {
  return sendGatewayError(
    res,
    new GatewayError(publicMessage, { status, code: `HTTP_${status}` }),
    publicMessage,
    {},
    options
  );
}
