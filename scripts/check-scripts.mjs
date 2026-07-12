#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { findPython } from './run-python.mjs';

const root = path.resolve(import.meta.dirname, '..');
const nodeFiles = readdirSync(path.join(root, 'scripts'))
  .filter((name) => name.endsWith('.mjs'))
  .map((name) => path.join('scripts', name));
nodeFiles.push(path.join('contracts', 'source', 'search-api.contract.mjs'));
nodeFiles.push(path.join('public-template', 'api-diagnose.js'));

for (const file of nodeFiles) {
  const result = spawnSync(process.execPath, ['--check', file], { cwd: root, stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const python = findPython();
const pythonCheck = spawnSync(
  python.command,
  [...python.prefix, '-c', [
    'import ast, pathlib',
    "paths = [pathlib.Path('.github/scripts/validate_release_bundle.py'), pathlib.Path('.github/scripts/validate_source_bundle.py'), pathlib.Path('scripts/reproducible-zip.py')]",
    "[ast.parse(path.read_text(encoding='utf-8'), filename=str(path)) for path in paths]"
  ].join('; ')],
  { cwd: root, stdio: 'inherit', windowsHide: true }
);
if (pythonCheck.status !== 0) process.exit(pythonCheck.status ?? 1);

const bashProbe = spawnSync('bash', ['--version'], { encoding: 'utf8', windowsHide: true });
if (bashProbe.status === 0) {
  const shellFiles = [
    'START-ANDROID-TERMUX.sh',
    'START-LINUX-MAC.sh',
    ...readdirSync(path.join(root, 'scripts')).filter((name) => name.endsWith('.sh')).map((name) => `scripts/${name}`)
  ];
  const bashCheck = spawnSync('bash', ['-n', ...shellFiles], { cwd: root, stdio: 'inherit', windowsHide: true });
  if (bashCheck.status !== 0) process.exit(bashCheck.status ?? 1);
} else {
  console.log('Bash ist auf diesem Host nicht installiert; Shellsyntax bleibt ein verpflichtendes Linux-CI-Gate.');
}

const windowsStart = await import('node:fs/promises').then(({ readFile }) =>
  readFile(path.join(root, 'START-WINDOWS.cmd'), 'utf8')
);
for (const required of ['22.18', 'dist\\index.html', 'npm run build', 'npm run api:generate']) {
  if (!windowsStart.includes(required)) throw new Error(`START-WINDOWS.cmd runtime contract missing: ${required}`);
}
const termuxStart = await import('node:fs/promises').then(({ readFile }) =>
  readFile(path.join(root, 'START-ANDROID-TERMUX.sh'), 'utf8')
);
for (const required of [
  'contracts', 'dist/index.html', 'npm run build', '22.18',
  '"$TARGET_DIR/api"', '"$SOURCE_DIR/api"'
]) {
  if (!termuxStart.includes(required)) throw new Error(`START-ANDROID-TERMUX.sh runtime contract missing: ${required}`);
}

for (const forbidden of [
  'vercel.json',
  'api/health.js', 'api/search.js', 'api/ai/parse.js', 'api/product/[code].js',
  'api/v1/health.js', 'api/v1/search.js', 'api/v1/ai/parse.js', 'api/v1/product/[code].js'
]) {
  if (existsSync(path.join(root, forbidden))) {
    throw new Error(`Retired Vercel/serverless adapter returned: ${forbidden}`);
  }
}
const runtimeContract = JSON.parse(readFileSync(
  path.join(root, 'public-template/contracts/kh-checker-api-config-user-needs-v2.2.4.json'),
  'utf8'
));
if (runtimeContract.architecture?.portableGatewayRuntime !== 'node-express-container'
  || runtimeContract.architecture?.optionalAdapters?.length !== 0) {
  throw new Error('Runtime contract must remain vendor-neutral Node/Express without platform adapters.');
}
for (const activeFile of ['package.json', 'server/index.mjs', 'compose.yml', 'Dockerfile']) {
  if (/\bvercel\b/iu.test(readFileSync(path.join(root, activeFile), 'utf8'))) {
    throw new Error(`Active runtime file contains a retired Vercel dependency: ${activeFile}`);
  }
}

console.log(JSON.stringify({
  nodeSyntaxFiles: nodeFiles.length,
  pythonSyntaxFiles: 3,
  bashChecked: bashProbe.status === 0,
  launcherContracts: ['windows', 'linux-macos', 'termux'],
  backendPlatform: 'vendor-neutral-node-express'
}));
