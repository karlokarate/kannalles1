#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = path.resolve(import.meta.dirname, '..');
for (const relative of [
  'src/generated',
  'server/generated',
  'generated-tests',
  'docs/generated'
]) {
  rmSync(path.join(root, relative), { recursive: true, force: true });
}
mkdirSync(path.join(root, 'src', 'generated'), { recursive: true });
rmSync(path.join(root, 'docs', 'api', 'index.html'), { force: true });
rmSync(path.join(root, 'contracts', 'generated', 'search-api.generated.test.ts'), { force: true });

const commands = [
  [process.execPath, ['scripts/emit-openapi.mjs']],
  [process.execPath, ['node_modules/@redocly/cli/bin/cli.js', 'lint', 'contracts/generated/search-api.openapi.yaml']],
  [process.execPath, ['node_modules/orval/dist/bin/orval.mjs', '--config', 'orval.config.ts']],
  [process.execPath, ['scripts/write-generated-adapters.mjs']],
  [process.execPath, ['scripts/write-generated-contract-test.mjs']],
  [process.execPath, ['scripts/build-api-docs.mjs']],
  [process.execPath, ['scripts/write-generation-manifest.mjs']]
];

for (const [command, args] of commands) {
  console.log(`> ${command} ${args.join(' ')}`);
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', env: process.env });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
