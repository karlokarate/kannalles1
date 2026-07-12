import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const EXPECTED_COMMIT = 'f7b32f29d6de5f17e2fe10bf6235de8e9ce7d32f';
const EXPECTED_IMAGE_TAG = `sha-${EXPECTED_COMMIT}`;
const EXPECTED_IMAGE_DIGEST = 'sha256:13ce9c2eeb13a3b4e75e1f79bcb4282733304bf0685111a7a255e3830cbd02ca';
const EXPECTED_IMAGE_REFERENCE = `ghcr.io/openfoodfacts/search-a-licious/search_service_image:${EXPECTED_IMAGE_TAG}@${EXPECTED_IMAGE_DIGEST}`;
const EXPECTED_ELASTIC_REFERENCE = 'docker.elastic.co/elasticsearch/elasticsearch:8.3.3@sha256:caef7887384d9c77f309508ce72722bf21c7991d5fe81f23eaf843d1ca891fe4';
const EXPECTED_UPSTREAM_SHA256 = '3802d6ce3d3e4ca7123bbfbb14989b2e1adcc6af49ac392f71f2c1f698bf715d';
const EXPECTED_CORRECTED_SHA256 = '7f8e5b2f62a84861d3f15742696a5538dda2f530e071eaba5467e845abb68e2f';
const args = new Set(process.argv.slice(2));
const fix = args.has('--fix');
const staticOnly = args.has('--static');
const checkout = path.resolve(process.env.SEARCH_A_LICIOUS_DIR || '../search-a-licious');
const configPath = path.join(checkout, 'data', 'config', 'openfoodfacts.yml');
const configRelativePath = 'data/config/openfoodfacts.yml';
const root = path.resolve(import.meta.dirname, '..', '..');

function sha256(value) {
  return createHash('sha256').update(value.replace(/\r\n?/g, '\n')).digest('hex');
}

if (staticOnly) {
  const [overlay, documentation, patch] = await Promise.all([
    readFile(path.join(root, 'compose.production.yml'), 'utf8'),
    readFile(path.join(import.meta.dirname, 'README.md'), 'utf8'),
    readFile(path.join(import.meta.dirname, 'openfoodfacts-countries-input.patch'), 'utf8')
  ]);
  for (const required of [
    EXPECTED_COMMIT,
    EXPECTED_IMAGE_TAG,
    EXPECTED_IMAGE_DIGEST,
    EXPECTED_IMAGE_REFERENCE,
    EXPECTED_ELASTIC_REFERENCE,
    EXPECTED_UPSTREAM_SHA256,
    EXPECTED_CORRECTED_SHA256
  ]) {
    if (!documentation.includes(required)) throw new Error(`Search-index documentation is missing evidence ${required}.`);
  }
  if (!overlay.includes('SEARCH_A_LICIOUS_DIR')
    || !overlay.includes('SEARCH_INDEX_URL: http://api:8000/search')
    || !overlay.includes('SEARCH_INDEX_ALLOW_INSECURE_HTTP: "1"')) {
    throw new Error('Production Compose overlay is not wired to the pinned self-hosted search service.');
  }
  if (overlay.split(EXPECTED_IMAGE_REFERENCE).length - 1 !== 2) {
    throw new Error('Production Compose must pin both Search-a-licious API and updater by exact tag+digest.');
  }
  if (!overlay.includes('SEARCH_A_LICIOUS_API_IMAGE')) {
    throw new Error('Production Compose is missing the explicit ARM64/custom immutable image override.');
  }
  if (overlay.split(EXPECTED_ELASTIC_REFERENCE).length - 1 !== 2) {
    throw new Error('Both required Elasticsearch services must be pinned by the verified multi-arch digest.');
  }
  if (!/search_frontend:\s*[\s\S]*?profiles:\s*\[search-ui\]/.test(overlay)
    || !/elasticvue:\s*[\s\S]*?profiles:\s*\[search-admin\]/.test(overlay)) {
    throw new Error('Unneeded Search-a-licious UI/admin services must be outside the production default profile.');
  }
  if (!/updater:\s*[\s\S]*?profiles:\s*\[search-updates\]/.test(overlay)
    || !overlay.includes('REDIS_HOST: search-updates-redis')
    || !overlay.includes('CONFIG_PATH: /opt/search/data/config/openfoodfacts.yml')
    || !overlay.includes('search-updates-redis:/data')) {
    throw new Error('Search update ingestion must be explicit, deterministic and isolated from gateway Redis.');
  }
  if (!patch.includes('-        input_field: conutries_tags') || !patch.includes('+        input_field: countries_tags')) {
    throw new Error('Versioned countries mapping patch is missing or ambiguous.');
  }
  console.log(JSON.stringify({
    searchIndexStaticPreflight: 'ok',
    commit: EXPECTED_COMMIT,
    imageTag: EXPECTED_IMAGE_TAG,
    imageDigest: EXPECTED_IMAGE_DIGEST,
    imageReference: EXPECTED_IMAGE_REFERENCE,
    elasticReference: EXPECTED_ELASTIC_REFERENCE,
    upstreamSha256: EXPECTED_UPSTREAM_SHA256,
    correctedSha256: EXPECTED_CORRECTED_SHA256
  }));
  process.exit(0);
}

