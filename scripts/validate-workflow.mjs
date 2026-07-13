#!/usr/bin/env node
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';

const root = path.resolve(import.meta.dirname, '..');
const browserSupportOnly = process.argv.includes('--browser-support-only');
const workflowDir = path.join(root, '.github/workflows');
const manifest = JSON.parse(await readFile(path.join(root, 'Catalog/catalog-manifest.v1.json'), 'utf8'));
const packageJson = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const supportContract = JSON.parse(
  await readFile(path.join(root, 'e2e/browser-support.contract.json'), 'utf8'),
);
const playwrightText = await readFile(path.join(root, 'playwright.config.ts'), 'utf8');
const matrixText = await readFile(path.join(root, 'e2e/browser-matrix.spec.ts'), 'utf8');
const appQualityText = await readFile(path.join(root, 'e2e/app-quality.spec.ts'), 'utf8');
const catalogRealText = await readFile(path.join(root, 'e2e/catalog-real.spec.ts'), 'utf8');
const harnessText = await readFile(path.join(root, 'e2e/catalog-harness.ts'), 'utf8');
const verifyPagesText = await readFile(path.join(root, 'scripts/verify-pages-build.mjs'), 'utf8');
const preparePublicText = await readFile(path.join(root, 'scripts/prepare-public.mjs'), 'utf8');

function fail(message) {
  throw new Error(message);
}

function requireText(text, fragment, label) {
  if (!text.includes(fragment)) fail(`${label} fehlt: ${fragment}`);
}

