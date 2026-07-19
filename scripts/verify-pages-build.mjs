import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  resolveBuildId,
  serviceWorkerMetadataFile
} from './public-config.mjs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pagesDir = process.argv[2] ? path.resolve(process.argv[2]) : path.join(rootDir, 'dist');
const pagesLabel = path.relative(rootDir, pagesDir) || '.';
const packageJson = JSON.parse(await fs.readFile(path.join(rootDir, 'package.json'), 'utf8'));
const sourceManifest = JSON.parse(
  await fs.readFile(path.join(rootDir, 'Catalog/catalog-manifest.v1.json'), 'utf8'),
);
const appVersion = String(packageJson.version);
const expectedBuildId = resolveBuildId(process.env, appVersion);
const serviceWorkerBuildFile = serviceWorkerMetadataFile(expectedBuildId);
const databaseFilename = String(sourceManifest?.database?.file ?? '');
if (!databaseFilename || path.basename(databaseFilename) !== databaseFilename) {
  throw new Error(`GitHub-Pages-Prüfung fehlgeschlagen: ungültiger Manifest-Datenbankdateiname ${JSON.stringify(databaseFilename)}`);
}
const deployedDatabase = `catalog/${databaseFilename}`;
const deployedManifest = 'catalog/manifest.json';
const codecAsset = `catalog/${sourceManifest.codecFile}`;
const imageDictionaryAsset = `catalog/${sourceManifest.image.dictionaryFile}`;
const retiredRenamedDatabase = 'catalog/kh-checker-dach.sqlite';
const updateManifestFile = 'app-update.json';

function fail(message) {
  throw new Error(`GitHub-Pages-Prüfung fehlgeschlagen: ${message}`);
}

async function requireFile(relativePath) {
  const absolutePath = path.join(pagesDir, relativePath);
  const stats = await fs.stat(absolutePath).catch(() => null);
  if (!stats?.isFile()) fail(`Pflichtdatei fehlt: ${pagesLabel}/${relativePath}`);
  return absolutePath;
}

function normalizeLocalReference(reference) {
  const clean = reference.split('#', 1)[0]?.split('?', 1)[0] ?? '';
  if (!clean || clean.startsWith('data:') || clean.startsWith('blob:')) return null;
  if (clean === '.' || clean === './') return null;
  if (/^[a-z][a-z\d+.-]*:/i.test(clean) || clean.startsWith('//')) return null;
  if (clean.startsWith('/')) fail(`root-absoluter Pfad ist unter einem GitHub-Pages-Unterpfad unsicher: ${reference}`);
  return clean.replace(/^\.\//, '');
}

async function listFiles(directory, prefix = '') {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const relative = path.posix.join(prefix, entry.name);
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(absolute, relative));
    else if (entry.isFile()) files.push(relative);
  }
  return files;
}

