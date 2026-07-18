#!/usr/bin/env node
import { rmSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
const outputRoot = path.join(root, '.pwa-update-test');
const viteCli = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js');
const playwrightCli = path.join(root, 'node_modules', '@playwright', 'test', 'cli.js');

function run(label, command, args, environment = {}) {
  console.log(`\n[pwa-update] ${label}`);
  const result = spawnSync(command, args, {
    cwd: root,
    env: { ...process.env, ...environment },
    stdio: 'inherit',
    windowsHide: true
  });
  if (result.status !== 0) {
    throw new Error(`${label} failed: ${result.error?.message ?? `exit ${result.status ?? 'unknown'}`}`);
  }
}

function buildDeployment(name, buildId) {
  const environment = { KH_BUILD_ID: buildId };
  run(`prepare public assets for ${buildId}`, process.execPath, ['scripts/prepare-public.mjs'], environment);
  run(`build ${buildId}`, process.execPath, [
    viteCli,
    'build',
    '--outDir',
    path.join(outputRoot, name),
    '--emptyOutDir'
  ], environment);
  run(`verify ${buildId}`, process.execPath, [
    'scripts/verify-pages-build.mjs',
    path.join(outputRoot, name)
  ], environment);
}

rmSync(outputRoot, { recursive: true, force: true });
try {
  buildDeployment('old', 'pwa-old');
  buildDeployment('new', 'pwa-new');
  run('run installed-app update journey', process.execPath, [
    playwrightCli,
    'test',
    '--config',
    'e2e/playwright.pwa-update.config.ts'
  ]);
} finally {
  if (process.env.KEEP_PWA_UPDATE_BUILDS !== '1') {
    rmSync(outputRoot, { recursive: true, force: true });
  }
}