function validateBrowserSupport() {
  if (supportContract.contract !== 'kh-checker-browser-support-release-gate'
    || supportContract.version !== '1.0.0') {
    fail('Browser-Support-Vertrag oder Version ist ungültig.');
  }
  if (supportContract.releaseRequiresAllProjects !== true
    || supportContract.serialExecution !== true
    || supportContract.requiredTest !== 'e2e/browser-matrix.spec.ts') {
    fail('Browser-Support-Vertrag schwächt den Release-Gate ab.');
  }
  if (supportContract.currentEvidence?.state !== 'pending_integrated_run') {
    fail('Sentinel darf vor dem integrierten Produktionslauf keinen Browser-Support behaupten.');
  }
  const requiredProjects = supportContract.requiredProjects ?? [];
  const names = requiredProjects.map((project) => project?.name);
  const expectedNames = [
    'chromium-desktop',
    'chromium-android',
    'firefox-desktop',
    'webkit-iphone',
  ];
  if (JSON.stringify(names) !== JSON.stringify(expectedNames)) {
    fail(`Browser-Matrix-Projekte weichen ab: ${JSON.stringify(names)}`);
  }
  for (const name of expectedNames) {
    if (!playwrightText.includes(`name: '${name}'`) && !playwrightText.includes(`name: "${name}"`)) {
      fail(`Playwright-Projekt fehlt: ${name}`);
    }
  }
  requireText(playwrightText, "const matrixTest = '**/browser-matrix.spec.ts'", 'Playwright-Matrixbindung');
  requireText(playwrightText, 'workers: 1', 'Serielle OPFS-Ausführung');
  requireText(playwrightText, "serviceWorkers: 'block'", 'Deterministische Browserausführung');
  requireText(playwrightText, "...devices['Pixel 7']", 'Android-Profil');
  requireText(playwrightText, "...devices['iPhone 15 Pro']", 'iPhone-Profil');

  for (const [name, text] of [
    ['browser-matrix.spec.ts', matrixText],
    ['app-quality.spec.ts', appQualityText],
    ['catalog-real.spec.ts', catalogRealText],
  ]) {
    if (/test\.(?:skip|fixme|fail)\s*\(/u.test(text)) {
      fail(`${name} darf keine unvollständige Runtime durch skip/fixme/fail kaschieren.`);
    }
  }
  if (matrixText.includes('page.route(') || appQualityText.includes('page.route(')) {
    fail('Browsermatrix und allgemeine Qualitätsjourneys dürfen keine Netz- oder Produktpfade mocken.');
  }
  const corruptionRoutes = catalogRealText.match(/page\.route\(/gu)?.length ?? 0;
  if (corruptionRoutes !== 2
    || !catalogRealText.includes("page.route('**/catalog/manifest.json'")
    || !catalogRealText.includes('page.route(`**/catalog/${CATALOG_DATABASE_FILENAME}`')) {
    fail('Nur der kontrollierte Manifest-/SQLite-Korruptionspfad darf im realen Katalogtest geroutet werden.');
  }
  for (const forbidden of ['/api/v1/search', '/api/v1/product/', 'cgi/search.pl', 'cgi/auth.pl']) {
    if (matrixText.includes(forbidden) || appQualityText.includes(forbidden) || catalogRealText.includes(forbidden)) {
      fail(`Retired API-/Account-Testpfad ist zurückgekehrt: ${forbidden}`);
    }
  }

  for (const required of [
    'Hauptnavigation',
    'overflowing',
    'wcag2aa',
  ]) requireText(matrixText, required, 'Browsermatrix-Coverage');
  for (const required of [
    'deterministische manuelle Berechnung',
    'Kohlenhydrate pro 100 Gramm',
    'Bundeslebensmittelschlüssel BLS 4.0',
    'Max Rubner-Institut 2025',
    'wcag2aa',
  ]) requireText(appQualityText, required, 'Non-API-Coverage');

  requireText(harnessText, 'sourceManifest.database.file', 'Manifestbasierter E2E-Dateiname');
  requireText(harnessText, 'sourceManifest.database.products', 'Manifestbasierte E2E-Produktzahl');
  requireText(catalogRealText, 'CATALOG_DATABASE_FILENAME', 'Manifestbasierter Katalogtest');
  requireText(verifyPagesText, 'sourceManifest.database.file', 'Manifestbasierte Pages-Prüfung');
  if (preparePublicText.includes("path.join(catalogTargetDir, 'kh-checker-dach.sqlite')")) {
    fail('BLOCKER: scripts/prepare-public.mjs benennt die Manifestdatenbank noch in kh-checker-dach.sqlite um.');
  }

  const architecture = String(packageJson.scripts?.['check:architecture'] ?? '');
  const knip = String(packageJson.scripts?.['check:knip'] ?? '');
  if (!architecture.includes('dependency-cruiser@18.1.0') || !architecture.includes('dependency-cruiser.config.cjs')) {
    fail('dependency-cruiser muss exakt gepinnt und mit der Sentinel-Konfiguration ausgeführt werden.');
  }
  if (!knip.includes('knip@6.26.0') || !knip.includes('knip.json') || !knip.includes('--strict')) {
    fail('Knip muss exakt gepinnt und im Strict-Modus ausgeführt werden.');
  }

  return {
    contract: supportContract.contract,
    evidenceState: supportContract.currentEvidence.state,
    requiredProjects: expectedNames,
    databaseFilename: manifest.database.file,
  };
}

const browserSupport = validateBrowserSupport();
if (browserSupportOnly) {
  console.log(JSON.stringify({ browserSupportValid: true, ...browserSupport }));
  process.exit(0);
}

const files = (await readdir(workflowDir)).filter((name) => /\.ya?ml$/iu.test(name)).sort();
if (files.length !== 1 || files[0] !== 'build-deploy-pages.yml') {
  fail(`Exactly one Pages workflow is allowed; found: ${files.join(', ')}`);
}

const text = await readFile(path.join(workflowDir, files[0]), 'utf8');
const workflow = YAML.parse(text);
const events = Object.keys(workflow?.on ?? {}).sort();
if (events.join(',') !== 'pull_request,push,workflow_dispatch') {
  fail(`Pages must build PRs and deploy only main/manual refs; got ${events.join(',')}`);
}
for (const eventName of ['push', 'pull_request']) {
  const branches = workflow.on?.[eventName]?.branches ?? [];
  if (branches.length !== 1 || branches[0] !== 'main') {
    fail(`${eventName} must be restricted to main.`);
  }
}
if (workflow.permissions?.contents !== 'read') fail('Top-level contents permission must be read-only.');
if (/contents:\s*write/iu.test(text) || /git\s+(?:push|commit)/iu.test(text)) {
  fail('The Pages workflow must not mutate repository contents.');
}
if (/offline-cutover-source|git archive/iu.test(text)) {
  fail('The temporary source snapshot workflow step must be removed.');
}

const pinnedActions = {
  'actions/checkout': '9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0',
  'actions/setup-node': '48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e',
  'actions/upload-artifact': 'bbbca2ddaa5d8feaa63e36b76fdaad77386f024f',
  'actions/configure-pages': '45bfe0192ca1faeb007ade9deae92b16b8254a0d',
  'actions/upload-pages-artifact': 'fc324d3547104276b827a68afc52ff2a11cc49c9',
  'actions/deploy-pages': 'cd2ce8fcbc39b97be8ca5fce6e763baed58fa128',
};
for (const [action, sha] of Object.entries(pinnedActions)) {
  if (!text.includes(`${action}@${sha}`)) fail(`Immutable action pin missing: ${action}@${sha}`);
}
for (const job of Object.values(workflow.jobs ?? {})) {
  for (const step of job.steps ?? []) {
    const uses = String(step?.uses ?? '');
    if (uses && !/^\.\//u.test(uses) && !/@[a-f0-9]{40}$/u.test(uses)) {
      fail(`Workflow action is not pinned to a full commit SHA: ${uses}`);
    }
  }
}

const jobs = Object.keys(workflow.jobs ?? {});
if (jobs.join(',') !== 'quality,build,browser-e2e,deploy') {
  fail(`Expected quality/build/browser-e2e/deploy jobs, got ${jobs.join(',')}`);
}
if (workflow.concurrency?.group !== 'pages-${{ github.ref }}'
  || workflow.concurrency?.['cancel-in-progress'] !== true) {
  fail('Pages must serialize each ref under the dedicated pages concurrency group.');
}
if (workflow.env?.VITE_DATA_GATEWAY_URL !== '') {
  fail('The complete workflow must force an empty product gateway URL.');
}

function commands(job) {
  return (job?.steps ?? []).map((step) => String(step?.run ?? '')).join('\n');
}

const quality = workflow.jobs.quality;
const qualityCommands = commands(quality);
for (const required of [
  'npm ci --no-audit --no-fund',
  'npm ci --prefix Catalog/runtime --no-audit --no-fund',
  'npm run check:catalog',
  'npm run check:workflow',
  'npm run check:browser-support',
  'npm run typecheck',
  'npm test',
  'npm run check:architecture',
  'npm run check:knip',
]) {
  if (!qualityCommands.includes(required)) fail(`Quality command missing: ${required}`);
}

const build = workflow.jobs.build;
if (build?.needs !== 'quality') fail('Build must depend on quality.');
const buildCommands = commands(build);
for (const required of [
  'npm ci --no-audit --no-fund',
  'npm ci --prefix Catalog/runtime --no-audit --no-fund',
  'npm run check:catalog',
  'npm run build',
  'npm run check:pages',
]) {
  if (!buildCommands.includes(required)) fail(`Build command missing: ${required}`);
}
for (const literal of [
  manifest.database.file,
  String(manifest.database.bytes),
  manifest.database.sha256,
  String(manifest.database.products),
]) {
  if (buildCommands.includes(literal)) {
    fail(`Build duplicates manifest identity instead of deriving it: ${literal}`);
  }
}
const configure = build.steps.find((step) => String(step?.uses ?? '').startsWith('actions/configure-pages@'));
const upload = build.steps.find((step) => String(step?.uses ?? '').startsWith('actions/upload-pages-artifact@'));
if (configure?.if !== "github.event_name != 'pull_request'" || upload?.if !== "github.event_name != 'pull_request'") {
  fail('PR checks must build but must not configure or upload a Pages deployment artifact.');
}
if (upload?.with?.path !== 'dist') fail('Pages must upload the direct Vite dist directory.');

const browser = workflow.jobs['browser-e2e'];
if (browser?.needs !== 'quality') fail('Browser E2E must depend on quality.');
const browserCommands = commands(browser);
for (const required of [
  'npm ci --no-audit --no-fund',
  'npm ci --prefix Catalog/runtime --no-audit --no-fund',
  'npm run test:e2e:install',
  'npm run test:e2e',
]) {
  if (!browserCommands.includes(required)) fail(`Browser E2E command missing: ${required}`);
}

const deploy = workflow.jobs.deploy;
if (deploy?.if !== "github.event_name != 'pull_request'") {
  fail('Deploy job must be disabled for pull requests.');
}
if (!Array.isArray(deploy?.needs) || deploy.needs.join(',') !== 'build,browser-e2e') {
  fail('Deploy must depend on build and browser-e2e.');
}
if (deploy?.permissions?.pages !== 'write' || deploy?.permissions?.['id-token'] !== 'write') {
  fail('Deploy is missing scoped Pages/OIDC permissions.');
}
if (deploy?.environment?.name !== 'github-pages') fail('Deploy must target github-pages.');
const deployCommands = commands(deploy);
if (!deployCommands.includes('Catalog/catalog-manifest.v1.json')) {
  fail('Deployment summary must read catalog identity from the manifest.');
}
if (!deployCommands.includes('manifest.database.file')) {
  fail('Deployment summary must include the manifest-declared database filename.');
}
if (!deployCommands.includes('Online OFF/Search-a-licious product access: disabled')) {
  fail('Deployment summary must state that online product access is disabled.');
}

console.log(JSON.stringify({
  workflowValid: true,
  mode: 'hard-cutover-quality-browser-pages',
  manifestVersion: manifest.catalogVersion,
  databaseFilename: manifest.database.file,
  browserSupport,
  file: `.github/workflows/${files[0]}`,
  jobs,
}));
