#!/usr/bin/env node
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';

const root = path.resolve(import.meta.dirname, '..');
const workflowDir = path.join(root, '.github/workflows');
const manifest = JSON.parse(await readFile(path.join(root, 'Catalog/catalog-manifest.v1.json'), 'utf8'));
const files = (await readdir(workflowDir)).filter((name) => /\.ya?ml$/iu.test(name)).sort();
if (files.length !== 1 || files[0] !== 'build-deploy-pages.yml') {
  throw new Error(`Exactly one Pages workflow is allowed; found: ${files.join(', ')}`);
}

const text = await readFile(path.join(workflowDir, files[0]), 'utf8');
const workflow = YAML.parse(text);
const events = Object.keys(workflow?.on ?? {}).sort();
if (events.join(',') !== 'pull_request,push,workflow_dispatch') {
  throw new Error(`Pages must build PRs and deploy only main/manual refs; got ${events.join(',')}`);
}
for (const eventName of ['push', 'pull_request']) {
  const branches = workflow.on?.[eventName]?.branches ?? [];
  if (branches.length !== 1 || branches[0] !== 'main') {
    throw new Error(`${eventName} must be restricted to main.`);
  }
}
if (workflow.permissions?.contents !== 'read') throw new Error('Top-level contents permission must be read-only.');
if (/contents:\s*write/iu.test(text) || /git\s+(?:push|commit)/iu.test(text)) {
  throw new Error('The Pages workflow must not mutate repository contents.');
}
if (/offline-cutover-source|git archive/iu.test(text)) {
  throw new Error('The temporary source snapshot workflow step must be removed.');
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
  if (!text.includes(`${action}@${sha}`)) throw new Error(`Immutable action pin missing: ${action}@${sha}`);
}
for (const job of Object.values(workflow.jobs ?? {})) {
  for (const step of job.steps ?? []) {
    const uses = String(step?.uses ?? '');
    if (uses && !/^\.\//u.test(uses) && !/@[a-f0-9]{40}$/u.test(uses)) {
      throw new Error(`Workflow action is not pinned to a full commit SHA: ${uses}`);
    }
  }
}

const jobs = Object.keys(workflow.jobs ?? {});
if (jobs.join(',') !== 'quality,build,browser-e2e,deploy') {
  throw new Error(`Expected quality/build/browser-e2e/deploy jobs, got ${jobs.join(',')}`);
}
if (workflow.concurrency?.group !== 'pages-${{ github.ref }}'
  || workflow.concurrency?.['cancel-in-progress'] !== true) {
  throw new Error('Pages must serialize each ref under the dedicated pages concurrency group.');
}
if (workflow.env?.VITE_DATA_GATEWAY_URL !== '') {
  throw new Error('The complete workflow must force an empty product gateway URL.');
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
  'npm run typecheck',
  'npm test',
  'npm run check:architecture',
  'npm run check:knip',
]) {
  if (!qualityCommands.includes(required)) throw new Error(`Quality command missing: ${required}`);
}

const build = workflow.jobs.build;
if (build?.needs !== 'quality') throw new Error('Build must depend on quality.');
const buildCommands = commands(build);
for (const required of [
  'npm ci --no-audit --no-fund',
  'npm ci --prefix Catalog/runtime --no-audit --no-fund',
  'npm run check:catalog',
  'npm run build',
  'npm run check:pages',
]) {
  if (!buildCommands.includes(required)) throw new Error(`Build command missing: ${required}`);
}
for (const literal of [String(manifest.database.bytes), manifest.database.sha256, String(manifest.database.products)]) {
  if (buildCommands.includes(literal)) {
    throw new Error(`Build duplicates manifest identity instead of deriving it: ${literal}`);
  }
}
const configure = build.steps.find((step) => String(step?.uses ?? '').startsWith('actions/configure-pages@'));
const upload = build.steps.find((step) => String(step?.uses ?? '').startsWith('actions/upload-pages-artifact@'));
if (configure?.if !== "github.event_name != 'pull_request'" || upload?.if !== "github.event_name != 'pull_request'") {
  throw new Error('PR checks must build but must not configure or upload a Pages deployment artifact.');
}
if (upload?.with?.path !== 'dist') throw new Error('Pages must upload the direct Vite dist directory.');

const browser = workflow.jobs['browser-e2e'];
if (browser?.needs !== 'quality') throw new Error('Browser E2E must depend on quality.');
const browserCommands = commands(browser);
for (const required of [
  'npm ci --no-audit --no-fund',
  'npm ci --prefix Catalog/runtime --no-audit --no-fund',
  'npm run test:e2e:install',
  'npm run test:e2e',
]) {
  if (!browserCommands.includes(required)) throw new Error(`Browser E2E command missing: ${required}`);
}

const deploy = workflow.jobs.deploy;
if (deploy?.if !== "github.event_name != 'pull_request'") {
  throw new Error('Deploy job must be disabled for pull requests.');
}
if (!Array.isArray(deploy?.needs) || deploy.needs.join(',') !== 'build,browser-e2e') {
  throw new Error('Deploy must depend on build and browser-e2e.');
}
if (deploy?.permissions?.pages !== 'write' || deploy?.permissions?.['id-token'] !== 'write') {
  throw new Error('Deploy is missing scoped Pages/OIDC permissions.');
}
if (deploy?.environment?.name !== 'github-pages') throw new Error('Deploy must target github-pages.');
const deployCommands = commands(deploy);
if (!deployCommands.includes('Catalog/catalog-manifest.v1.json')) {
  throw new Error('Deployment summary must read catalog identity from the manifest.');
}
if (!deployCommands.includes('Online OFF/Search-a-licious product access: disabled')) {
  throw new Error('Deployment summary must state that online product access is disabled.');
}

console.log(JSON.stringify({
  workflowValid: true,
  mode: 'hard-cutover-quality-browser-pages',
  manifestVersion: manifest.catalogVersion,
  file: `.github/workflows/${files[0]}`,
  jobs,
}));
