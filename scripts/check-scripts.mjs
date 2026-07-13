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

for (const file of nodeFiles) {
  const result = spawnSync(process.execPath, ['--check', file], { cwd: root, stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const python = findPython();
const pythonPaths = ['scripts/validate-catalog-artifacts.py'];
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

const launchers = [
  ['START-WINDOWS.cmd', ['22.18', 'dist\\index.html', 'npm run build', 'scripts\\serve-static.mjs']],
  ['START-LINUX-MAC.sh', ['22.18', 'dist/index.html', 'npm run build', 'scripts/serve-static.mjs']],
  ['START-ANDROID-TERMUX.sh', ['22.18', 'dist/index.html', 'npm run build', 'scripts/serve-static.mjs']]
];
for (const [file, requiredFragments] of launchers) {
  const source = readFileSync(path.join(root, file), 'utf8');
  for (const fragment of requiredFragments) {
    if (!source.includes(fragment)) throw new Error(`${file} runtime contract missing: ${fragment}`);
  }
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
  'Catalog/Placeholder.txt',
  'public-template/API-DIAGNOSE.html',
  'public-template/api-diagnose.js',
  'api',
  'server',
  'deploy/runtime',
  'Dockerfile',
  'compose.yml',
  'compose.production.yml',
  'vercel.json'
]) {
  if (existsSync(path.join(root, retired))) throw new Error(`Retired online runtime artifact still present: ${retired}`);
}

console.log(JSON.stringify({
  nodeSyntaxFiles: nodeFiles.length,
  pythonSyntaxFiles: pythonPaths.length,
  catalogValidated: true,
  bashChecked: bashProbe.status === 0,
  launcherContracts: ['windows', 'linux-macos', 'termux'],
  productRuntime: 'offline-sqlite-opfs'
}));
