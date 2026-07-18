#!/usr/bin/env node
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';

const root = path.resolve(import.meta.dirname, '..');
const workflowDir = path.join(root, '.github/workflows');
const e2eDir = path.join(root, 'e2e');
const browserSupportOnly = process.argv.includes('--browser-support-only');
const readJson = async (relative) => JSON.parse(await readFile(path.join(root, relative), 'utf8'));
const fail = (message) => { throw new Error(message); };
const requireText = (text, fragment, label) => {
  if (!text.includes(fragment)) fail(`${label} fehlt: ${fragment}`);
};

async function listSources(directory, prefix = '') {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = path.posix.join(prefix, entry.name);
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await listSources(absolute, relative));
    else if (entry.isFile() && /\.(?:ts|tsx|js|mjs)$/u.test(entry.name)) files.push(relative);
  }
  return files.sort();
}

const [manifest, packageJson, support, playwright, verifyPages, preparePublic] = await Promise.all([
  readJson('Catalog/catalog-manifest.v1.json'),
  readJson('package.json'),
  readJson('e2e/browser-support.contract.json'),
  readFile(path.join(root, 'playwright.config.ts'), 'utf8'),
  readFile(path.join(root, 'scripts/verify-pages-build.mjs'), 'utf8'),
  readFile(path.join(root, 'scripts/prepare-public.mjs'), 'utf8'),
]);
const sourceFiles = await listSources(e2eDir);
const sources = new Map(await Promise.all(sourceFiles.map(async (name) => [
  name,
  await readFile(path.join(e2eDir, name), 'utf8'),
])));
const specs = new Map([...sources].filter(([name]) => name.endsWith('.spec.ts')));
const matrix = specs.get('browser-matrix.spec.ts');
const quality = specs.get('app-quality.spec.ts');
const catalog = specs.get('catalog-real.spec.ts');
const runtime = specs.get('catalog-unit-runtime.spec.ts');
const harness = sources.get('catalog-harness.ts');
if (!matrix || !quality || !catalog || !runtime || !harness) fail('Verpflichtende Sentinel-E2E-Dateien fehlen.');

const projectNames = ['chromium-desktop', 'chromium-android', 'firefox-desktop', 'webkit-iphone'];
const supportedProjectNames = ['chromium-desktop', 'chromium-android', 'firefox-desktop'];

