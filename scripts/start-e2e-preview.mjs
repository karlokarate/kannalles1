#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { startStaticServer } from './serve-static.mjs';

const root = path.resolve(import.meta.dirname, '..');
const env = { ...process.env };

function run(relative, args = []) {
  const result = spawnSync(process.execPath, [path.join(root, relative), ...args], {
    cwd: root,
    env,
    stdio: 'inherit',
    windowsHide: true
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

if (process.env.PLAYWRIGHT_SKIP_BUILD !== '1') {
  run('scripts/prepare-public.mjs');
  run('node_modules/typescript/bin/tsc', ['-b']);
  run('node_modules/vite/bin/vite.js', ['build']);
}

const preview = startStaticServer({ root: path.join(root, 'dist'), port: 4173 });
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => preview.close(() => process.exit(0)));
}
