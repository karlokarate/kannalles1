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

  it('never turns Workbox lifecycle state into an unverified update prompt', () => {
    expect(pwa).toContain('controller.markWorkerWaiting()');
    expect(pwa).not.toContain('controller.markUpdateAvailable()');
    expect(runtime).toContain('A waiting worker alone is not proof of a newer app');
    expect(runtime).toContain('verifiedUpdateAvailable');
    expect(runtime).toContain('verifiedWaitingBuildId');
    expect(runtime).toContain('verifiedWaitingBuildId !== mutable.remoteBuildId');
    expect(runtime).toContain('updatePromptVisible: false');
  });

  it('uses no-store deployment checks before comparing build identity', () => {
    expect(runtime).toContain("cache: 'no-store'");
    expect(runtime).toContain("'Cache-Control': 'no-cache'");
    expect(runtime).toContain('await bridge.registration.update()');
    expect(runtime.indexOf('remoteBuildId: remote.buildId'))
      .toBeLessThan(runtime.indexOf('await bridge.registration.update()'));
  });

  it('silently reconciles a current network shell and reloads only a verified stale shell', () => {
    expect(runtime).toContain('bridge.activateWaitingWorker(false)');
    expect(runtime).toContain('await bridge.activateWaitingWorker(true)');
    expect(runtime).toContain('remote.buildId === environment.currentBuildId');
    expect(runtime).toContain('canApply: bridge !== null');
    expect(pwa).toContain('activateWaitingServiceWorker(registration, reloadPage)');
    expect(pwa).toContain('if (reloadPage) window.location.reload()');
  });

  it('does not activate an older waiting worker while a newer build is installing', () => {
    const marker = 'Prefer an actually installing worker over an older waiting worker';
    const start = runtime.indexOf(marker);
    const end = runtime.indexOf('pendingWorkerBuildId = null;', start);
    const updateResultBlock = runtime.slice(start, end);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    expect(updateResultBlock.indexOf('const installing = bridge.registration.installing'))
      .toBeLessThan(updateResultBlock.indexOf('if (bridge.registration.waiting)'));
    expect(runtime).toContain('pendingWorkerBuildId = remote.buildId');
  });

  it('activates the exact waiting worker and replaces caches through Workbox activation', () => {
    expect(pwa).toContain('registration.waiting');
    expect(pwa).toContain("waiting.postMessage({ type: 'SKIP_WAITING' })");
    expect(pwa).toContain("navigator.serviceWorker.addEventListener('controllerchange'");
    expect(pwa).toContain("waiting.addEventListener('statechange'");
    expect(pwa.indexOf("waiting.postMessage({ type: 'SKIP_WAITING' })"))
      .toBeGreaterThan(pwa.indexOf("navigator.serviceWorker.addEventListener('controllerchange'"));
  });

  it('keeps only verified prepared updates actionable while offline', () => {
    expect(runtime).toContain('Eine verifizierte neue App-Version');
    expect(runtime).toContain('kann offline aktiviert werden');
    expect(runtime).toContain('verifiedWaitingBuildId === state.remoteBuildId');
    expect(runtime).toContain('canApply: bridge !== null');
  });

  it('keeps deployment metadata outside the app-shell precache', () => {
    expect(vite).toContain("globIgnores: ['catalog/**', 'app-update.json']");
    expect(preparePublic).toContain("contract: 'kh-checker-app-update'");
    expect(preparePublic).toContain("path.join(targetDir, 'app-update.json')");
    expect(verifyPages).toContain("const updateManifestFile = 'app-update.json'");
    expect(verifyPages).toContain('Service Worker darf ${excluded} nicht als App-Shell precachen.');
  });

  it('proves both cache-cleared current shells and genuinely stale homescreen shells', () => {
    expect(defaultPlaywright).toContain("testIgnore: '**/pwa-update.spec.ts'");
    expect(updatePlaywright).toContain("testMatch: 'pwa-update.spec.ts'");
    expect(updatePlaywright).toContain("command: 'node start-pwa-update-preview.mjs'");
    expect(updateSpec).toContain('Cache Storage was deleted');
    expect(updateSpec).toContain("data-pwa-update-state', 'up-to-date'");
    expect(updateSpec).toContain("data-pwa-update-state', 'update-available'");
    expect(updateSpec).toContain('caches.match(url)');
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
