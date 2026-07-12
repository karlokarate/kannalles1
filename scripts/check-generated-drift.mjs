#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const root = path.resolve(import.meta.dirname, '..');
const tracked = [
  'contracts/generated',
  'src/generated',
  'docs/api',
  'docs/generated',
  'server/generated',
  'generated-tests'
];

async function walk(relative) {
  const absolute = path.join(root, relative);
  let entries;
  try {
    entries = await readdir(absolute, { withFileTypes: true });
  } catch {
    return [];
  }
  const files = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const child = path.posix.join(relative.split(path.sep).join('/'), entry.name);
    if (entry.isDirectory()) files.push(...(await walk(child)));
    else if (entry.isFile()) files.push(child);
  }
  return files;
}

async function snapshot() {
  const files = (await Promise.all(tracked.map(walk))).flat().sort();
  const result = new Map();
  for (const file of files) {
    const bytes = await readFile(path.join(root, file));
    result.set(file, createHash('sha256').update(bytes).digest('hex'));
  }
  return result;
}

const before = await snapshot();
const generated = spawnSync(process.execPath, ['scripts/generate-api.mjs'], {
  cwd: root,
  stdio: 'inherit',
  env: process.env
});
if (generated.status !== 0) process.exit(generated.status ?? 1);
const after = await snapshot();
const changed = [...new Set([...before.keys(), ...after.keys()])]
  .filter((file) => before.get(file) !== after.get(file));

if (changed.length) {
  console.error('Generated API drift detected. Regenerated files:');
  for (const file of changed) console.error(`- ${file}`);
  console.error('Review and commit/package the regenerated artifacts, then rerun the check.');
  process.exit(1);
}
console.log(JSON.stringify({ generatedArtifactsCurrent: true, files: after.size }));