function validateEvidence() {
  const states = support.evidenceStateModel?.allowedStates ?? [];
  const expected = ['pending_integrated_run', 'passed', 'failed'];
  if (JSON.stringify(states) !== JSON.stringify(expected)) fail(`Zustandsmodell weicht ab: ${JSON.stringify(states)}`);
  const evidence = support.currentEvidence;
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) fail('currentEvidence muss ein Objekt sein.');
  if (!expected.includes(evidence.state)) fail(`Unbekannter Evidenzzustand: ${evidence.state}`);
  if (!Array.isArray(evidence.projectResults)) fail('projectResults muss ein Array sein.');

  const pendingIsEmpty = evidence.buildCommit === null && evidence.workflowRun === null &&
    evidence.measuredAtUtc === null && evidence.projectResults.length === 0 && evidence.failureSummary === null;
  if (evidence.state === 'pending_integrated_run') {
    if (!pendingIsEmpty) fail('pending_integrated_run darf keine Run-Evidenz enthalten.');
    return { state: evidence.state, browserSupportClaimed: false, releaseEligible: false };
  }

  if (typeof evidence.buildCommit !== 'string' || !/^[a-f0-9]{40}$/iu.test(evidence.buildCommit)) {
    fail(`${evidence.state} benötigt einen vollständigen Build-Commit.`);
  }
  const run = evidence.workflowRun;
  if (!run || typeof run !== 'object' || Array.isArray(run) ||
      !Number.isSafeInteger(run.id) || run.id <= 0 || typeof run.url !== 'string') {
    fail(`${evidence.state} benötigt Workflow-Run-ID und -URL.`);
  }
  if (run.url !== `https://github.com/karlokarate/kannalles1/actions/runs/${run.id}`) {
    fail('Workflow-Run-URL passt nicht zur Run-ID.');
  }
  if (typeof evidence.measuredAtUtc !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/u.test(evidence.measuredAtUtc) ||
      Number.isNaN(Date.parse(evidence.measuredAtUtc))) fail(`${evidence.state} benötigt eine gültige UTC-Messzeit.`);

  const names = evidence.projectResults.map((result) => result?.name);
  if (JSON.stringify(names) !== JSON.stringify(projectNames)) fail('Projekt-Evidenz entspricht nicht der Browsermatrix.');
  for (const result of evidence.projectResults) {
    if (!['passed', 'failed', 'not_run'].includes(result?.status)) fail(`Ungültiger Projektstatus: ${result?.status}`);
    if (result.status === 'not_run') {
      if (result.durationMs !== null) fail(`${result.name}: not_run darf keine Dauer tragen.`);
    } else if (!Number.isSafeInteger(result.durationMs) || result.durationMs < 0) {
      fail(`${result.name} benötigt eine nichtnegative ganzzahlige Dauer.`);
    }
  }

  if (evidence.state === 'passed') {
    if (!evidence.projectResults.every((result) => result.status === 'passed')) fail('passed verlangt alle Projekte grün.');
    if (evidence.failureSummary !== null) fail('passed darf keine failureSummary enthalten.');
    return { state: evidence.state, browserSupportClaimed: true, releaseEligible: true };
  }
  if (!evidence.projectResults.some((result) => result.status === 'failed')) fail('failed verlangt mindestens ein fehlgeschlagenes Projekt.');
  if (typeof evidence.failureSummary !== 'string' || !evidence.failureSummary.trim()) fail('failed benötigt eine failureSummary.');
  return { state: evidence.state, browserSupportClaimed: false, releaseEligible: false };
}

