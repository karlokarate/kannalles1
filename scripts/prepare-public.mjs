import fs from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import autoprefixer from 'autoprefixer';
import postcss from 'postcss';
import {
  javascriptJsonLiteral,
  validateAppVersion,
  validatePublicGatewayUrl
} from './public-config.mjs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageJson = JSON.parse(await fs.readFile(path.join(rootDir, 'package.json'), 'utf8'));
const version = validateAppVersion(packageJson.version);
const gatewayUrl = validatePublicGatewayUrl(process.env.VITE_DATA_GATEWAY_URL || '');
const gatewayUrlLiteral = javascriptJsonLiteral(gatewayUrl);
const sourceDir = path.join(rootDir, 'public-template');
const targetDir = path.join(rootDir, '.generated-public');
const textExtensions = new Set(['.html', '.js', '.css', '.txt', '.json', '.md', '.webmanifest', '.yaml', '.yml']);
let versionTokenCount = 0;
let gatewayTokenCount = 0;

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
    versionTokenCount += original.split('__KH_APP_VERSION__').length - 1;
    gatewayTokenCount += original.split('__KH_DATA_GATEWAY_URL_JSON__').length - 1;
    let replaced = original.replaceAll('__KH_APP_VERSION__', version);
    replaced = replaced.replaceAll('__KH_DATA_GATEWAY_URL_JSON__', gatewayUrlLiteral);
    if (replaced.includes('__KH_APP_VERSION__') || replaced.includes('__KH_DATA_GATEWAY_URL_JSON__')) {
      throw new Error(`Unresolved public-build token in ${path.relative(rootDir, absolute)}`);
    }
    await fs.writeFile(absolute, replaced);
  }
}

await replaceTokens(targetDir);
if (versionTokenCount < 1 || gatewayTokenCount !== 1) {
  throw new Error(`Unexpected public token inventory: version=${versionTokenCount}, gateway=${gatewayTokenCount}.`);
}
const syntax = spawnSync(process.execPath, ['--check', path.join(targetDir, 'api-diagnose.js')], {
  cwd: rootDir,
  encoding: 'utf8',
  windowsHide: true
});
if (syntax.status !== 0) {
  throw new Error(`Generated API diagnosis script is not valid JavaScript: ${syntax.stderr || syntax.stdout}`);
}
console.log(`Public assets and generated API documentation prepared for KH Checker v${version}.`);
