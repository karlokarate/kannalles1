import { expect, test, type BrowserContext, type Page } from '@playwright/test';

const OLD_BUILD = 'pwa-old';
const NEW_BUILD = 'pwa-new';

test.describe.configure({ mode: 'serial' });

async function activateServerBuild(page: Page, build: 'old' | 'new'): Promise<void> {
  const response = await page.request.post(`/__pwa_test__/activate/${build}`);
  expect(response.ok()).toBe(true);
  expect(await response.json()).toEqual({ activeBuild: build });
}

async function recordUpdateStates(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const states: string[] = [];
    Object.defineProperty(window, '__khPwaUpdateStates', {
      configurable: true,
      value: states
    });
    const record = () => {
      const value = document.querySelector('.app-shell')?.getAttribute('data-pwa-update-state');
      if (value && states.at(-1) !== value) states.push(value);
    };
    new MutationObserver(record).observe(document, {
      attributes: true,
      attributeFilter: ['data-pwa-update-state'],
      childList: true,
      subtree: true
    });
    document.addEventListener('DOMContentLoaded', record);
  });
}

async function updateStateHistory(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as Window & { __khPwaUpdateStates?: string[] }).__khPwaUpdateStates ?? []);
}

async function waitForServiceWorkerReady(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
}

async function installControlledBuild(page: Page, build: 'old' | 'new'): Promise<void> {
  await activateServerBuild(page, build);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.app-shell')).toHaveAttribute(
    'data-app-build',
    build === 'old' ? OLD_BUILD : NEW_BUILD
  );
  await waitForServiceWorkerReady(page);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
}

async function activeWorkerBuild(page: Page): Promise<string | null> {
  return page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    const worker = registration?.active;
    if (!worker) return null;
    return new Promise<string | null>((resolve) => {
      const channel = new MessageChannel();
      const timeout = window.setTimeout(() => resolve(null), 5_000);
      channel.port1.onmessage = (event) => {
        window.clearTimeout(timeout);
        resolve(typeof event.data?.buildId === 'string' ? event.data.buildId : null);
      };
      worker.postMessage({ type: 'KH_GET_BUILD_METADATA' }, [channel.port2]);
    });
  });
}

async function currentEntryUrl(page: Page): Promise<string> {
  const value = await page.evaluate(() => {
    const script = document.querySelector<HTMLScriptElement>('script[type="module"][src]');
    return script?.src ?? null;
  });
  if (!value) throw new Error('Vite module entry URL is missing.');
  return value;
}

async function cacheContains(page: Page, absoluteUrl: string): Promise<boolean> {
  return page.evaluate(async (url) => {
    for (const name of await caches.keys()) {
      if (await caches.open(name).then((cache) => cache.match(url))) return true;
    }
    return false;
  }, absoluteUrl);
}

async function openCachedHomeScreen(context: BrowserContext): Promise<Page> {
  const reopened = await context.newPage();
  await recordUpdateStates(reopened);
  await reopened.goto('/', { waitUntil: 'domcontentloaded' });
  return reopened;
}

test.beforeEach(async ({ page }) => {
  await activateServerBuild(page, 'old');
});

test('ein frischer Netzwerkladen ohne Cache zeigt die Erstinstallation niemals als Update an', async ({ page }) => {
  await recordUpdateStates(page);
  await activateServerBuild(page, 'new');
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.app-shell')).toHaveAttribute('data-app-build', NEW_BUILD);
  await waitForServiceWorkerReady(page);

  await expect.poll(() => page.locator('.app-shell').getAttribute('data-pwa-update-state'))
    .toBe('up-to-date');
  await expect(page.getByTestId('pwa-update-banner')).toBeHidden();
  expect(await updateStateHistory(page)).not.toContain('update-available');
  expect(await activeWorkerBuild(page)).toBe(NEW_BUILD);
});

