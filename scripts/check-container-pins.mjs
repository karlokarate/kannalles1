#!/usr/bin/env node
import { readFile } from 'node:fs/promises';

const nodeImage = 'node:24.18.0-bookworm-slim@sha256:cb4e8f7c443347358b7875e717c29e27bf9befc8f5a26cf18af3c3dec80e58c5';
const runtimeImage = 'gcr.io/distroless/nodejs24-debian13:nonroot@sha256:70a2c12a0d76018b54d7bd01c5e3677632eeed9f890ba318d6db55fc54cf3baa';
const redisImage = 'redis:8.0.3-alpine@sha256:25c0ae32c6c2301798579f5944af53729766a18eff5660bbef196fc2e6214a9c';
const searchImage = 'ghcr.io/openfoodfacts/search-a-licious/search_service_image:sha-f7b32f29d6de5f17e2fe10bf6235de8e9ce7d32f@sha256:13ce9c2eeb13a3b4e75e1f79bcb4282733304bf0685111a7a255e3830cbd02ca';
const elasticImage = 'docker.elastic.co/elasticsearch/elasticsearch:8.3.3@sha256:caef7887384d9c77f309508ce72722bf21c7991d5fe81f23eaf843d1ca891fe4';
const searchFrontendImage = 'ghcr.io/openfoodfacts/search-a-licious/search_front_image:sha-f7b32f29d6de5f17e2fe10bf6235de8e9ce7d32f@sha256:62a710612af99adcb64359d53346e6658b683b9cfbe7058629a6b785798fd1ef';
const [dockerfile, compose, productionCompose, dockerIgnore, runtimePackage, runtimeLock] = await Promise.all([
  readFile(new URL('../Dockerfile', import.meta.url), 'utf8'),
  readFile(new URL('../compose.yml', import.meta.url), 'utf8'),
  readFile(new URL('../compose.production.yml', import.meta.url), 'utf8'),
  readFile(new URL('../.dockerignore', import.meta.url), 'utf8'),
  readFile(new URL('../deploy/runtime/package.json', import.meta.url), 'utf8').then(JSON.parse),
  readFile(new URL('../deploy/runtime/package-lock.json', import.meta.url), 'utf8').then(JSON.parse)
]);
if (dockerfile.split(nodeImage).length - 1 !== 2 || dockerfile.split(runtimeImage).length - 1 !== 1) {
  throw new Error('Build/dependency stages and the distroless runtime must use verified tag+digest references.');
}
if (compose.split(redisImage).length - 1 !== 2 || !productionCompose.includes(redisImage)) {
  throw new Error('Both gateway Redis roles and the search-update Redis must use the verified tag+digest.');
}
if (productionCompose.split(searchImage).length - 1 !== 2) {
  throw new Error('Search-a-licious API and updater must both use the verified tag+digest default.');
}
if (!productionCompose.includes('SEARCH_INDEX_URL: http://api:8000/search')
  || !productionCompose.includes('SEARCH_INDEX_ALLOW_INSECURE_HTTP: "1"')) {
  throw new Error('The internal clear-text search-index exception must be explicit and scoped to the production overlay.');
}
if (compose.includes('SEARCH_INDEX_ALLOW_INSECURE_HTTP')) {
  throw new Error('Base Compose must keep the production HTTPS search-index default.');
}
if (productionCompose.split(elasticImage).length - 1 !== 2) {
  throw new Error('Both required Elasticsearch nodes must use the verified multi-arch tag+digest.');
}
if (!productionCompose.includes(searchFrontendImage)
  || !/search_frontend:\s*[\s\S]*?profiles:\s*\[search-ui\]/.test(productionCompose)
  || !/elasticvue:\s*[\s\S]*?profiles:\s*\[search-admin\]/.test(productionCompose)) {
  throw new Error('Optional Search UI/admin services must be pinned or excluded from the production default via profiles.');
}
const trustProxyDefault = 'TRUST_PROXY: ' + '$' + '{TRUST_PROXY:-0}';
if (!compose.includes(trustProxyDefault)) {
  throw new Error('Compose must not trust forwarded headers by default.');
}
if (!compose.includes('REQUIRE_DISTRIBUTED_COORDINATION: "1"')) {
  throw new Error('Production Compose must require distributed coordination.');
}
for (const required of [
  'REDIS_COORDINATION_URL: redis://redis-coordination:6379/0',
  'REDIS_CACHE_URL: redis://redis-cache:6379/0',
  '$' + '{GATEWAY_CLIENT_SALT:?GATEWAY_CLIENT_SALT must contain at least 32 random characters}',
  '$' + '{CLIENT_SEARCH_RATE_LIMIT_PER_MINUTE:-6}',
  '$' + '{CLIENT_PRODUCT_RATE_LIMIT_PER_MINUTE:-10}',
  '$' + '{AI_PARSE_GLOBAL_RATE_LIMIT_PER_MINUTE:-30}',
  '$' + '{AI_PARSE_PER_USER_RATE_LIMIT_PER_MINUTE:-6}',
  '$' + '{AI_PARSE_GLOBAL_RATE_LIMIT_PER_DAY:-300}',
  '$' + '{AI_PARSE_PER_USER_RATE_LIMIT_PER_DAY:-30}',
  '$' + '{OPENAI_MODEL:-gpt-5.6-luna}',
  '$' + '{OPENAI_MAX_OUTPUT_TOKENS:-512}',
  '$' + '{OPENAI_REASONING_EFFORT:-none}',
  '$' + '{REDIS_COORDINATION_MAXMEMORY:-64mb}',
  '--maxmemory-policy", "noeviction',
  '$' + '{REDIS_CACHE_MAXMEMORY:-256mb}',
  '--maxmemory-policy", "allkeys-lru'
]) {
  if (!compose.includes(required)) throw new Error(`Redis role-isolation default missing: ${required}`);
}
for (const required of [
  'profiles: [search-updates]',
  'REDIS_HOST: search-updates-redis',
  'CONFIG_PATH: /opt/search/data/config/openfoodfacts.yml',
  'search-updates-redis:/data'
]) {
  if (!productionCompose.includes(required)) throw new Error(`Search-update isolation default missing: ${required}`);
}
if (!dockerfile.includes('COPY --from=build /app/api ./api')) {
  throw new Error('Runtime image is missing the API adapters imported by server/index.mjs.');
}
if (!dockerfile.includes('COPY --from=runtime-deps --chown=65532:65532 /app/package.json ./package.json')
  || !dockerfile.includes('COPY --from=runtime-deps --chown=65532:65532 /app/node_modules ./node_modules')
  || !dockerfile.includes('CMD ["server/index.mjs"]')
  || dockerfile.includes('USER node')) {
  throw new Error('Runtime must copy only production dependencies into the pinned nonroot distroless image.');
}
if (!dockerfile.includes('COPY deploy/runtime/package.json deploy/runtime/package-lock.json ./')
  || dockerfile.includes('COPY --from=build /app/contracts/source')) {
  throw new Error('Runtime image must use the minimal locked runtime package and standalone generated schemas.');
}
const expectedRuntimeDependencies = ['dotenv', 'express', 'openai', 'redis', 'zod'];
const runtimeDependencies = Object.keys(runtimePackage.dependencies ?? {}).sort();
if (JSON.stringify(runtimeDependencies) !== JSON.stringify(expectedRuntimeDependencies)) {
  throw new Error(`Unexpected runtime dependency surface: ${runtimeDependencies.join(', ')}`);
}
for (const forbidden of ['@hono/zod-openapi', 'hono', 'lucide-react', 'react', 'react-dom']) {
  if (runtimeLock.packages?.[`node_modules/${forbidden}`]) {
    throw new Error(`Generator/frontend-only dependency leaked into runtime lock: ${forbidden}`);
  }
}
if (runtimeLock.packages?.['']?.version !== runtimePackage.version
  || JSON.stringify(runtimeLock.packages?.['']?.dependencies ?? {}) !== JSON.stringify(runtimePackage.dependencies)) {
  throw new Error('Runtime package-lock root does not match deploy/runtime/package.json.');
}
for (const excluded of ['.git', '.codex', '.env.*', 'node_modules', 'release-out', '*.zip']) {
  if (!dockerIgnore.split(/\r?\n/).includes(excluded)) {
    throw new Error(`Docker build context exclusion missing: ${excluded}`);
  }
}
console.log(JSON.stringify({
  containerPins: 'verified', nodeImage, runtimeImage, redisImage, searchImage,
  elasticImage, searchFrontendImage,
  redisRoles: { coordination: 'noeviction', cache: 'allkeys-lru', searchUpdates: 'noeviction' }
}));
