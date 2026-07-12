#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const packageJson = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const lock = JSON.parse(await readFile(path.join(root, 'package-lock.json'), 'utf8'));
const trackedRoots = [
  'contracts/generated', 'src/generated', 'server/generated', 'generated-tests',
  'docs/api', 'docs/generated'
];
const fixed = [
  'contracts/source/search-api.contract.mjs', 'orval.config.ts', 'redocly.yaml',
  'package.json', 'package-lock.json', 'scripts/emit-openapi.mjs',
  'scripts/generate-api.mjs', 'scripts/build-api-docs.mjs',
  'scripts/write-generated-adapters.mjs', 'scripts/write-generated-contract-test.mjs',
  'scripts/write-generation-manifest.mjs'
];

async function walk(relative) {
  const absolute = path.join(root, relative);
  try {
    const info = await stat(absolute);
    if (info.isFile()) return [relative.split(path.sep).join('/')];
  } catch { return []; }
  const entries = await readdir(absolute, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const child = path.posix.join(relative.split(path.sep).join('/'), entry.name);
    if (entry.isDirectory()) files.push(...await walk(child));
    else if (entry.isFile()) files.push(child);
  }
  return files;
}

const manifestRelative = 'contracts/generated/generation-manifest.json';
const files = [...new Set([...(await Promise.all(trackedRoots.map(walk))).flat(), ...fixed])]
  .filter((file) => file !== manifestRelative)
  .sort();
const hashes = {};
for (const file of files) {
  const bytes = await readFile(path.join(root, file));
  hashes[file] = createHash('sha256').update(bytes).digest('hex');
}
const depVersion = (name) => packageJson.dependencies?.[name] ?? packageJson.devDependencies?.[name] ?? lock.packages?.[`node_modules/${name}`]?.version;
const manifest = {
  schemaVersion: 1,
  appVersion: packageJson.version,
  authoritativeInput: 'contracts/source/search-api.contract.mjs',
  openapi: 'contracts/generated/search-api.openapi.json',
  generatedDirectories: trackedRoots,
  tools: {
    nodeEngine: packageJson.engines.node,
    orval: depVersion('orval'), redocly: depVersion('@redocly/cli'),
    hono: depVersion('hono'), honoZodOpenApi: depVersion('@hono/zod-openapi'),
    zod: depVersion('zod'), msw: depVersion('msw'), faker: depVersion('@faker-js/faker')
  },
  files: hashes
};
await writeFile(path.join(root, manifestRelative), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify({ generationManifest: manifestRelative, files: files.length, tools: manifest.tools }));