test('wenn nur Cache Storage gelöscht wurde, repariert die frische App den Worker ohne falschen Updatehinweis', async ({ page }) => {
  await recordUpdateStates(page);
  await installControlledBuild(page, 'old');
  await activateServerBuild(page, 'new');

  // Reproduce the reported browser state: Cache Storage gelöscht, but the old
  // service-worker registration remains. The next navigation falls through to
  // the network and therefore already loads the freshly deployed app bundle.
  await page.evaluate(async () => {
    await Promise.all((await caches.keys()).map((name) => caches.delete(name)));
  });
  await page.goto(`/?cache-repair=${Date.now()}`, { waitUntil: 'domcontentloaded' });

  await expect(page.locator('.app-shell')).toHaveAttribute('data-app-build', NEW_BUILD);
  await expect.poll(() => page.locator('.app-shell').getAttribute('data-pwa-update-state'))
    .toBe('up-to-date');
  await expect(page.getByTestId('pwa-update-banner')).toBeHidden();
  expect(await updateStateHistory(page)).not.toContain('update-available');
  await expect.poll(() => activeWorkerBuild(page)).toBe(NEW_BUILD);
  await expect.poll(() => page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    return Boolean(registration?.waiting);
  })).toBe(false);
});

test('eine gecachte Homescreen-App bietet einen echten neuen Deploy an und ersetzt den alten App-Cache', async ({ context, page }) => {
  await recordUpdateStates(page);
  await installControlledBuild(page, 'old');
  const oldEntryUrl = await currentEntryUrl(page);
  expect(await cacheContains(page, oldEntryUrl)).toBe(true);

  await page.evaluate(() => localStorage.setItem('kh:pwa-update-e2e', 'keep-me'));
  await page.getByRole('button', { name: 'Einstellungen', exact: true }).click();
  await page.getByLabel('Modern & ruhig').check();
  await expect(page.locator('.app-shell')).toHaveAttribute('data-visual-theme', 'standard');

  await activateServerBuild(page, 'new');

  // Keep the old client open so the new worker must enter waiting. Opening from
  // the homescreen profile now serves the old app shell from Workbox cache.
  const reopened = await openCachedHomeScreen(context);
  const shell = reopened.locator('.app-shell');
  await expect(shell).toHaveAttribute('data-app-build', OLD_BUILD);
  await expect(shell).toHaveAttribute('data-pwa-remote-build', NEW_BUILD);
  await expect(shell).toHaveAttribute('data-pwa-update-state', 'update-available');

  const prompt = reopened.getByTestId('pwa-update-banner');
  await expect(prompt).toBeVisible();
  await expect(prompt).toContainText('Neue App-Version verfügbar');
  await expect(prompt).toContainText('lokalen Nutzerdaten bleiben erhalten');

  await reopened.getByTestId('pwa-update-apply').click();
  await expect.poll(async () => reopened.locator('.app-shell').getAttribute('data-app-build'), {
    timeout: 60_000
  }).toBe(NEW_BUILD);
  await expect.poll(async () => reopened.locator('.app-shell').getAttribute('data-pwa-update-state'))
    .toBe('up-to-date');
  await expect(reopened.getByTestId('pwa-update-banner')).toBeHidden();

  const newEntryUrl = await currentEntryUrl(reopened);
  expect(newEntryUrl).not.toBe(oldEntryUrl);
  const oldEntryStillCached = await expect.poll(() => cacheContains(reopened, oldEntryUrl), {
    timeout: 30_000
  }).toBe(false).then(() => false);
  expect(oldEntryStillCached).toBe(false);
  const newEntryCached = await cacheContains(reopened, newEntryUrl);
  expect(newEntryCached).toBe(true);

  expect(await reopened.evaluate(() => localStorage.getItem('kh:pwa-update-e2e'))).toBe('keep-me');
  await expect(reopened.locator('.app-shell')).toHaveAttribute('data-visual-theme', 'standard');

  await reopened.getByRole('button', { name: 'Einstellungen', exact: true }).click();
  await expect(reopened.getByTestId('pwa-update-settings')).toBeVisible();
  await expect(reopened.getByTestId('pwa-update-state')).toHaveText('Aktuell');
  await reopened.getByTestId('pwa-update-check').click();
  await expect(reopened.getByTestId('pwa-update-state')).toHaveText('Aktuell');

  const updateManifestCached = await reopened.evaluate(async () => {
    const target = new URL('app-update.json', document.baseURI).href;
    for (const name of await caches.keys()) {
      if (await caches.open(name).then((cache) => cache.match(target))) return true;
    }
    return false;
  });
  expect(updateManifestCached).toBe(false);
  expect(await updateStateHistory(reopened)).toContain('update-available');

  await page.close();
});
