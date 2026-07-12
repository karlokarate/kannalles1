#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { runPython } from './run-python.mjs';

const root = path.resolve(import.meta.dirname, '..');
const packageJson = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const zipArgument = process.argv.find((value, index) => index > 1 && !value.startsWith('--'));
const zipPath = path.resolve(root, zipArgument || `release-out/kh-checker-v${packageJson.version}-komplett.zip`);
const siteIndex = process.argv.indexOf('--site');
const temporary = siteIndex < 0;
const tempRoot = temporary ? await mkdtemp(path.join(os.tmpdir(), 'kh-release-verify-')) : null;
const site = siteIndex >= 0 ? path.resolve(process.argv[siteIndex + 1]) : path.join(tempRoot, 'site');

try {
  const validation = runPython([
    path.join(root, '.github/scripts/validate_release_bundle.py'),
    '--zip', zipPath,
    '--site', site,
    '--expected-version', packageJson.version,
    '--base-path', '/kannalles1/'
  ], { cwd: root });
  if (validation.status !== 0) process.exit(validation.status ?? 1);

  for (const script of ['scripts/verify-pages-build.mjs', 'scripts/verify-static-http.mjs']) {
    const result = spawnSync(process.execPath, [path.join(root, script), site], {
      cwd: root, stdio: 'inherit', windowsHide: true
    });
    if (result.status !== 0) process.exit(result.status ?? 1);
  }
  console.log(JSON.stringify({ releaseValid: true, zip: zipPath, site }));
} finally {
  if (temporary && tempRoot) await rm(tempRoot, { recursive: true, force: true });
}
