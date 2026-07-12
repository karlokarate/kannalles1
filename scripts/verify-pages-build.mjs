import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pagesDir = process.argv[2] ? path.resolve(process.argv[2]) : path.join(rootDir, 'dist');
const pagesLabel = path.relative(rootDir, pagesDir) || '.';
const packageJson = JSON.parse(await fs.readFile(path.join(rootDir, 'package.json'), 'utf8'));
const appVersion = String(packageJson.version);
const contractFile = `contracts/kh-checker-api-config-user-needs-v${appVersion}.json`;
const expectedGateway = String(process.env.VITE_DATA_GATEWAY_URL || '').trim();

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

const requiredFiles = [
  'index.html',
  'manifest.webmanifest',
  'sw.js',
  'API-DIAGNOSE.html',
  'README-ERST-LESEN.html',
  'api-diagnose.js',
  'package-info.css',
  'icons/apple-touch-icon.png',
  'api-docs/index.html',
  'api-docs/search-api.openapi.json',
  'api-docs/search-api.openapi.yaml',
  'api-docs/generation-manifest.json',
  contractFile
];
await Promise.all(requiredFiles.map(requireFile));

const htmlFiles = ['index.html', 'API-DIAGNOSE.html', 'README-ERST-LESEN.html'];
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
const manifest = JSON.parse(await fs.readFile(path.join(pagesDir, 'manifest.webmanifest'), 'utf8'));
if (manifest.id !== './') fail(`manifest.id muss "./" sein, ist aber ${JSON.stringify(manifest.id)}`);
if (manifest.start_url !== './') fail(`manifest.start_url muss "./" sein, ist aber ${JSON.stringify(manifest.start_url)}`);
if (manifest.scope !== './') fail(`manifest.scope muss "./" sein, ist aber ${JSON.stringify(manifest.scope)}`);
if (manifest.display !== 'standalone') fail(`manifest.display muss "standalone" sein, ist aber ${JSON.stringify(manifest.display)}`);
if (manifest.orientation !== 'any') fail(`manifest.orientation muss "any" sein, ist aber ${JSON.stringify(manifest.orientation)}`);
if (!Array.isArray(manifest.icons) || manifest.icons.length < 2) fail('Manifest benötigt mindestens zwei App-Icons.');

for (const icon of manifest.icons) {
  const localPath = normalizeLocalReference(String(icon?.src ?? ''));
  if (!localPath) fail(`ungültiger lokaler Icon-Pfad: ${JSON.stringify(icon?.src)}`);
  await requireFile(localPath);
}

if (!/rel=["']manifest["']/i.test(indexHtml)) fail('index.html bindet kein Web-App-Manifest ein.');
if (!/apple-touch-icon/i.test(indexHtml)) fail('index.html bindet kein Apple-Touch-Icon ein.');

if (!indexHtml.includes('Content-Security-Policy')) fail('index.html enthält keine statische Content-Security-Policy.');
if (!indexHtml.includes('name="referrer" content="no-referrer"')) fail('index.html enthält keine no-referrer-Metaregel.');

const serviceWorker = await fs.readFile(path.join(pagesDir, 'sw.js'), 'utf8');
for (const precached of ['index.html', 'API-DIAGNOSE.html', 'README-ERST-LESEN.html', 'api-diagnose.js', 'package-info.css', 'icons/apple-touch-icon.png', contractFile]) {
  if (!serviceWorker.includes(precached)) fail(`Service Worker precacht ${precached} nicht.`);
}

const jsFiles = (await listFiles(pagesDir)).filter((file) => file.endsWith('.js') && file.startsWith('assets/'));
if (!jsFiles.length) fail('Kein gebautes JavaScript-Asset gefunden.');
const appJavaScript = (await Promise.all(jsFiles.map((file) => fs.readFile(path.join(pagesDir, file), 'utf8')))).join('\n');
if (expectedGateway && !appJavaScript.includes(expectedGateway)) fail('Der statische Build enthält nicht die konfigurierte Gateway-URL.');
if (!appJavaScript.includes('/api/search')) fail('Der statische Build enthält keinen Gateway-Suchpfad /api/search.');
if (!appJavaScript.includes('/api/product/')) fail('Der statische Build enthält keinen Gateway-Produktpfad /api/product/.');
if (appJavaScript.includes('/api/health')) fail('Der statische Build darf keinen automatischen Same-Origin-Gateway-Probe-Endpunkt enthalten.');
if (appJavaScript.includes('boost_phrase')) fail('Der statische App-Build soll keinen zusätzlichen Search-a-licious-Phrase-Boost senden.');
if (!appJavaScript.includes(appVersion)) fail(`Der App-Build enthält die package.json-Version ${appVersion} nicht.`);
for (const forbidden of ['OPENAI_API_KEY', 'OFF_USER_AGENT', 'process.env.OFF_USER_AGENT']) {
  if (appJavaScript.includes(forbidden)) fail(`Server-/Secret-Konfiguration ist im statischen App-Build enthalten: ${forbidden}`);
}

const diagnosticJavaScript = await fs.readFile(path.join(pagesDir, 'api-diagnose.js'), 'utf8');
if (expectedGateway && !diagnosticJavaScript.includes(expectedGateway)) fail('Das Diagnosewerkzeug enthält nicht die konfigurierte Gateway-URL.');
if (!diagnosticJavaScript.includes('/api/search')) fail('Das Diagnosewerkzeug prüft den Gateway-Suchpfad nicht.');
if (!diagnosticJavaScript.includes('/api/product/')) fail('Das Diagnosewerkzeug prüft den Gateway-Produktpfad nicht.');
if (diagnosticJavaScript.includes('boost_phrase')) fail('Das Diagnosewerkzeug muss denselben kompakten Suchpfad ohne Phrase-Boost testen.');
if (!diagnosticJavaScript.includes(`const APP_VERSION = '${appVersion}'`)) fail('Das Diagnosewerkzeug enthält nicht die aktuelle Paketversion.');

const contract = JSON.parse(await fs.readFile(path.join(pagesDir, contractFile), 'utf8'));
if (contract?.application?.version !== appVersion) fail('Der maschinenlesbare Runtime-Vertrag enthält nicht die aktuelle App-Version.');
const generator = contract?.qualityAndTooling?.generatorPipeline;
if (generator?.authoritativeInput !== 'contracts/source/search-api.contract.mjs') fail('Der Runtime-Vertrag nennt nicht die kanonische Generatorquelle.');
if (generator?.clientGenerator !== 'Orval fetch') fail('Der Runtime-Vertrag nennt nicht den Orval-Fetch-Generator.');
const openapi = JSON.parse(await fs.readFile(path.join(pagesDir, 'api-docs/search-api.openapi.json'), 'utf8'));
if (openapi?.openapi !== '3.1.0' || openapi?.info?.version !== appVersion) fail('Die eingebettete OpenAPI-Datei passt nicht zur App-Version.');
if (openapi?.['x-kh-generator']?.maximumDirectSearchBackendsPerAction !== 2) fail('Die OpenAPI-KH-Regel für maximal zwei Suchbackends fehlt.');

console.log(`GitHub-Pages-Build v${appVersion} geprüft: ${htmlFiles.length} HTML-Dateien, ${referenceCount} lokale/externe Referenzen, ${manifest.icons.length} Manifest-Icons, precachte Begleitseiten und Gateway-only API-Pfade sind vorhanden.`);