const revision = spawnSync('git', ['-C', checkout, 'rev-parse', 'HEAD'], {
  encoding: 'utf8',
  windowsHide: true
});
if (revision.status !== 0 || revision.stdout.trim() !== EXPECTED_COMMIT) {
  throw new Error(`Search-a-licious checkout must be pinned to ${EXPECTED_COMMIT}.`);
}

function gitOutput(arguments_, label) {
  const result = spawnSync('git', ['-C', checkout, ...arguments_], {
    encoding: 'utf8', windowsHide: true
  });
  if (result.status !== 0) throw new Error(`${label} failed: ${(result.stderr || result.stdout).trim()}`);
  return result.stdout.replace(/\r\n?/g, '\n');
}

function checkoutStatus() {
  const output = gitOutput(['status', '--porcelain=v1', '--untracked-files=all'], 'git status');
  return output.replace(/\n+$/, '').split('\n').filter(Boolean);
}

function assertExpectedCheckoutStatus({ allowClean }) {
  const lines = checkoutStatus();
  if (allowClean && lines.length === 0) return 'clean';
  const expected = lines.length === 1
    && /^[ MARC?DUT]{2} data\/config\/openfoodfacts\.yml$/.test(lines[0]);
  if (!expected) {
    throw new Error(`Search-a-licious checkout is dirty outside the one versioned config patch: ${lines.join(' | ') || '(clean)'}.`);
  }
  return 'patched';
}

let checkoutState = assertExpectedCheckoutStatus({ allowClean: true });

const envPath = path.resolve(process.env.SEARCH_A_LICIOUS_ENV || path.join(checkout, '.env'));
const envText = await readFile(envPath, 'utf8').catch(() => {
  throw new Error(`Search-a-licious environment file is missing: ${envPath}.`);
});
function environmentValue(name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return envText.match(new RegExp(`^\\s*${escaped}\\s*=\\s*['"]?([^\\s'"#]+)['"]?\\s*(?:#.*)?$`, 'm'))?.[1] ?? '';
}
if (environmentValue('TAG') !== EXPECTED_IMAGE_TAG) {
  throw new Error(`Search-a-licious TAG must equal ${EXPECTED_IMAGE_TAG}; dev/latest/raw commit are forbidden.`);
}
for (const [name, expectation] of [
  ['RESTART_POLICY', (value) => value === 'always'],
  ['MEM_LIMIT', (value) => /^\d+$/.test(value) && Number(value) >= 2_147_483_648],
  ['STACK_VERSION', (value) => value === '8.3.3'],
  ['CLUSTER_NAME', (value) => Boolean(value)],
  ['COMMON_NET_NAME', (value) => Boolean(value)]
]) {
  const value = environmentValue(name);
  if (!expectation(value)) throw new Error(`Search-a-licious environment value ${name} is missing or unsafe.`);
}

let config = await readFile(configPath, 'utf8');
const typo = 'input_field: conutries_tags';
const corrected = 'input_field: countries_tags';
const typoCount = config.split(typo).length - 1;
if (typoCount > 1) throw new Error('Unexpected duplicate countries input_field typo in upstream config.');
if (typoCount === 1) {
  if (checkoutState !== 'clean') {
    throw new Error('The upstream config has its original content but the checkout is dirty; refusing an ambiguous patch state.');
  }
  const upstreamHash = sha256(config);
  if (upstreamHash !== EXPECTED_UPSTREAM_SHA256) {
    throw new Error(`Pinned upstream config hash mismatch: ${upstreamHash}.`);
  }
  if (!fix) {
    throw new Error('Upstream countries mapping is broken. Re-run with --fix before import/start.');
  }
  config = config.replace(typo, corrected);
  await writeFile(configPath, config, 'utf8');
  checkoutState = assertExpectedCheckoutStatus({ allowClean: false });
}

