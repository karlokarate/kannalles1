import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function source(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
}

const vite = source('vite.config.ts');
const main = source('src/main.tsx');
const pwa = source('src/pwa.ts');
const runtime = source('src/lib/pwaUpdate.ts');
const app = source('src/App.tsx');
const settings = source('src/app/SettingsScreen.tsx');
const preparePublic = source('scripts/prepare-public.mjs');
const verifyPages = source('scripts/verify-pages-build.mjs');
const publicConfig = source('scripts/public-config.mjs');
const defaultPlaywright = source('playwright.config.ts');
const updatePlaywright = source('e2e/playwright.pwa-update.config.ts');
const updateSpec = source('e2e/pwa-update.spec.ts');
const packageJson = JSON.parse(source('package.json')) as { scripts?: Record<string, string> };

describe('PWA deployment update architecture', () => {
  it('keeps one manual service-worker registration authority', () => {
    expect(vite).toContain("registerType: 'prompt'");
    expect(vite).toContain('injectRegister: null');
    expect(pwa).toContain("from 'virtual:pwa-register'");
    expect(main).not.toContain("from 'virtual:pwa-register'");
    expect(main).toContain('startPwaUpdateRuntime()');
    expect(main.indexOf('createRoot(rootElement).render')).toBeLessThan(main.indexOf('startPwaUpdateRuntime()'));
  });

  it('checks the deployment immediately and on foreground, online and interval events', () => {
    expect(pwa).toContain('controller.checkForUpdates(true)');
    expect(pwa).toContain("document.addEventListener('visibilitychange'");
    expect(pwa).toContain("window.addEventListener('focus'");
    expect(pwa).toContain("window.addEventListener('pageshow'");
    expect(pwa).toContain("window.addEventListener('online'");
    expect(pwa).toContain('APP_UPDATE_CHECK_INTERVAL_MS');
  });

  it('uses no-store checks and compares build identity before any prompt', () => {
    expect(runtime).toContain("cache: 'no-store'");
    expect(runtime).toContain("'Cache-Control': 'no-cache'");
    expect(runtime).toContain('await bridge.registration.update()');
    expect(runtime).toContain('metadata.buildId === remoteBuildId');
    expect(runtime).toContain('metadata.buildId === environment.currentBuildId');
    expect(runtime).toContain('Der aktuelle App-Build darf nicht als Update angeboten werden.');
    expect(runtime.indexOf('parseAppUpdateManifest')).toBeLessThan(runtime.indexOf('await bridge.registration.update()'));
  });

  it('embeds an exact build identity in every generated service worker', () => {
    expect(publicConfig).toContain('serviceWorkerMetadataFile');
    expect(preparePublic).toContain("contract: 'kh-checker-service-worker-build'");
    expect(preparePublic).toContain("type !== 'KH_GET_BUILD_METADATA'");
    expect(vite).toContain('importScripts: [swBuildMetadataFile]');
    expect(vite).toContain("globIgnores: ['catalog/**', 'app-update.json', 'sw-build-*.js']");
    expect(verifyPages).toContain('metadataOccurrences !== 1');
  });

  it('activates only the exact metadata-verified waiting worker', () => {
    expect(pwa).toContain('readServiceWorkerMetadata');
    expect(pwa).toContain('parseServiceWorkerBuildMetadata');
    expect(pwa).toContain('registration.waiting !== expectedWorker');
    expect(pwa).toContain("expectedWorker.postMessage({ type: 'SKIP_WAITING' })");
    expect(pwa).toContain("navigator.serviceWorker.addEventListener('controllerchange'");
    expect(pwa).toContain("expectedWorker.addEventListener('statechange'");
    expect(pwa.indexOf("expectedWorker.postMessage({ type: 'SKIP_WAITING' })"))
      .toBeGreaterThan(pwa.indexOf("navigator.serviceWorker.addEventListener('controllerchange'"));
  });

  it('repairs first installs and deleted caches without a false update button', () => {
    expect(runtime).toContain('activateCurrentBuildSilently');
    expect(runtime).toContain('der Offline-Cache wird im Hintergrund synchronisiert');
    expect(runtime).toContain('updatePromptVisible: false');
    expect(updateSpec).toContain('frische Netzwerkladen');
    expect(updateSpec).toContain('Cache Storage gelöscht');
    expect(updateSpec).toContain('pwa-update-banner');
  });

  it('keeps a genuinely newer prepared worker user-controlled and replaces old app cache entries', () => {
    expect(runtime).toContain("mode: 'waiting'");
    expect(runtime).toContain("mode: 'reload'");
    expect(runtime).toContain('der App-Cache ersetzt');
    expect(updateSpec).toContain('oldEntryUrl');
    expect(updateSpec).toContain('newEntryUrl');
    expect(updateSpec).toContain('oldEntryStillCached');
    expect(updateSpec).toContain('newEntryCached');
  });

  it('keeps deployment metadata outside the app-shell precache', () => {
    expect(vite).toContain("globIgnores: ['catalog/**', 'app-update.json', 'sw-build-*.js']");
    expect(preparePublic).toContain("path.join(targetDir, 'app-update.json')");
    expect(verifyPages).toContain("const updateManifestFile = 'app-update.json'");
    expect(verifyPages).toContain('Service Worker darf ${excluded} nicht als App-Shell precachen.');
  });

  it('runs the switchable two-deployment journey only with its dedicated server', () => {
    expect(defaultPlaywright).toContain("testIgnore: '**/pwa-update.spec.ts'");
    expect(updatePlaywright).toContain("testMatch: 'pwa-update.spec.ts'");
    expect(updatePlaywright).toContain("command: 'node start-pwa-update-preview.mjs'");
    expect(updatePlaywright).toContain("baseURL: 'http://127.0.0.1:4174'");
  });

  it('exposes both a startup prompt and a persistent manual settings action', () => {
    expect(app).toContain('<PwaUpdateBanner pwa={pwaUpdate} />');
    expect(app).toContain('data-pwa-update-state={pwaUpdate.phase}');
    expect(settings).toContain('<PwaUpdateSettings pwa={pwaUpdate} />');
    expect(source('src/app/PwaUpdateBanner.tsx')).toContain('Jetzt aktualisieren');
    expect(source('src/app/PwaUpdateSettings.tsx')).toContain('Jetzt nach Updates suchen');
  });

  it('keeps targeted unit and real browser update tests in package scripts', () => {
    expect(packageJson.scripts?.['test:pwa-update']).toContain('src/lib/pwaUpdate.test.ts');
    expect(packageJson.scripts?.['test:e2e:pwa-update']).toContain('scripts/run-pwa-update-e2e.mjs');
  });
});
