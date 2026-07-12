import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageJson = JSON.parse(await fs.readFile(path.join(rootDir, 'package.json'), 'utf8'));
const version = String(packageJson.version);
const gatewayUrl = String(process.env.VITE_DATA_GATEWAY_URL || '').trim();
const sourceDir = path.join(rootDir, 'public-template');
const targetDir = path.join(rootDir, '.generated-public');
const textExtensions = new Set(['.html', '.js', '.css', '.txt', '.json', '.md', '.webmanifest', '.yaml', '.yml']);

await fs.rm(targetDir, { recursive: true, force: true });
await fs.cp(sourceDir, targetDir, { recursive: true });

// Generated contract material is part of the static release documentation, not
// a runtime server dependency.
const apiDocsDir = path.join(targetDir, 'api-docs');
await fs.mkdir(apiDocsDir, { recursive: true });
await Promise.all([
  fs.copyFile(path.join(rootDir, 'docs/api/index.html'), path.join(apiDocsDir, 'index.html')),
  fs.copyFile(path.join(rootDir, 'contracts/generated/search-api.openapi.json'), path.join(apiDocsDir, 'search-api.openapi.json')),
  fs.copyFile(path.join(rootDir, 'contracts/generated/search-api.openapi.yaml'), path.join(apiDocsDir, 'search-api.openapi.yaml')),
  fs.copyFile(path.join(rootDir, 'contracts/generated/generation-manifest.json'), path.join(apiDocsDir, 'generation-manifest.json'))
]);

async function replaceTokens(directory) {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await replaceTokens(absolute);
      continue;
    }
    if (!entry.isFile() || !textExtensions.has(path.extname(entry.name))) continue;
    const original = await fs.readFile(absolute, 'utf8');
    let replaced = original.replaceAll('__KH_APP_VERSION__', version);
    replaced = replaced.replaceAll('__KH_DATA_GATEWAY_URL__', gatewayUrl);
    if (replaced.includes('__KH_APP_VERSION__') || replaced.includes('__KH_DATA_GATEWAY_URL__')) {
      throw new Error(`Unresolved version token in ${path.relative(rootDir, absolute)}`);
    }
    await fs.writeFile(absolute, replaced);
  }
}

await replaceTokens(targetDir);
console.log(`Public assets and generated API documentation prepared for KH Checker v${version}.`);
