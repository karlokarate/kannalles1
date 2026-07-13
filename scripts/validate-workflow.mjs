#!/usr/bin/env node
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';

const root = path.resolve(import.meta.dirname, '..');
const workflowDir = path.join(root, '.github/workflows');
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

const pinnedActions = {
  'actions/checkout': '9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0',
  'actions/setup-node': '48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e',
  'actions/configure-pages': '45bfe0192ca1faeb007ade9deae92b16b8254a0d',
  'actions/upload-pages-artifact': 'fc324d3547104276b827a68afc52ff2a11cc49c9',
  'actions/deploy-pages': 'cd2ce8fcbc39b97be8ca5fce6e763baed58fa128'
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
if (jobs.join(',') !== 'build,deploy') throw new Error(`Expected build/deploy jobs, got ${jobs.join(',')}`);
if (workflow.concurrency?.group !== 'pages-${{ github.ref }}'
  || workflow.concurrency?.['cancel-in-progress'] !== true) {
  throw new Error('Pages must serialize each ref under the dedicated pages concurrency group.');
}
const build = workflow.jobs.build;
const buildCommands = (build?.steps ?? []).map((step) => String(step?.run ?? '')).join('\n');
for (const required of [
  'npm ci --no-audit --no-fund',
  'npm ci --prefix Catalog/runtime --no-audit --no-fund',
  'python3 scripts/validate-catalog-artifacts.py',
  'npm run build',
  'dist/catalog/kh-checker-dach.sqlite',
  'dist/vendor/sqlite/sqlite3.wasm'
]) {
  if (!buildCommands.includes(required)) {
    throw new Error(`Offline Pages build command missing: ${required}`);
  }
}
for (const forbidden of [
  'npm test', 'npm run check', 'npm run audit', 'playwright', 'gitleaks',
  'docker build', 'docker compose', 'check:gateway', 'check:search-index', 'npm run release',
  '--allow-benchmark', 'vars.data_gateway_url', 'vars.vite_data_gateway_url'
]) {
  if (text.toLowerCase().includes(forbidden)) {
    throw new Error(`Pages deploy contains a retired or excessive gate: ${forbidden}`);
  }
}
if (!text.includes('VITE_DATA_GATEWAY_URL: ""')) {
  throw new Error('Pages must force an empty gateway URL for the offline product runtime.');
}
if (!text.includes('Online OFF/Search-a-licious product access: disabled')) {
  throw new Error('Deployment summary must state that online product access is disabled.');
}
const configure = build.steps.find((step) => String(step?.uses ?? '').startsWith('actions/configure-pages@'));
const upload = build.steps.find((step) => String(step?.uses ?? '').startsWith('actions/upload-pages-artifact@'));
if (configure?.if !== "github.event_name != 'pull_request'" || upload?.if !== "github.event_name != 'pull_request'") {
  throw new Error('PR checks must build but must not configure or upload a Pages deployment artifact.');
}
if (upload?.with?.path !== 'dist') throw new Error('Pages must upload the direct Vite dist directory.');

const deploy = workflow.jobs.deploy;
if (deploy?.if !== "github.event_name != 'pull_request'") {
  throw new Error('Deploy job must be disabled for pull requests.');
}
if (deploy?.needs !== 'build') throw new Error('Deploy must depend on the build artifact.');
if (deploy?.permissions?.pages !== 'write' || deploy?.permissions?.['id-token'] !== 'write') {
  throw new Error('Deploy is missing scoped Pages/OIDC permissions.');
}
if (deploy?.environment?.name !== 'github-pages') throw new Error('Deploy must target github-pages.');

console.log(JSON.stringify({
  workflowValid: true,
  mode: 'offline-sqlite-pr-build-and-pages-deploy',
  file: `.github/workflows/${files[0]}`,
  jobs
}));
