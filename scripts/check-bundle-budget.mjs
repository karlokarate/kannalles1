#!/usr/bin/env node
import { gzipSync } from 'node:zlib';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const dist = path.join(root, 'dist');
const assets = path.join(root, 'dist', 'assets');
const files = (await readdir(assets))
  .filter((name) => /\.(?:js|css)$/.test(name))
  .map((name) => ({ file: name, absolute: path.join(assets, name) }));
try {
  await readFile(path.join(dist, 'app.css'));
  files.push({ file: 'app.css', absolute: path.join(dist, 'app.css') });
} catch {
  // A modern-only build may emit CSS under assets instead.
}
files.sort((a, b) => a.file.localeCompare(b.file, 'en'));
if (!files.length) throw new Error('Bundle-Budget: dist/assets enthält keine JS-/CSS-Dateien.');

const limits = {
  largestJsBytes: Number(process.env.BUNDLE_MAX_JS_BYTES || 500_000),
  largestJsGzipBytes: Number(process.env.BUNDLE_MAX_JS_GZIP_BYTES || 150_000),
  modernPathJsGzipBytes: Number(process.env.BUNDLE_MAX_MODERN_JS_GZIP_BYTES || 180_000),
  legacyPathJsGzipBytes: Number(process.env.BUNDLE_MAX_LEGACY_JS_GZIP_BYTES || 210_000),
  totalCssGzipBytes: Number(process.env.BUNDLE_MAX_TOTAL_CSS_GZIP_BYTES || 30_000)
};
const entries = [];
for (const candidate of files) {
  const bytes = await readFile(candidate.absolute);
  entries.push({
    file: candidate.file,
    type: path.extname(candidate.file).slice(1),
    bytes: bytes.length,
    gzipBytes: gzipSync(bytes, { level: 9 }).length
  });
}
const js = entries.filter((entry) => entry.type === 'js');
const css = entries.filter((entry) => entry.type === 'css');
const legacyJs = js.filter((entry) => /(?:^|-)legacy(?:-|\.)/.test(entry.file));
const modernJs = js.filter((entry) => !legacyJs.includes(entry));
const largestJs = js.reduce((largest, entry) => entry.bytes > (largest?.bytes ?? -1) ? entry : largest, null);
const totalJsGzip = js.reduce((sum, entry) => sum + entry.gzipBytes, 0);
const modernPathJsGzip = modernJs.reduce((sum, entry) => sum + entry.gzipBytes, 0);
const legacyPathJsGzip = legacyJs.reduce((sum, entry) => sum + entry.gzipBytes, 0);
const totalCssGzip = css.reduce((sum, entry) => sum + entry.gzipBytes, 0);
const failures = [];
if (!largestJs) failures.push('kein JavaScript-Bundle');
if (!legacyJs.length) failures.push('kein Legacy-JavaScript-Pfad');
if (largestJs && largestJs.bytes > limits.largestJsBytes) failures.push(`größtes JS ${largestJs.bytes} > ${limits.largestJsBytes}`);
if (largestJs && largestJs.gzipBytes > limits.largestJsGzipBytes) failures.push(`größtes JS gzip ${largestJs.gzipBytes} > ${limits.largestJsGzipBytes}`);
if (modernJs.length && modernPathJsGzip > limits.modernPathJsGzipBytes) {
  failures.push(`moderner JS-Pfad gzip ${modernPathJsGzip} > ${limits.modernPathJsGzipBytes}`);
}
if (legacyPathJsGzip > limits.legacyPathJsGzipBytes) {
  failures.push(`Legacy-JS-Pfad gzip ${legacyPathJsGzip} > ${limits.legacyPathJsGzipBytes}`);
}
if (totalCssGzip > limits.totalCssGzipBytes) failures.push(`CSS gzip gesamt ${totalCssGzip} > ${limits.totalCssGzipBytes}`);

console.log(JSON.stringify({
  bundleBudget: failures.length ? 'failed' : 'passed',
  limits,
  largestJs,
  totalJsGzip,
  modernPathJsGzip,
  legacyPathJsGzip,
  totalCssGzip,
  entries
}, null, 2));
if (failures.length) throw new Error(`Bundle-Budget überschritten: ${failures.join('; ')}`);
