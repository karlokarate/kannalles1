import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import autoprefixer from 'autoprefixer';
import postcss from 'postcss';
import {
  resolveBuildId,
  serviceWorkerMetadataFile,
  validateAppVersion
} from './public-config.mjs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageJson = JSON.parse(await fs.readFile(path.join(rootDir, 'package.json'), 'utf8'));
const version = validateAppVersion(packageJson.version);
const buildId = resolveBuildId(process.env, version);
const serviceWorkerBuildFile = serviceWorkerMetadataFile(buildId);
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
const catalogManifest = JSON.parse(
  await fs.readFile(path.join(catalogSourceDir, 'catalog-manifest.v1.json'), 'utf8')
);
const catalogDatabaseFile = catalogManifest?.database?.file;
const catalogVersion = catalogManifest?.catalogVersion;
if (typeof catalogDatabaseFile !== 'string' || !/^[A-Za-z0-9._-]+\.sqlite$/u.test(catalogDatabaseFile)) {
  throw new Error('Production-v1 manifest contains an invalid database.file.');
}
if (typeof catalogVersion !== 'string' || !catalogVersion.trim()) {
  throw new Error('Production-v1 manifest contains an invalid catalogVersion.');
}
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
await Promise.all(['index.mjs', 'sqlite3.wasm'].map((name) => fs.copyFile(
  path.join(sqliteWasmSourceDir, name),
  path.join(sqliteWasmTargetDir, name)
)));

const productionRuntimeFiles = [
  catalogDatabaseFile,
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
    path.join(catalogSourceDir, catalogDatabaseFile),
    path.join(catalogTargetDir, catalogDatabaseFile)
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

const updateManifest = {
  contract: 'kh-checker-app-update',
  schemaVersion: 1,
  appVersion: version,
  buildId,
  catalogVersion: catalogVersion.trim()
};
await fs.writeFile(
  path.join(targetDir, 'app-update.json'),
  `${JSON.stringify(updateManifest, null, 2)}\n`,
  'utf8'
);

// Each generated worker imports a build-specific metadata script. The filename
// changes with every deployment, forcing the top-level sw.js byte content to
// change as well, while the message contract lets the page identify the exact
// installing/waiting worker before showing an update prompt.
const serviceWorkerMetadata = {
  contract: 'kh-checker-service-worker-build',
  schemaVersion: 1,
  appVersion: version,
  buildId
};
const serviceWorkerMetadataSource = `(() => {\n  const metadata = Object.freeze(${JSON.stringify(serviceWorkerMetadata)});\n  self.addEventListener('message', (event) => {\n    if (!event.data || event.data.type !== 'KH_GET_BUILD_METADATA') return;\n    const port = event.ports && event.ports[0];\n    if (port) port.postMessage(metadata);\n  });\n})();\n`;
await fs.writeFile(
  path.join(targetDir, serviceWorkerBuildFile),
  serviceWorkerMetadataSource,
  'utf8'
);

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
    if (replaced.includes('__KH_APP_VERSION__')) {
      throw new Error(`Unresolved public-build token in ${path.relative(rootDir, absolute)}`);
    }
    await fs.writeFile(absolute, replaced);
  }
}

await replaceTokens(targetDir);
if (versionTokenCount < 1) {
  throw new Error(`Unexpected public version token inventory: ${versionTokenCount}.`);
}
console.log(`Public assets prepared for FishIT KH Checker v${version}; build=${buildId}; sw-meta=${serviceWorkerBuildFile}; catalog=production-v1.`);
