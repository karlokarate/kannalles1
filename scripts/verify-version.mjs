import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageJson = JSON.parse(await fs.readFile(path.join(rootDir, 'package.json'), 'utf8'));
const lockJson = JSON.parse(await fs.readFile(path.join(rootDir, 'package-lock.json'), 'utf8'));
const version = String(packageJson.version);

function fail(message) {
  throw new Error(`Versionsprüfung fehlgeschlagen: ${message}`);
}

if (lockJson.version !== version || lockJson.packages?.['']?.version !== version) {
  fail(`package-lock.json (${lockJson.version}/${lockJson.packages?.['']?.version}) passt nicht zu package.json (${version}).`);
}

const checks = [
  ['README.md', `# KH Checker v${version}`],
  ['README-ERST-LESEN.txt', `KH CHECKER v${version}`],
  [`RELEASE-NOTES-v${version}.txt`, `KH Checker v${version}`],
  ['src/App.tsx', 'const APP_VERSION = __APP_VERSION__'],
  ['vite.config.ts', 'const appVersion = packageJson.version'],
  ['public-template/README-ERST-LESEN.html', 'v__KH_APP_VERSION__'],
];

for (const [file, expected] of checks) {
  const text = await fs.readFile(path.join(rootDir, file), 'utf8').catch(() => null);
  if (text === null) fail(`Pflichtdatei fehlt: ${file}`);
  if (!text.includes(expected)) fail(`${file} enthält den erwarteten Versionsvertrag nicht: ${expected}`);
}

console.log(`Versionsvertrag konsistent: ${version}`);
