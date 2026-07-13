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

for (const file of nodeFiles) {
  const result = spawnSync(process.execPath, ['--check', file], { cwd: root, stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const python = findPython();
const pythonPaths = [
  '.github/scripts/validate_release_bundle.py',
  '.github/scripts/validate_source_bundle.py',
  'scripts/reproducible-zip.py',
  'scripts/validate-catalog-artifacts.py'
];
const pythonCheck = spawnSync(
  python.command,
  [...python.prefix, '-c', [
    'import ast, pathlib',
    `paths = ${JSON.stringify(pythonPaths)}`,
    "[ast.parse(pathlib.Path(path).read_text(encoding='utf-8'), filename=path) for path in paths]"
  ].join('; ')],
  { cwd: root, stdio: 'inherit', windowsHide: true }
);
if (pythonCheck.status !== 0) process.exit(pythonCheck.status ?? 1);

const catalogCheck = spawnSync(
  python.command,
  [...python.prefix, 'scripts/validate-catalog-artifacts.py'],
  { cwd: root, stdio: 'inherit', windowsHide: true }
);
if (catalogCheck.status !== 0) process.exit(catalogCheck.status ?? 1);

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

const windowsStart = readFileSync(path.join(root, 'START-WINDOWS.cmd'), 'utf8');
for (const required of ['22.18', 'dist\\index.html', 'npm run build']) {
  if (!windowsStart.includes(required)) throw new Error(`START-WINDOWS.cmd runtime contract missing: ${required}`);
}
const termuxStart = readFileSync(path.join(root, 'START-ANDROID-TERMUX.sh'), 'utf8');
for (const required of ['dist/index.html', 'npm run build', '22.18']) {
  if (!termuxStart.includes(required)) throw new Error(`START-ANDROID-TERMUX.sh runtime contract missing: ${required}`);
}

for (const required of [
  'Catalog/kh-checker-dach-v1.sqlite',
  'Catalog/catalog-manifest.v1.json',
  'Catalog/catalog-codecs.v1.json',
  'Catalog/catalog-runtime.generated.ts',
  'Catalog/catalog-image-keys.v2.json',
  'Catalog/SHA256SUMS.txt'
]) {
  if (!existsSync(path.join(root, required))) throw new Error(`Production catalog file missing: ${required}`);
}
for (const retired of [
  'Catalog/kh-checker-dach.sqlite',
  'Catalog/manifest.json',
  'Catalog/Placeholder.txt'
]) {
  if (existsSync(path.join(root, retired))) throw new Error(`Benchmark catalog artifact still present: ${retired}`);
}
for (const retiredPublic of ['API-DIAGNOSE.html', 'api-diagnose.js']) {
  const prepare = readFileSync(path.join(root, 'scripts/prepare-public.mjs'), 'utf8');
  if (!prepare.includes(`fs.rm(path.join(targetDir, '${retiredPublic}')`)) {
    throw new Error(`Public build does not remove retired API diagnostic asset: ${retiredPublic}`);
  }
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
for (const activeFile of ['package.json', 'server/index.mjs', 'compose.yml', 'Dockerfile']) {
  if (/\bvercel\b/iu.test(readFileSync(path.join(root, activeFile), 'utf8'))) {
    throw new Error(`Active runtime file contains a retired Vercel dependency: ${activeFile}`);
  }
}

console.log(JSON.stringify({
  nodeSyntaxFiles: nodeFiles.length,
  pythonSyntaxFiles: pythonPaths.length,
  catalogValidated: true,
  bashChecked: bashProbe.status === 0,
  launcherContracts: ['windows', 'linux-macos', 'termux'],
  productRuntime: 'offline-sqlite-opfs'
}));