async function sha256(filePath) {
  const buffer = await fs.readFile(filePath);
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

const requiredFiles = [
  'index.html',
  'app.css',
  updateManifestFile,
  serviceWorkerBuildFile,
  'manifest.webmanifest',
  'sw.js',
  'README-ERST-LESEN.html',
  'package-info.css',
  'icons/apple-touch-icon.png',
  deployedDatabase,
  deployedManifest,
  codecAsset,
  imageDictionaryAsset,
  'vendor/sqlite/index.mjs',
  'vendor/sqlite/sqlite3.wasm',
];
await Promise.all(requiredFiles.map(requireFile));

for (const retired of ['API-DIAGNOSE.html', 'api-diagnose.js', 'api-docs', retiredRenamedDatabase]) {
  const present = await fs.stat(path.join(pagesDir, retired)).catch(() => null);
  if (present) fail(`veraltetes oder umbenanntes Artefakt wird noch ausgeliefert: ${retired}`);
}

const htmlFiles = ['index.html', 'README-ERST-LESEN.html'];
let referenceCount = 0;
for (const htmlFile of htmlFiles) {
  const html = await fs.readFile(path.join(pagesDir, htmlFile), 'utf8');
  const references = [...html.matchAll(/(?:src|href)=["']([^"']+)["']/gi)]
    .map((match) => match[1])
    .filter(Boolean);
  referenceCount += references.length;
  for (const reference of references) {
    const localPath = normalizeLocalReference(reference);
    if (localPath) await requireFile(localPath);
  }
}

const indexHtml = await fs.readFile(path.join(pagesDir, 'index.html'), 'utf8');
const webManifest = JSON.parse(await fs.readFile(path.join(pagesDir, 'manifest.webmanifest'), 'utf8'));
const updateManifest = JSON.parse(await fs.readFile(path.join(pagesDir, updateManifestFile), 'utf8'));
if (webManifest.id !== './') fail(`manifest.id muss "./" sein, ist aber ${JSON.stringify(webManifest.id)}`);
if (webManifest.start_url !== './') fail(`manifest.start_url muss "./" sein, ist aber ${JSON.stringify(webManifest.start_url)}`);
if (webManifest.scope !== './') fail(`manifest.scope muss "./" sein, ist aber ${JSON.stringify(webManifest.scope)}`);
if (webManifest.display !== 'standalone') fail(`manifest.display muss "standalone" sein, ist aber ${JSON.stringify(webManifest.display)}`);
if (webManifest.orientation !== 'any') fail(`manifest.orientation muss "any" sein, ist aber ${JSON.stringify(webManifest.orientation)}`);
if (!Array.isArray(webManifest.icons) || webManifest.icons.length < 2) fail('Manifest benötigt mindestens zwei App-Icons.');
for (const icon of webManifest.icons) {
  const localPath = normalizeLocalReference(String(icon?.src ?? ''));
  if (!localPath) fail(`ungültiger lokaler Icon-Pfad: ${JSON.stringify(icon?.src)}`);
  await requireFile(localPath);
}

if (updateManifest.contract !== 'kh-checker-app-update' || updateManifest.schemaVersion !== 1) {
  fail('app-update.json besitzt nicht den erwarteten Updatevertrag.');
}
if (updateManifest.appVersion !== appVersion) fail('app-update.json stimmt nicht zur Anwendungsversion.');
if (updateManifest.catalogVersion !== sourceManifest.catalogVersion) fail('app-update.json stimmt nicht zur Katalogversion.');
if (updateManifest.buildId !== expectedBuildId) {
  fail(`app-update.json Build-ID ${JSON.stringify(updateManifest.buildId)} stimmt nicht zu ${JSON.stringify(expectedBuildId)}.`);
}

const workerMetadataSource = await fs.readFile(path.join(pagesDir, serviceWorkerBuildFile), 'utf8');
for (const required of [
  'kh-checker-service-worker-build',
  'KH_GET_BUILD_METADATA',
  expectedBuildId,
  appVersion
]) {
  if (!workerMetadataSource.includes(required)) {
    fail(`Service-Worker-Metadaten enthalten nicht: ${required}`);
  }
}

if (!/rel=["']manifest["']/i.test(indexHtml)) fail('index.html bindet kein Web-App-Manifest ein.');
if (!/apple-touch-icon/i.test(indexHtml)) fail('index.html bindet kein Apple-Touch-Icon ein.');
if (!indexHtml.includes('Content-Security-Policy')) fail('index.html enthält keine statische Content-Security-Policy.');
if (!indexHtml.includes('name="referrer" content="no-referrer"')) fail('index.html enthält keine no-referrer-Metaregel.');
if (!indexHtml.includes('id="compatibility-fallback"')) fail('index.html enthält keinen statischen Altbrowser-Fallback.');
if (!indexHtml.includes('id="vite-legacy-polyfill"') || !indexHtml.includes('id="vite-legacy-entry"')) {
  fail('index.html bindet den kontrollierten Legacy-/Polyfill-Pfad nicht ein.');
}

const catalogManifest = JSON.parse(await fs.readFile(path.join(pagesDir, deployedManifest), 'utf8'));
const databasePath = path.join(pagesDir, deployedDatabase);
const databaseStats = await fs.stat(databasePath);
for (const [field, actual, expected] of [
  ['contract', catalogManifest.contract, sourceManifest.contract],
  ['contractVersion', catalogManifest.contractVersion, sourceManifest.contractVersion],
  ['catalogVersion', catalogManifest.catalogVersion, sourceManifest.catalogVersion],
  ['database.file', catalogManifest.database?.file, sourceManifest.database.file],
  ['database.bytes', catalogManifest.database?.bytes, sourceManifest.database.bytes],
  ['database.sha256', catalogManifest.database?.sha256, sourceManifest.database.sha256],
  ['database.applicationId', catalogManifest.database?.applicationId, sourceManifest.database.applicationId],
  ['database.userVersion', catalogManifest.database?.userVersion, sourceManifest.database.userVersion],
  ['database.products', catalogManifest.database?.products, sourceManifest.database.products],
  ['codecFile', catalogManifest.codecFile, sourceManifest.codecFile],
  ['image.dictionaryFile', catalogManifest.image?.dictionaryFile, sourceManifest.image.dictionaryFile],
  ['image.dictionarySha256', catalogManifest.image?.dictionarySha256, sourceManifest.image.dictionarySha256],
]) {
  if (actual !== expected) fail(`${field} weicht vom eingecheckten Produktionsmanifest ab.`);
}
if (databaseStats.size !== sourceManifest.database.bytes) fail('Ausgelieferte SQLite-Größe stimmt nicht zum Produktionsmanifest.');
if (await sha256(databasePath) !== sourceManifest.database.sha256) fail('Ausgelieferte SQLite-SHA-256 stimmt nicht zum Produktionsmanifest.');
if (await sha256(path.join(pagesDir, imageDictionaryAsset)) !== sourceManifest.image.dictionarySha256) {
  fail('Ausgelieferter Bildschlüsselvertrag stimmt nicht zum Produktionsmanifest.');
}

const serviceWorker = await fs.readFile(path.join(pagesDir, 'sw.js'), 'utf8');
for (const precached of ['index.html', 'app.css', 'README-ERST-LESEN.html', 'package-info.css', 'icons/apple-touch-icon.png', 'vendor/sqlite/index.mjs', 'vendor/sqlite/sqlite3.wasm']) {
  if (!serviceWorker.includes(precached)) fail(`Service Worker precacht ${precached} nicht.`);
}
for (const excluded of [deployedDatabase, deployedManifest, updateManifestFile]) {
  if (serviceWorker.includes(excluded)) fail(`Service Worker darf ${excluded} nicht als App-Shell precachen.`);
}
const metadataOccurrences = serviceWorker.split(serviceWorkerBuildFile).length - 1;
if (metadataOccurrences !== 1) {
  fail(`sw.js muss ${serviceWorkerBuildFile} genau einmal als importScripts-Abhängigkeit führen; gefunden: ${metadataOccurrences}.`);
}

const allFiles = await listFiles(pagesDir);
const jsFiles = allFiles.filter((file) => /\.(?:js|mjs)$/u.test(file));
if (!jsFiles.some((file) => file.startsWith('assets/'))) fail('Kein gebautes JavaScript-Asset gefunden.');
if (!jsFiles.some((file) => /(?:^|-)legacy(?:-|\.)/.test(path.basename(file)))) {
  fail('Kein syntax-abgesenkter Legacy-Bundlepfad gefunden.');
}
const appJavaScript = (await Promise.all(jsFiles.map((file) => fs.readFile(path.join(pagesDir, file), 'utf8')))).join('\n');
for (const required of [
  'catalog/manifest.json',
  updateManifestFile,
  appVersion,
  updateManifest.buildId,
  'KH_GET_BUILD_METADATA'
]) {
  if (!appJavaScript.includes(required)) fail(`Offline-App-Build enthält nicht: ${required}`);
}
for (const forbidden of [
  'kh-checker-dach.sqlite',
  'search.openfoodfacts.org',
  'world.openfoodfacts.org/cgi/search.pl',
  '/api/v1/search',
  '/api/v1/product/',
  'api.openai.com',
  'OPENAI_API_KEY',
  'OFF_USER_AGENT',
  'process.env.OFF_USER_AGENT',
]) {
  if (appJavaScript.includes(forbidden)) fail(`Retired online/server or renamed catalog path is present in the app bundle: ${forbidden}`);
}

console.log(JSON.stringify({
  pagesValid: true,
  appVersion,
  buildId: updateManifest.buildId,
  serviceWorkerBuildFile,
  catalogVersion: sourceManifest.catalogVersion,
  databaseFilename,
  productCount: sourceManifest.database.products,
  sizeBytes: sourceManifest.database.bytes,
  sha256: sourceManifest.database.sha256,
  htmlFiles: htmlFiles.length,
  references: referenceCount,
}));
