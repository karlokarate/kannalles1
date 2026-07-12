#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { canonicalFileBytes } from './canonical-text.mjs';
const root = path.resolve(import.meta.dirname, '..');
const manifest = JSON.parse(await readFile(path.join(root, 'contracts/generated/generation-manifest.json'), 'utf8'));
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
if (manifest.appVersion !== pkg.version) throw new Error(`Generator manifest version ${manifest.appVersion} != ${pkg.version}`);
if (manifest.authoritativeInput !== 'contracts/source/search-api.contract.mjs') throw new Error('Unexpected generator authority.');
const mismatches = [];
for (const [relative, expected] of Object.entries(manifest.files ?? {})) {
  try {
    const bytes = await readFile(path.join(root, relative));
    const actual = createHash('sha256').update(canonicalFileBytes(relative, bytes)).digest('hex');
    if (actual !== expected) mismatches.push(`${relative}: ${actual} != ${expected}`);
  } catch (error) {
    mismatches.push(`${relative}: missing (${error.message})`);
  }
}
if (mismatches.length) throw new Error(`Generated artifact verification failed:\n${mismatches.join('\n')}`);
const required = ['orval', 'redocly', 'hono', 'honoZodOpenApi', 'zod', 'msw', 'faker'];
for (const tool of required) if (!manifest.tools?.[tool]) throw new Error(`Generator tool version missing: ${tool}`);
console.log(JSON.stringify({ generatedArtifactsValid: true, appVersion: manifest.appVersion, files: Object.keys(manifest.files).length, tools: manifest.tools }));
