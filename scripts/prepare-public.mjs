import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import autoprefixer from 'autoprefixer';
import postcss from 'postcss';
import { validateAppVersion } from './public-config.mjs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageJson = JSON.parse(await fs.readFile(path.join(rootDir, 'package.json'), 'utf8'));
const version = validateAppVersion(packageJson.version);
const sourceDir = path.join(rootDir, 'public-template');
const targetDir = path.join(rootDir, '.generated-public');
const catalogSourceDir = path.join(rootDir, 'Catalog');
const catalogTargetDir = path.join(targetDir, 'catalog');
const sqliteWasmSourceDir = path.join(
  catalogSourceDir,
  'runtime',
  'node_modules',
  '@sqlite.org',
  'sqlite-wasm',
  'dist'
);
const sqliteWasmTargetDir = path.join(targetDir, 'vendor', 'sqlite');
const textExtensions = new Set(['.html', '.js', '.css', '.txt', '.json', '.md', '.webmanifest', '.yaml', '.yml']);
let versionTokenCount = 0;

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

await fs.rm(targetDir, { recursive: true, force: true });
await fs.cp(sourceDir, targetDir, { recursive: true });

// The retired API diagnosis page and generated gateway documentation must not
// ship in an offline-catalog release because they describe a non-productive path.
await Promise.all([
  fs.rm(path.join(targetDir, 'API-DIAGNOSE.html'), { force: true }),
  fs.rm(path.join(targetDir, 'api-diagnose.js'), { force: true }),
  fs.rm(path.join(targetDir, 'api-docs'), { recursive: true, force: true })
]);

// Keep CSS as a real external asset. The legacy-only SystemJS graph would
// otherwise inject it as an inline <style>, conflicting with the strict CSP.
const sourceCssPath = path.join(rootDir, 'src/styles.css');
const targetCssPath = path.join(targetDir, 'app.css');
const sourceCss = await fs.readFile(sourceCssPath, 'utf8');
const processedCss = await postcss([
  autoprefixer({
    overrideBrowserslist: [
      'Chrome >= 84',
      'ChromeAndroid >= 84',
      'Firefox >= 67',
      'Safari >= 14.1',
      'iOS >= 14.5',
      'Edge >= 84'
    ]
  })
]).process(sourceCss, { from: sourceCssPath, to: targetCssPath });
await fs.writeFile(targetCssPath, processedCss.css);

// The SQLite runtime has its own exact lock so it can be upgraded independently
// from the application dependency graph.
for (const name of ['index.mjs', 'sqlite3.wasm']) {
  if (!await exists(path.join(sqliteWasmSourceDir, name))) {
    throw new Error(`SQLite-WASM runtime missing ${name}. Run npm ci --prefix Catalog/runtime first.`);
  }
}
await fs.mkdir(sqliteWasmTargetDir, { recursive: true });
await fs.cp(sqliteWasmSourceDir, sqliteWasmTargetDir, { recursive: true });

const productionRuntimeFiles = [
  'kh-checker-dach-v1.sqlite',
  'catalog-manifest.v1.json',
  'catalog-codecs.v1.json',
  'catalog-image-keys.v2.json',
  'catalog-runtime.generated.ts'
];
const missing = [];
for (const name of productionRuntimeFiles) {
  if (!await exists(path.join(catalogSourceDir, name))) missing.push(name);
}
if (missing.length) {
  throw new Error(`Production-v1 catalog is incomplete: ${missing.join(', ')}`);
}

await fs.mkdir(catalogTargetDir, { recursive: true });
await Promise.all([
  fs.copyFile(
    path.join(catalogSourceDir, 'kh-checker-dach-v1.sqlite'),
    path.join(catalogTargetDir, 'kh-checker-dach.sqlite')
  ),
  fs.copyFile(
    path.join(catalogSourceDir, 'catalog-manifest.v1.json'),
    path.join(catalogTargetDir, 'manifest.json')
  ),
  fs.copyFile(
    path.join(catalogSourceDir, 'catalog-codecs.v1.json'),
    path.join(catalogTargetDir, 'catalog-codecs.v1.json')
  ),
  fs.copyFile(
    path.join(catalogSourceDir, 'catalog-image-keys.v2.json'),
    path.join(catalogTargetDir, 'catalog-image-keys.v2.json')
  )
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
    versionTokenCount += original.split('__KH_APP_VERSION__').length - 1;
    const replaced = original.replaceAll('__KH_APP_VERSION__', version);
    if (replaced.includes('__KH_APP_VERSION__') || replaced.includes('__KH_DATA_GATEWAY_URL_JSON__')) {
      throw new Error(`Unresolved public-build token in ${path.relative(rootDir, absolute)}`);
    }
    await fs.writeFile(absolute, replaced);
  }
}

await replaceTokens(targetDir);
if (versionTokenCount < 1) {
  throw new Error(`Unexpected public version token inventory: ${versionTokenCount}.`);
}
console.log(`Public assets prepared for KH Checker v${version}; catalog=production-v1.`);
