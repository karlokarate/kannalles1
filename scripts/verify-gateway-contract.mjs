#!/usr/bin/env node
import process from 'node:process';
import {
  APP_VERSION,
  GATEWAY_API_VERSION,
  HealthResponseSchema,
  ProductGatewayResponseSchema,
  SearchGatewayResponseSchema
} from '../contracts/source/search-api.contract.mjs';

const argumentIndex = process.argv.indexOf('--url');
const configured = argumentIndex >= 0
  ? process.argv[argumentIndex + 1]
  : process.env.DATA_GATEWAY_URL || '';
const required = process.argv.includes('--require');
const timeoutMs = Number(process.env.GATEWAY_CONTRACT_TIMEOUT_MS || 15_000);

if (!configured.trim()) {
  if (required) throw new Error('DATA_GATEWAY_URL fehlt, obwohl ein Full-App-Live-Gate verlangt wurde.');
  console.log(JSON.stringify({ gatewayContract: 'skipped', reason: 'no gateway configured' }));
  process.exit(0);
}

const base = new URL(configured);
if (base.username || base.password || base.search || base.hash) {
  throw new Error('DATA_GATEWAY_URL darf keine Zugangsdaten, Query oder Fragment enthalten.');
}
const loopback = base.protocol === 'http:' && ['127.0.0.1', 'localhost', '::1'].includes(base.hostname);
if (base.protocol !== 'https:' && !(loopback && !required)) {
  throw new Error(required
    ? 'Das Full-App-Live-Gate verlangt ein HTTPS-Gateway.'
    : 'DATA_GATEWAY_URL muss HTTPS verwenden; HTTP ist nur für lokale, nicht verpflichtende Prüfungen erlaubt.');
}
const root = new URL(base.href.endsWith('/') ? base.href : `${base.href}/`);

async function request(pathname, schema, expectedStatus = 200) {
  const url = new URL(pathname.replace(/^\//u, ''), root);
  const response = await fetch(url, {
    headers: { Accept: 'application/json' },
    redirect: 'error',
    signal: AbortSignal.timeout(timeoutMs)
  });
  const responseText = await response.text();
  let json;
  try {
    json = JSON.parse(responseText);
  } catch (cause) {
    throw new Error(`${url.href} ist kein JSON (HTTP ${response.status}).`, { cause });
  }
  if (response.status !== expectedStatus) {
    throw new Error(`${url.href} antwortete mit HTTP ${response.status} statt ${expectedStatus}.`);
  }
  return { data: schema.parse(json), url: url.href };
}

const healthResult = await request('/api/v1/health', HealthResponseSchema);
const health = healthResult.data;
if (!health.ready || !health.ok) throw new Error(`Gateway ist nicht ready (${health.status}).`);
if (health.version !== APP_VERSION || health.apiVersion !== GATEWAY_API_VERSION) {
  throw new Error(`Gateway-Version ${health.version}/v${health.apiVersion} passt nicht zu ${APP_VERSION}/v${GATEWAY_API_VERSION}.`);
}

let search = null;
let product = null;
if (required) {
  const failures = [];
  if (!health.distributedCacheConfigured) failures.push('distributedCacheConfigured=false');
  if (!health.searchIndexConfigured) failures.push('searchIndexConfigured=false');
  if (!health.capabilities.distributedCoordination) failures.push('distributedCoordination capability=false');
  if (!health.capabilities.searchIndex) failures.push('searchIndex capability=false');
  if (health.components.distributedCoordination.status !== 'ready') {
    failures.push(`distributedCoordination=${health.components.distributedCoordination.status}`);
  }
  if (health.components.searchIndex.status !== 'ready') {
    failures.push(`searchIndex=${health.components.searchIndex.status}`);
  }
  if (health.components.requestBudgets.status !== 'ready' || !health.rateLimits.clientScoped) {
    failures.push(`requestBudgets=${health.components.requestBudgets.status}/clientScoped=${health.rateLimits.clientScoped}`);
  }
  if (health.cacheBackend.requested !== 'redis'
    || health.cacheBackend.effective !== 'redis'
    || health.cacheBackend.connectivity !== 'ready'
    || health.cacheBackend.degraded) {
    failures.push(`cacheBackend=${JSON.stringify(health.cacheBackend)}`);
  }
  if (health.rateLimits.scope !== 'distributed') failures.push(`rateLimits.scope=${health.rateLimits.scope}`);
  if (failures.length) throw new Error(`Full-App-Gateway ist nicht produktionsbereit: ${failures.join(', ')}.`);

  const query = String(process.env.GATEWAY_CONTRACT_QUERY || 'Haferflocken').trim();
  if (!query || query.length > 120) throw new Error('GATEWAY_CONTRACT_QUERY muss 1 bis 120 Zeichen enthalten.');
  const params = new URLSearchParams({ q: query, page_size: '1', search_api: 'search-index' });
  const searchResult = await request(`/api/v1/search?${params}`, SearchGatewayResponseSchema);
  if (searchResult.data.source !== 'search-index'
    || searchResult.data.api_meta.originBackend !== 'search-index'
    || searchResult.data.hits.length < 1) {
    throw new Error(
      `Eigener-Index-Canary ungültig: source=${searchResult.data.source}, `
      + `origin=${searchResult.data.api_meta.originBackend}, hits=${searchResult.data.hits.length}.`
    );
  }
  search = { url: searchResult.url, query, hits: searchResult.data.hits.length, source: searchResult.data.source };

  const barcodeRaw = String(process.env.GATEWAY_CONTRACT_BARCODE || '').trim();
  if (barcodeRaw) {
    if (!/^\d{7,14}$/u.test(barcodeRaw)) {
      throw new Error('GATEWAY_CONTRACT_BARCODE muss aus 7 bis 14 Ziffern bestehen.');
    }
    const productResult = await request(
      `/api/v1/product/${barcodeRaw}?known_carbs=0&product_api=v3`,
      ProductGatewayResponseSchema
    );
    if (!productResult.data.product || productResult.data.code !== barcodeRaw) {
      throw new Error(`Produkt-Canary ${barcodeRaw} lieferte kein passendes Produkt.`);
    }
    product = { url: productResult.url, barcode: barcodeRaw, found: true };
  }
}

console.log(JSON.stringify({
  gatewayContract: 'valid',
  deploymentReadiness: required ? 'full-app-ready' : 'contract-valid',
  url: healthResult.url,
  httpStatus: 200,
  status: health.status,
  ready: health.ready,
  apiVersion: health.apiVersion,
  appVersion: health.version,
  cacheBackend: health.cacheBackend,
  capabilities: health.capabilities,
  search,
  product
}));
