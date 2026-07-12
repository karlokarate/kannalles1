#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import process from 'node:process';

const executable = process.env.GITLEAKS_BIN || (process.platform === 'win32' ? 'gitleaks.exe' : 'gitleaks');
const history = process.argv.includes('--history');
const version = spawnSync(executable, ['version'], { encoding: 'utf8', windowsHide: true });
if (version.error?.code === 'ENOENT') {
  throw new Error('gitleaks 8.30.1 is required. Install the pinned binary or set GITLEAKS_BIN.');
}
if (version.status !== 0 || version.stdout.trim() !== '8.30.1') {
  throw new Error(`Expected gitleaks 8.30.1, received: ${(version.stdout || version.stderr).trim()}`);
}

const scanArguments = [
  history ? 'git' : 'dir', '.',
  '--config', '.gitleaks.toml',
  '--no-banner',
  '--no-color',
  '--redact=100',
  '--max-target-megabytes=5',
  '--timeout=120'
];
if (history) scanArguments.push('--log-opts=--all');
const scan = spawnSync(executable, scanArguments, { stdio: 'inherit', windowsHide: true });
if (scan.status !== 0) process.exit(scan.status ?? 1);
console.log(JSON.stringify({
  secretScan: 'clean',
  gitleaks: '8.30.1',
  scope: history ? 'git-history' : 'current-tree'
}));
