import { existsSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runtimeDir = path.join(rootDir, 'Catalog', 'runtime');
const distDir = path.join(runtimeDir, 'node_modules', '@sqlite.org', 'sqlite-wasm', 'dist');
const required = [path.join(distDir, 'index.mjs'), path.join(distDir, 'sqlite3.wasm')];

if (!required.every(existsSync)) {
  const npmCli = process.env.npm_execpath;
  const npmCommand = npmCli ? process.execPath : process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const npmArguments = npmCli
    ? [npmCli, 'ci', '--prefix', runtimeDir, '--no-audit', '--no-fund']
    : ['ci', '--prefix', runtimeDir, '--no-audit', '--no-fund'];
  const result = spawnSync(
    npmCommand,
    npmArguments,
    {
      cwd: rootDir,
      stdio: 'inherit',
      windowsHide: true
    }
  );
  if (result.status !== 0) {
    throw new Error(`Locked SQLite-WASM installation failed with exit code ${result.status ?? 'unknown'}${result.error ? `: ${result.error.message}` : ''}.`);
  }
}

if (!required.every(existsSync)) {
  throw new Error('SQLite-WASM runtime is incomplete after installation.');
}