if (!/countries:\s*[\s\S]{0,160}input_field:\s*countries_tags/.test(config)) {
  throw new Error('Correct countries -> countries_tags mapping not found in openfoodfacts.yml.');
}
const correctedHash = sha256(config);
if (correctedHash !== EXPECTED_CORRECTED_SHA256) {
  throw new Error(`Corrected config hash mismatch: ${correctedHash}.`);
}
if (checkoutState !== 'patched') {
  throw new Error('Corrected config is not represented by the sole expected Git worktree patch.');
}
const actualDiff = gitOutput(['diff', '--no-ext-diff', '--no-color', '--', configRelativePath], 'git diff')
  .replace(/\n+$/, '');
const expectedDiff = (await readFile(path.join(import.meta.dirname, 'openfoodfacts-countries-input.patch'), 'utf8'))
  .replace(/\r\n?/g, '\n')
  .replace(/\n+$/, '');
if (actualDiff !== expectedDiff) {
  throw new Error('Search-a-licious config diff does not exactly match the versioned countries patch.');
}

const composeResult = spawnSync('docker', [
  'compose', '--project-directory', root,
  '-f', path.join(root, 'compose.yml'),
  '-f', path.join(root, 'compose.production.yml'),
  'config', '--format', 'json'
], {
  cwd: root,
  encoding: 'utf8',
  windowsHide: true,
  env: {
    ...process.env,
    SEARCH_A_LICIOUS_DIR: checkout,
    SEARCH_A_LICIOUS_ENV: envPath
  }
});
if (composeResult.error?.code === 'ENOENT') {
  throw new Error('Docker Compose is required for the final search-index topology preflight.');
}
if (composeResult.status !== 0) {
  throw new Error(`Docker Compose topology resolution failed: ${(composeResult.stderr || composeResult.stdout).trim()}`);
}
let topology;
try {
  topology = JSON.parse(composeResult.stdout);
} catch (cause) {
  throw new Error('Docker Compose returned invalid topology JSON.', { cause });
}

const composeWithUpdatesResult = spawnSync('docker', [
  'compose', '--profile', 'search-updates', '--project-directory', root,
  '-f', path.join(root, 'compose.yml'),
  '-f', path.join(root, 'compose.production.yml'),
  'config', '--format', 'json'
], {
  cwd: root,
  encoding: 'utf8',
  windowsHide: true,
  env: {
    ...process.env,
    SEARCH_A_LICIOUS_DIR: checkout,
    SEARCH_A_LICIOUS_ENV: envPath
  }
});
if (composeWithUpdatesResult.status !== 0) {
  throw new Error(`Search-update profile resolution failed: ${(composeWithUpdatesResult.stderr || composeWithUpdatesResult.stdout).trim()}`);
}
let updateTopology;
try {
  updateTopology = JSON.parse(composeWithUpdatesResult.stdout);
} catch (cause) {
  throw new Error('Docker Compose returned invalid search-update topology JSON.', { cause });
}

function exactNames(value, expected, label) {
  const actual = Object.keys(value ?? {}).sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
    throw new Error(`${label} allowlist mismatch: ${actual.join(', ')}`);
  }
}

