#!/usr/bin/env node
import process from 'node:process';
import {
  APP_VERSION,
  GATEWAY_API_VERSION,
  HealthResponseSchema,
  ProductGatewayResponseSchema,
  SearchGatewayResponseSchema
} from '../contracts/source/search-api.contract.mjs';

const baseUrl = String(process.env.DATA_GATEWAY_URL || '').trim();
if (!baseUrl) throw new Error('DATA_GATEWAY_URL ist für den Gateway-Monitor erforderlich.');
const timeoutMs = Number(process.env.GATEWAY_MONITOR_TIMEOUT_MS || 15_000);
const base = new URL(baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash) {
  throw new Error('Gateway-Monitor verlangt eine öffentliche HTTPS-URL ohne Zugangsdaten, Query oder Fragment.');
}
async function request(pathname, schema) {
  const url = new URL(pathname.replace(/^\//, ''), base);
  const response = await fetch(url, {
    headers: { Accept: 'application/json' },
    redirect: 'error',
    signal: AbortSignal.timeout(timeoutMs)
  });
  const text = await response.text();
  const payload = schema.parse(JSON.parse(text));
  if (!response.ok) throw new Error(`${url} antwortete mit HTTP ${response.status}.`);
  return { data: payload, url: url.href };
}
const health = await request('/api/v1/health', HealthResponseSchema);
if (!health.data.ready) throw new Error(`Gateway ist nicht ready (${health.data.status}).`);
if (health.data.version !== APP_VERSION || health.data.apiVersion !== GATEWAY_API_VERSION) {
  throw new Error(
    `Deployed gateway ${health.data.version}/v${health.data.apiVersion} drifted from ${APP_VERSION}/v${GATEWAY_API_VERSION}.`
  );
}
if (!health.data.searchIndexConfigured || health.data.components.searchIndex.status !== 'ready') {
  throw new Error(`Eigener Suchindex ist laut Health nicht ready (${health.data.components.searchIndex.status}).`);
}
if (!health.data.capabilities.distributedCoordination
  || health.data.components.distributedCoordination.status !== 'ready') {
  throw new Error(
    `Verteilte Gateway-Koordination ist laut Health nicht ready (${health.data.components.distributedCoordination.status}).`
  );
}
if (!health.data.distributedCacheConfigured
  || health.data.cacheBackend.effective !== 'redis'
  || health.data.cacheBackend.connectivity !== 'ready') {
  throw new Error(`Verteilter Gateway-Cache ist nicht ready (${JSON.stringify(health.data.cacheBackend)}).`);
}
if (health.data.components.requestBudgets.status !== 'ready' || !health.data.rateLimits.clientScoped) {
  throw new Error('Produktions-Clientbudgets sind laut Health nicht ready.');
}

const report = {
  checkedAt: new Date().toISOString(),
  gateway: health.url,
  health: health.data.status,
  apiVersion: health.data.apiVersion,
  cacheBackend: health.data.cacheBackend,
  search: null,
  product: null
};

if (process.env.MONITOR_LIVE_SEARCH === '1') {
  const query = process.env.MONITOR_QUERY || 'Haferflocken';
  const params = new URLSearchParams({ q: query, page_size: '1', search_api: 'search-index' });
  const search = await request(`/api/v1/search?${params}`, SearchGatewayResponseSchema);
  report.search = { query, hits: search.data.hits.length, source: search.data.source };
  if (!search.data.hits.length
    || search.data.source !== 'search-index'
    || search.data.api_meta.originBackend !== 'search-index') {
    throw new Error(
      `Eigener Suchindex lieferte keine gültige Canary für ${JSON.stringify(query)} `
      + `(source=${search.data.source}, origin=${search.data.api_meta.originBackend}, hits=${search.data.hits.length}).`
    );
  }
}

const barcode = String(process.env.MONITOR_BARCODE || '').replace(/\D/g, '');
if (barcode) {
  const product = await request(
    `/api/v1/product/${barcode}?known_carbs=0&product_api=v3`,
    ProductGatewayResponseSchema
  );
  report.product = { barcode, status: product.data.status, found: Boolean(product.data.product) };
  if (!product.data.product) throw new Error(`Produktmonitor fand Barcode ${barcode} nicht.`);
}

console.log(JSON.stringify(report));