function validateTests() {
  const forbiddenControl = /\b(?:test(?:\.describe)?|test\.describe\.(?:parallel|serial)|describe|it)\.(?:skip|fixme|fail|only)\s*\(/gu;
  for (const [name, text] of specs) {
    const hits = [...text.matchAll(forbiddenControl)].map((match) => match[0]);
    if (hits.length) fail(`${name} enthält verbotene Fokus-/Skip-Kontrollen: ${hits.join(', ')}`);
  }

  const routeApi = /\b(page|context|browserContext)\.(route|routeFromHAR|routeWebSocket|unroute|unrouteAll)\s*\(/gu;
  for (const [name, text] of sources) {
    const calls = [...text.matchAll(routeApi)].map((match) => ({ owner: match[1], method: match[2], text: match[0] }));
    if (name === 'catalog-real.spec.ts') {
      if (calls.length !== 2 || calls.some((call) => call.owner !== 'page' || call.method !== 'route')) {
        fail(`catalog-real.spec.ts darf nur zwei page.route-Korruptionsrouten enthalten: ${JSON.stringify(calls)}`);
      }
    } else if (calls.length) {
      fail(`${name} enthält verbotene Routingumgehungen: ${calls.map((call) => call.text).join(', ')}`);
    }
  }
  requireText(catalog, `page.route('**/catalog/manifest.json'`, 'Manifest-Korruptionsroute');
  requireText(catalog, 'page.route(`**/catalog/$' + '{CATALOG_DATABASE_FILENAME}`', 'SQLite-Korruptionsroute');
  for (const fragment of [
    '0,5 kg Nutella',
    '100 g Pfannkuchen mit Quark',
    'data-unit-resolution-status',
    'user-calibration',
    'data-default-value',
    'eine Portion Reis'
  ]) requireText(runtime, fragment, 'Unit-Runtime-E2E-Coverage');
}

function validateBrowserSupport() {
  if (support.contract !== 'kh-checker-browser-support-release-gate' || support.version !== '1.2.0') {
    fail('Browser-Support-Vertrag oder Version ist ungültig.');
  }
  if (support.releaseRequiresAllProjects !== true || support.serialExecution !== true ||
      support.requiredTest !== 'e2e/browser-matrix.spec.ts') fail('Browser-Support-Vertrag schwächt den Gate ab.');
  const names = (support.requiredProjects ?? []).map((project) => project?.name);
  if (JSON.stringify(names) !== JSON.stringify(supportedProjectNames)) fail('Unterstützte Browserprojekte weichen ab.');
  const unsupported = support.evaluatedUnsupportedProjects ?? [];
  if (unsupported.length !== 1 || unsupported[0]?.name !== 'webkit-iphone' ||
      unsupported[0]?.missingCapability !== 'FileSystemSyncAccessHandle' ||
      unsupported[0]?.expectedErrorCode !== 'CATALOG_STORAGE_UNAVAILABLE') {
    fail('WebKit-Unterstützungsgrenze ist nicht explizit und überprüfbar dokumentiert.');
  }
  for (const name of projectNames) requireText(playwright, `name: '${name}'`, 'Playwright-Projekt');
  for (const fragment of [
    `const matrixTest = '**/browser-matrix.spec.ts'`,
    'workers: 1',
    `serviceWorkers: 'allow'`,
    `...devices['Pixel 7']`,
    `...devices['iPhone 15 Pro']`,
  ]) requireText(playwright, fragment, 'Playwright-Konfiguration');

  validateTests();
  for (const forbidden of ['/api/v1/search', '/api/v1/product/', 'cgi/search.pl', 'cgi/auth.pl']) {
    for (const [name, text] of specs) if (text.includes(forbidden)) fail(`Retired Testpfad in ${name}: ${forbidden}`);
  }
  for (const fragment of ['Hauptnavigation', 'overflowing', 'wcag2aa']) requireText(matrix, fragment, 'Matrix-Coverage');
  for (const fragment of ["testInfo.project.name === 'webkit-iphone'", 'CATALOG_STORAGE_UNAVAILABLE']) {
    requireText(matrix, fragment, 'WebKit-Negativabnahme');
  }
  for (const fragment of ['deterministische manuelle Berechnung', "getByLabel('KH pro 100 g')",
    'lokale Einstellungen und manuelle Berechnung', 'wcag2aa']) {
    requireText(quality, fragment, 'Non-API-Coverage');
  }
  requireText(harness, 'sourceManifest.database.file', 'Manifestbasierter E2E-Dateiname');
  requireText(harness, 'sourceManifest.database.products', 'Manifestbasierte E2E-Produktzahl');
  requireText(catalog, 'CATALOG_DATABASE_FILENAME', 'Manifestbasierter Katalogtest');
  requireText(verifyPages, 'sourceManifest.database.file', 'Manifestbasierte Pages-Prüfung');
  if (preparePublic.includes(`path.join(catalogTargetDir, 'kh-checker-dach.sqlite')`)) {
    fail('BLOCKER: prepare-public benennt die Manifestdatenbank noch um.');
  }

  const architecture = String(packageJson.scripts?.['check:architecture'] ?? '');
  const knip = String(packageJson.scripts?.['check:knip'] ?? '');
  const runtimeTests = String(packageJson.scripts?.['test:runtime'] ?? '');
  const runtimeE2e = String(packageJson.scripts?.['test:e2e:runtime'] ?? '');
  if (packageJson.devDependencies?.['dependency-cruiser'] !== '18.1.0' ||
      !architecture.includes('depcruise') || !architecture.includes('dependency-cruiser.config.cjs')) {
    fail('dependency-cruiser ist nicht exakt gepinnt oder konfiguriert.');
  }
  if (packageJson.devDependencies?.knip !== '6.26.0' ||
      !knip.includes('knip') || !knip.includes('knip.json') || !knip.includes('--strict')) {
    fail('Knip ist nicht exakt gepinnt oder strict.');
  }
  for (const fragment of [
    'src/app/catalogUnitRuntime.test.ts',
    'src/lib/mealCalculation.test.ts',
    'scripts/catalog-unit-runtime.architecture.test.ts',
    'scripts/catalog-unit-runtime.catalog.test.ts'
  ]) requireText(runtimeTests, fragment, 'Gezielte Unit-Runtime-Tests');
  for (const fragment of [
    'e2e/catalog-unit-runtime.spec.ts',
    'e2e/smart-unit-prompts.spec.ts',
    '--project=chromium-desktop'
  ]) requireText(runtimeE2e, fragment, 'Gezielte Unit-Runtime-E2E-Tests');

  const evidence = validateEvidence();
  if (evidence.state === 'failed') fail(`Browser-Support ist als failed dokumentiert: ${support.currentEvidence.failureSummary}`);
  return { contract: support.contract, contractVersion: support.version, evidenceState: evidence.state,
    browserSupportClaimed: evidence.browserSupportClaimed, releaseEligible: evidence.releaseEligible,
    requiredProjects: supportedProjectNames, unsupportedProjects: ['webkit-iphone'],
    databaseFilename: manifest.database.file };
}

const browserSupport = validateBrowserSupport();
if (browserSupportOnly) {
  console.log(JSON.stringify({ browserSupportValid: true, ...browserSupport }));
  process.exit(0);
}

const workflowFiles = (await readdir(workflowDir)).filter((name) => /\.ya?ml$/iu.test(name)).sort();
if (workflowFiles.length !== 1 || workflowFiles[0] !== 'build-deploy-pages.yml') fail(`Workflow-Inventar ungültig: ${workflowFiles.join(', ')}`);
const workflowText = await readFile(path.join(workflowDir, workflowFiles[0]), 'utf8');
const workflow = YAML.parse(workflowText);
const events = Object.keys(workflow?.on ?? {}).sort();
if (events.join(',') !== 'pull_request,push,workflow_dispatch') fail(`Workflow-Events weichen ab: ${events.join(',')}`);
for (const eventName of ['push', 'pull_request']) {
  const branches = workflow.on?.[eventName]?.branches ?? [];
  if (branches.length !== 1 || branches[0] !== 'main') fail(`${eventName} muss auf main begrenzt sein.`);
}
if (workflow.permissions?.contents !== 'read') fail('Top-level contents permission muss read-only sein.');
if (/contents:\s*write/iu.test(workflowText) || /git\s+(?:push|commit)/iu.test(workflowText)) fail('Workflow darf das Repository nicht verändern.');
if (/offline-cutover-source|git archive/iu.test(workflowText)) fail('Source-Snapshot-Schritte müssen entfernt bleiben.');

const pins = {
  'actions/checkout': '9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0',
  'actions/setup-node': '48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e',
  'actions/upload-artifact': 'bbbca2ddaa5d8feaa63e36b76fdaad77386f024f',
  'actions/configure-pages': '45bfe0192ca1faeb007ade9deae92b16b8254a0d',
  'actions/upload-pages-artifact': 'fc324d3547104276b827a68afc52ff2a11cc49c9',
  'actions/deploy-pages': 'cd2ce8fcbc39b97be8ca5fce6e763baed58fa128',
};
for (const [action, sha] of Object.entries(pins)) requireText(workflowText, `${action}@${sha}`, 'Action-Pin');
for (const job of Object.values(workflow.jobs ?? {})) for (const step of job.steps ?? []) {
  const uses = String(step?.uses ?? '');
  if (uses && !/^\.\//u.test(uses) && !/@[a-f0-9]{40}$/u.test(uses)) fail(`Action nicht vollständig gepinnt: ${uses}`);
}

const jobs = Object.keys(workflow.jobs ?? {});
if (jobs.join(',') !== 'quality,build,browser-e2e,deploy') fail(`Jobs weichen ab: ${jobs.join(',')}`);
if (workflow.concurrency?.group !== 'pages-$' + '{{ github.ref }}' || workflow.concurrency?.['cancel-in-progress'] !== true) fail('Concurrency-Vertrag ungültig.');
if (workflow.env && Object.keys(workflow.env).length > 0) fail('Der Offline-Build darf keine Runtime-Umschaltvariablen besitzen.');
const commands = (job) => (job?.steps ?? []).map((step) => String(step?.run ?? '')).join('\n');

const qualityJob = workflow.jobs.quality;
const nodeVersions = qualityJob?.strategy?.matrix?.['node-version'] ?? [];
if (JSON.stringify(nodeVersions) !== JSON.stringify(['22.18.0', '24.18.0'])) fail(`Node-Runtime-Matrix weicht ab: ${JSON.stringify(nodeVersions)}`);
if (qualityJob?.strategy?.['fail-fast'] !== false) fail('Node-Runtime-Matrix muss alle Varianten auch nach einem Fehler ausführen.');
requireText(workflowText, 'node-version: $' + '{{ matrix.node-version }}', 'Node-Runtime-Matrix');
const qualityCommands = commands(qualityJob);
for (const command of ['npm ci --no-audit --no-fund', 'npm ci --prefix Catalog/runtime --no-audit --no-fund',
  'npm run check:catalog', 'npm run check:workflow', 'npm run check:browser-support', 'npm run typecheck',
  'npm run lint', 'npm run test:runtime', 'npm test', 'npm run check:architecture', 'npm run check:knip']) {
  requireText(qualityCommands, command, 'Quality-Command');
}

const build = workflow.jobs.build;
if (build?.needs !== 'quality') fail('Build muss von quality abhängen.');
const buildCommands = commands(build);
for (const command of ['npm ci --no-audit --no-fund', 'npm ci --prefix Catalog/runtime --no-audit --no-fund',
  'npm run check:catalog', 'npm run build', 'npm run check:pages']) requireText(buildCommands, command, 'Build-Command');
for (const literal of [manifest.database.file, String(manifest.database.bytes), manifest.database.sha256,
  String(manifest.database.products)]) if (buildCommands.includes(literal)) fail(`Build dupliziert Manifestidentität: ${literal}`);
const configure = build.steps.find((step) => String(step?.uses ?? '').startsWith('actions/configure-pages@'));
const upload = build.steps.find((step) => String(step?.uses ?? '').startsWith('actions/upload-pages-artifact@'));
if (configure?.if !== `github.event_name != 'pull_request'` || upload?.if !== `github.event_name != 'pull_request'`) fail('PR-Deployment-Grenze ungültig.');
if (upload?.with?.path !== 'dist') fail('Pages muss dist hochladen.');

const browser = workflow.jobs['browser-e2e'];
if (browser?.needs !== 'quality') fail('Browser-E2E muss von quality abhängen.');
const browserCommands = commands(browser);
for (const command of ['npm ci --no-audit --no-fund', 'npm ci --prefix Catalog/runtime --no-audit --no-fund',
  'npm run test:e2e:install', 'npm run test:e2e:runtime', 'npm run test:e2e']) {
  requireText(browserCommands, command, 'Browser-E2E-Command');
}

const deploy = workflow.jobs.deploy;
if (deploy?.if !== `github.event_name != 'pull_request'`) fail('Deploy muss für PRs deaktiviert sein.');
if (!Array.isArray(deploy?.needs) || deploy.needs.join(',') !== 'build,browser-e2e') fail('Deploy muss von Build und Browser-E2E abhängen.');
if (deploy?.permissions?.pages !== 'write' || deploy?.permissions?.['id-token'] !== 'write') fail('Deploy-Berechtigungen fehlen.');
if (deploy?.environment?.name !== 'github-pages') fail('Deploy-Environment ungültig.');
const deployCommands = commands(deploy);
for (const fragment of ['Catalog/catalog-manifest.v1.json', 'manifest.database.file',
  'Online OFF/Search-a-licious product access: disabled']) requireText(deployCommands, fragment, 'Deployment-Summary');

console.log(JSON.stringify({ workflowValid: true, mode: 'hard-cutover-quality-browser-pages',
  manifestVersion: manifest.catalogVersion, databaseFilename: manifest.database.file,
  browserSupport, file: `.github/workflows/${workflowFiles[0]}`, jobs }));