const services = topology.services ?? {};
exactNames(services, [
  'api', 'es01', 'es02', 'gateway', 'redis-cache', 'redis-coordination', 'search-updates-redis'
], 'Default Compose services');
const updateServices = updateTopology.services ?? {};
exactNames(updateServices, [
  'api', 'es01', 'es02', 'gateway', 'redis-cache', 'redis-coordination', 'search-updates-redis', 'updater'
], 'Search-update profile services');
exactNames(topology.networks, ['common_net', 'default'], 'Compose networks');
exactNames(topology.volumes, [
  'es_synonyms', 'esdata01', 'esdata02', 'gateway-coordination-redis', 'search-updates-redis'
], 'Compose volumes');
const allowedNetworks = {
  api: ['common_net', 'default'],
  es01: ['default'], es02: ['default'], gateway: ['default'],
  'redis-cache': ['default'], 'redis-coordination': ['default'],
  'search-updates-redis': ['common_net']
};
for (const [service, networks] of Object.entries(allowedNetworks)) {
  exactNames(services[service]?.networks, networks, `${service} networks`);
}
exactNames(updateServices.updater?.networks, ['common_net', 'default'], 'updater networks');
for (const [name, service] of Object.entries(updateServices)) {
  const ports = service.ports ?? [];
  if (name !== 'gateway' && ports.length !== 0) {
    throw new Error(`Only the gateway may publish a port; ${name} publishes ${ports.length}.`);
  }
}
const gatewayPorts = services.gateway?.ports ?? [];
if (gatewayPorts.length !== 1
  || Number(gatewayPorts[0].target) !== 8787
  || Number(gatewayPorts[0].published) !== 8787
  || !['127.0.0.1', '0.0.0.0', '::1'].includes(String(gatewayPorts[0].host_ip))) {
  throw new Error('Gateway port topology must expose only 8787 on an explicit host address.');
}
const immutableServices = [
  'api', 'es01', 'es02', 'redis-cache', 'redis-coordination', 'search-updates-redis'
];
for (const service of immutableServices) {
  if (!/^[^\s]+@sha256:[a-f0-9]{64}$/.test(String(services[service]?.image ?? ''))) {
    throw new Error(`${service} image must resolve to an immutable sha256 digest.`);
  }
}
if (!/^[^\s]+@sha256:[a-f0-9]{64}$/.test(String(updateServices.updater?.image ?? ''))) {
  throw new Error('updater image must resolve to an immutable sha256 digest.');
}
if (services.api.image !== updateServices.updater.image) {
  throw new Error('Search-a-licious API and updater must use the identical immutable image.');
}
if (services.es01.image !== services.es02.image) {
  throw new Error('Both Elasticsearch nodes must use the identical immutable image.');
}
const gatewayBuildContext = path.resolve(String(services.gateway?.build?.context ?? ''));
if (gatewayBuildContext.toLowerCase() !== root.toLowerCase()) {
  throw new Error(`Gateway build context escaped the audited repository: ${gatewayBuildContext}.`);
}
const gatewayEnvironment = services.gateway?.environment ?? {};
if (gatewayEnvironment.SEARCH_INDEX_URL !== 'http://api:8000/search'
  || String(gatewayEnvironment.SEARCH_INDEX_ALLOW_INSECURE_HTTP) !== '1'
  || String(gatewayEnvironment.REQUIRE_DISTRIBUTED_COORDINATION) !== '1'
  || String(gatewayEnvironment.TRUST_PROXY) !== '0'
  || String(gatewayEnvironment.GATEWAY_CLIENT_SALT ?? '').length < 32
  || String(gatewayEnvironment.CLIENT_SEARCH_RATE_LIMIT_PER_MINUTE) !== '6'
  || String(gatewayEnvironment.CLIENT_PRODUCT_RATE_LIMIT_PER_MINUTE) !== '10'
  || gatewayEnvironment.REDIS_COORDINATION_URL !== 'redis://redis-coordination:6379/0'
  || gatewayEnvironment.REDIS_CACHE_URL !== 'redis://redis-cache:6379/0'
  || Object.hasOwn(gatewayEnvironment, 'REDIS_URL')) {
  throw new Error('Gateway production security environment drifted from the internal-index/Redis/trust-proxy contract.');
}
if (gatewayEnvironment.REDIS_COORDINATION_URL === gatewayEnvironment.REDIS_CACHE_URL) {
  throw new Error('Gateway coordination and cache Redis URLs must be distinct.');
}
const apiEnvironment = services.api?.environment ?? {};
const updaterEnvironment = updateServices.updater?.environment ?? {};
for (const [name, environment] of [['api', apiEnvironment], ['updater', updaterEnvironment]]) {
  if (environment.REDIS_HOST !== 'search-updates-redis'
    || String(environment.REDIS_PORT) !== '6379'
    || environment.CONFIG_PATH !== '/opt/search/data/config/openfoodfacts.yml'
    || environment.ELASTICSEARCH_URL !== 'http://es01:9200') {
    throw new Error(`${name} must use the deterministic isolated Search-a-licious runtime environment.`);
  }
}
const commandText = (service) => (service?.command ?? []).join(' ');
if (!commandText(services['redis-coordination']).includes('--maxmemory-policy noeviction')
  || !commandText(services['redis-cache']).includes('--maxmemory-policy allkeys-lru')
  || !commandText(services['search-updates-redis']).includes('--maxmemory-policy noeviction')) {
  throw new Error('Resolved Redis services do not preserve their distinct eviction policies.');
}

console.log(JSON.stringify({
  searchIndexPreflight: 'ok',
  commit: EXPECTED_COMMIT,
  imageTag: EXPECTED_IMAGE_TAG,
  imageDigest: EXPECTED_IMAGE_DIGEST,
  imageReference: EXPECTED_IMAGE_REFERENCE,
  elasticReference: EXPECTED_ELASTIC_REFERENCE,
  countriesInputField: 'countries_tags',
  upstreamSha256: EXPECTED_UPSTREAM_SHA256,
  correctedSha256: correctedHash,
  modified: typoCount === 1 && fix,
  composeServices: Object.keys(services).sort(),
  optionalSearchUpdateServices: Object.keys(updateServices).filter((name) => !Object.hasOwn(services, name)).sort(),
  publishedPort: `${gatewayPorts[0].host_ip}:8787`
}));
