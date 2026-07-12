#!/usr/bin/env node
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
const root = path.resolve(import.meta.dirname, '..');
const workflowDir = path.join(root, '.github/workflows');
const files = (await readdir(workflowDir)).filter((name) => /\.ya?ml$/i.test(name)).sort();
if (files.length !== 1 || files[0] !== 'build-deploy-pages.yml') {
  throw new Error(`Exactly one final workflow is allowed; found: ${files.join(', ')}`);
}
const text = await readFile(path.join(workflowDir, files[0]), 'utf8');
const workflow = YAML.parse(text);
const requiredEvents = ['pull_request', 'push', 'schedule', 'workflow_dispatch'];
if (!workflow?.on || requiredEvents.some((event) => !Object.hasOwn(workflow.on, event))) {
  throw new Error(`Workflow must validate PR/push/manual runs and schedule monitoring: ${requiredEvents.join(', ')}`);
}
if (workflow.permissions?.contents !== 'read') throw new Error('Top-level contents permission must be read.');
if (/contents:\s*write/.test(text) || /git\s+(push|commit)/.test(text)) throw new Error('Workflow must not mutate the repository.');
const pinnedActions = {
  'actions/checkout': '9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0',
  'actions/setup-node': '48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e',
  'actions/upload-artifact': '043fb46d1a93c77aae656e7c1c64a875d1fc6a0a',
  'actions/configure-pages': '45bfe0192ca1faeb007ade9deae92b16b8254a0d',
  'actions/upload-pages-artifact': 'fc324d3547104276b827a68afc52ff2a11cc49c9',
  'actions/deploy-pages': 'cd2ce8fcbc39b97be8ca5fce6e763baed58fa128'
};
for (const [action, sha] of Object.entries(pinnedActions)) {
  if (!text.includes(`${action}@${sha}`)) throw new Error(`Required immutable action pin missing: ${action}@${sha}`);
}
for (const job of Object.values(workflow.jobs ?? {})) {
  for (const step of job.steps ?? []) {
    const uses = String(step?.uses ?? '');
    if (uses && !/^\.\//u.test(uses) && !/@[a-f0-9]{40}$/u.test(uses)) {
      throw new Error(`Workflow action is not pinned to a full commit SHA: ${uses}`);
    }
  }
}
if (!text.includes('cancel-in-progress: false')) throw new Error('Pages runs must not cancel a validated deployment in progress.');
if (workflow.concurrency?.group === 'github-pages' || !String(workflow.concurrency?.group ?? '').includes('github.event_name')) {
  throw new Error('Validation concurrency must be event/ref-specific so monitors and PRs cannot block deploy candidates.');
}
for (const required of [
  'gitleaks_8.30.1_linux_x64.tar.gz',
  '551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb',
  'docker compose -f compose.yml config --quiet',
  'docker build --build-arg VITE_DATA_GATEWAY_URL=/',
  'docker compose -f compose.yml up --detach --no-build',
  "h.apiVersion!=='1'",
  'npm run check:search-index:static',
  'scripts/validate-deployment-profile.mjs --profile full-app',
  'scripts/validate-deployment-profile.mjs --profile manual-only',
  'RELEASE_DEPLOYMENT_PROFILE=full-app',
  'RELEASE_DEPLOYMENT_PROFILE=manual-only',
  'npm run check:gateway -- --require'
]) {
  if (!text.includes(required)) throw new Error(`Required workflow gate missing: ${required}`);
}
if (text.includes('vars.VITE_DATA_GATEWAY_URL')) {
  throw new Error('The deployment workflow must use the single authoritative DATA_GATEWAY_URL variable.');
}
const liveGatewayStep = workflow.jobs.prepare?.steps?.find(
  (step) => String(step?.run ?? '').includes('npm run check:gateway -- --require')
);
if (!liveGatewayStep || !String(liveGatewayStep.if ?? '').includes("refs/heads/main")) {
  throw new Error('The full-app live gateway gate must run unconditionally for main deployment candidates.');
}
if (String(liveGatewayStep.if ?? '').includes('vars.')) {
  throw new Error('The full-app live gateway gate must not be skipped when a repository variable is empty.');
}
const prepareCheckout = workflow.jobs.prepare?.steps?.find((step) => String(step?.uses ?? '').startsWith('actions/checkout@'));
if (prepareCheckout?.with?.['fetch-depth'] !== 0 || !text.includes('npm run check:secrets:history')) {
  throw new Error('Prepare must fetch and scan the complete Git history for secrets.');
}
const jobs = Object.keys(workflow.jobs ?? {});
if (jobs.join(',') !== 'monitor,prepare,deploy') throw new Error(`Expected monitor/prepare/deploy jobs, got ${jobs.join(',')}`);
if (workflow.jobs.deploy?.needs !== 'prepare') throw new Error('Deploy job must depend on prepare.');
if (!String(workflow.jobs.deploy?.if ?? '').includes("refs/heads/main")) throw new Error('Deploy must be restricted to the main branch.');
if (workflow.jobs.deploy?.permissions?.pages !== 'write' || workflow.jobs.deploy?.permissions?.['id-token'] !== 'write') {
  throw new Error('Deploy job is missing scoped Pages/OIDC permissions.');
}
console.log(JSON.stringify({ workflowValid: true, file: `.github/workflows/${files[0]}`, jobs }));
