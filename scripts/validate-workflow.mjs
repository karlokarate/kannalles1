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
if (!workflow?.on || !Object.hasOwn(workflow.on, 'workflow_dispatch') || Object.keys(workflow.on).some((event) => event !== 'workflow_dispatch')) {
  throw new Error('Final workflow must be manual workflow_dispatch only.');
}
if (workflow.permissions?.contents !== 'read') throw new Error('Top-level contents permission must be read.');
if (/contents:\s*write/.test(text) || /git\s+(push|commit)/.test(text)) throw new Error('Workflow must not mutate the repository.');
for (const action of [
  'actions/checkout@v7', 'actions/setup-node@v6', 'actions/upload-artifact@v7',
  'actions/configure-pages@v6', 'actions/upload-pages-artifact@v5', 'actions/deploy-pages@v5'
]) {
  if (!text.includes(action)) throw new Error(`Required pinned action major missing: ${action}`);
}
if (!text.includes('cancel-in-progress: false')) throw new Error('Pages runs must not cancel a validated deployment in progress.');
const jobs = Object.keys(workflow.jobs ?? {});
if (jobs.join(',') !== 'prepare,deploy') throw new Error(`Expected serial prepare/deploy jobs, got ${jobs.join(',')}`);
if (workflow.jobs.deploy?.needs !== 'prepare') throw new Error('Deploy job must depend on prepare.');
if (workflow.jobs.deploy?.permissions?.pages !== 'write' || workflow.jobs.deploy?.permissions?.['id-token'] !== 'write') {
  throw new Error('Deploy job is missing scoped Pages/OIDC permissions.');
}
console.log(JSON.stringify({ workflowValid: true, file: `.github/workflows/${files[0]}`, jobs }));
