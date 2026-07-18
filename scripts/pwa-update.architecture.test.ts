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

  it('uses no-store checks before invoking the browser update algorithm', () => {
    expect(runtime).toContain("cache: 'no-store'");
    expect(runtime).toContain("'Cache-Control': 'no-cache'");
    expect(runtime).toContain('await bridge.registration.update()');
    expect(runtime).toContain('await bridge.applyUpdate()');
    expect(runtime).toContain('updatePromptVisible: true');
  });

  it('keeps deployment metadata outside the app-shell precache', () => {
    expect(vite).toContain("globIgnores: ['catalog/**', 'app-update.json']");
    expect(preparePublic).toContain("contract: 'kh-checker-app-update'");
    expect(preparePublic).toContain("path.join(targetDir, 'app-update.json')");
    expect(verifyPages).toContain("const updateManifestFile = 'app-update.json'");
    expect(verifyPages).toContain('Service Worker darf ${excluded} nicht als App-Shell precachen.');
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
