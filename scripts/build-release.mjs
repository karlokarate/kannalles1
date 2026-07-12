#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  access, cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { runPython } from './run-python.mjs';
import { isSourceReleasePathAllowed } from './release-source-policy.mjs';
import { validateDeploymentProfile } from './deployment-profile.mjs';

const root = path.resolve(import.meta.dirname, '..');
const packageJson = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const version = packageJson.version;
const outputDir = path.resolve(process.env.OUTPUT_DIR || path.join(root, 'release-out'));
const sourceArchive = `ENTWICKLER-QUELLCODE-v${version}.zip`;
const completeArchive = `kh-checker-v${version}-komplett.zip`;
const defaultEpoch = (await readFile(path.join(root, 'release/source-date-epoch.txt'), 'utf8')).trim();
const epoch = Number(process.env.SOURCE_DATE_EPOCH || defaultEpoch);
if (!Number.isInteger(epoch) || epoch <= 0) throw new Error('SOURCE_DATE_EPOCH muss eine positive Ganzzahl sein.');
if (process.env.RELEASE_SKIP_CHECK === '1') throw new Error('RELEASE_SKIP_CHECK ist für Releases nicht zulässig.');
const buildDate = new Date(epoch * 1000).toISOString();
const prevalidated = process.env.RELEASE_PREVALIDATED === '1';
const deployment = validateDeploymentProfile(
  process.env.RELEASE_DEPLOYMENT_PROFILE || 'manual-only',
  process.env.VITE_DATA_GATEWAY_URL || ''
);
if (prevalidated && process.env.RELEASE_BROWSER_GATE !== 'passed_at_build') {
  throw new Error('Prevalidated Release benötigt RELEASE_BROWSER_GATE=passed_at_build.');
}

function runNode(relative, args = []) {
  const result = spawnSync(process.execPath, [path.join(root, relative), ...args], {
    cwd: root, stdio: 'inherit', env: process.env, windowsHide: true
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function runNpm(script) {
  const npmCli = process.env.npm_execpath;
  const result = npmCli
    ? spawnSync(process.execPath, [npmCli, 'run', script], { cwd: root, stdio: 'inherit', env: process.env, windowsHide: true })
    : spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', script], {
      cwd: root, stdio: 'inherit', env: process.env, windowsHide: true
    });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

async function sha256(file) {
  return createHash('sha256').update(await readFile(file)).digest('hex');
}

async function walk(directory, prefix = '') {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const relative = path.posix.join(prefix, entry.name);
    const absolute = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Symlink ist im Release-Stage nicht erlaubt: ${relative}`);
    if (entry.isDirectory()) files.push(...await walk(absolute, relative));
    else if (entry.isFile()) files.push(relative);
  }
  return files;
}

await mkdir(outputDir, { recursive: true });
const workDir = await mkdtemp(path.join(os.tmpdir(), 'kh-release-build-'));
try {
  if (prevalidated) {
    await access(path.join(root, 'dist/index.html'));
    runNpm('api:verify');
    runNpm('check:version');
  } else {
    runNpm('check');
    runNpm('audit');
    runNpm('test:e2e');
  }

  const sourceRoot = path.join(workDir, 'source');
  const sourceStage = path.join(sourceRoot, `kh-checker-v${version}-source`);
  await cp(root, sourceStage, {
    recursive: true,
    filter(source) {
      const relative = path.relative(root, source);
      if (!relative) return true;
      if (!isSourceReleasePathAllowed(relative)) return false;
      return !path.resolve(source).startsWith(`${outputDir}${path.sep}`);
    }
  });
  const sourceZip = path.join(outputDir, sourceArchive);
  let result = runPython([
    path.join(root, 'scripts/reproducible-zip.py'), '--source', sourceRoot,
    '--output', sourceZip, '--epoch', String(epoch)
  ], { cwd: root });
  if (result.status !== 0) process.exit(result.status ?? 1);
  result = runPython([
    path.join(root, '.github/scripts/validate_source_bundle.py'), '--zip', sourceZip
  ], { cwd: root });
  if (result.status !== 0) process.exit(result.status ?? 1);

  const site = path.join(workDir, 'site');
  await cp(path.join(root, 'dist'), site, { recursive: true });
  for (const name of ['LICENSE', 'README.md', 'CHANGELOG.md', 'README-ERST-LESEN.txt', `RELEASE-NOTES-v${version}.txt`]) {
    await cp(path.join(root, name), path.join(site, name));
  }
  await writeFile(path.join(site, '.nojekyll'), '');
  await writeFile(
    path.join(site, 'VERSION.txt'),
    `KH Checker v${version}\nBuild date: ${buildDate}\nDeployment: static HTTPS PWA (${deployment.profile})\n`
  );

  const openApi = path.join(site, 'api-docs/search-api.openapi.json');
  const openApiYaml = path.join(site, 'api-docs/search-api.openapi.yaml');
  const generation = path.join(site, 'api-docs/generation-manifest.json');
  const generationJson = JSON.parse(await readFile(generation, 'utf8'));
  const releaseManifest = {
    schemaVersion: 3,
    name: 'KH Checker',
    version,
    artifactType: 'static-pwa',
    deploymentProfile: deployment.profile,
    configuredGatewayUrl: deployment.gatewayUrl || null,
    buildDateUtc: buildDate,
    sourceArchive: { file: sourceArchive, sha256: await sha256(sourceZip), embedded: false },
    runtime: {
      staticAssetHostingRequiresApplicationServer: false,
      browserDataAccess: 'gateway-only',
      gatewayRuntimeRequiredForGlobalSearch: true,
      gatewayOptionalForManualAndOfflineUse: true,
      primarySearchProvider: 'self-hosted-search-index',
      searchFallback: 'open-food-facts-legacy',
      nativeAndroidApk: false
    },
    qualityGatesSkipped: false,
    qualityGateMode: prevalidated ? 'prevalidated_by_ci_pipeline' : 'executed_by_release_script',
    browserGateAtBuild: 'passed_at_build',
    browserGateRequiredBeforeDeploy: true,
    browserGatePolicy: 'required_chromium_firefox_webkit_before_release',
    contractGeneration: {
      authoritativeSource: 'contracts/source/search-api.contract.mjs',
      openapiVersion: '3.1.0',
      openapi: { file: 'api-docs/search-api.openapi.json', sha256: await sha256(openApi) },
      openapiYaml: { file: 'api-docs/search-api.openapi.yaml', sha256: await sha256(openApiYaml) },
      generationManifest: { file: 'api-docs/generation-manifest.json', sha256: await sha256(generation) },
      tools: generationJson.tools
    }
  };
  await writeFile(path.join(site, 'release-manifest.json'), `${JSON.stringify(releaseManifest, null, 2)}\n`);

  const files = (await walk(site)).filter((file) => file !== 'SHA256SUMS.txt');
  const sums = [];
  for (const file of files) sums.push(`${await sha256(path.join(site, file))}  ${file}`);
  await writeFile(path.join(site, 'SHA256SUMS.txt'), `${sums.join('\n')}\n`);

  const completeZip = path.join(outputDir, completeArchive);
  result = runPython([
    path.join(root, 'scripts/reproducible-zip.py'), '--source', site,
    '--output', completeZip, '--epoch', String(epoch)
  ], { cwd: root });
  if (result.status !== 0) process.exit(result.status ?? 1);
  runNode('scripts/verify-release.mjs', [completeZip]);
  console.log(JSON.stringify({ sourceArchive: sourceZip, completeArchive: completeZip }));
} finally {
  await rm(workDir, { recursive: true, force: true });
}
