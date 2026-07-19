import { expect, test, type Page } from '@playwright/test';

const OLD_BUILD = 'pwa-old';
const NEW_BUILD = 'pwa-new';

test.describe.configure({ mode: 'serial' });

async function activateServerBuild(page: Page, build: 'old' | 'new'): Promise<void> {
  const response = await page.request.post(`/__pwa_test__/activate/${build}`);
  expect(response.ok()).toBe(true);
  expect(await response.json()).toEqual({ activeBuild: build });
}

async function installAndControlOldBuild(page: Page): Promise<void> {
  await activateServerBuild(page, 'old');
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.app-shell')).toHaveAttribute('data-app-build', OLD_BUILD);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('.app-shell')).toHaveAttribute('data-app-build', OLD_BUILD);
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
}

test('ein netzwerkfrischer aktueller Build zeigt nach gelöschtem Cache kein falsches Update an', async ({ page }) => {
  await installAndControlOldBuild(page);
  await activateServerBuild(page, 'new');

  // Reproduce the reported state: Cache Storage was deleted, but the old
  // service-worker registration still exists. The next navigation therefore
  // loads the current deployment from the network while an older registration
  // discovers a waiting worker for exactly that same current build.
  await page.evaluate(async () => {
    await Promise.all((await caches.keys()).map((name) => caches.delete(name)));
  });
  await page.reload({ waitUntil: 'domcontentloaded' });

  const shell = page.locator('.app-shell');
  await expect(shell).toHaveAttribute('data-app-build', NEW_BUILD);
  await expect(shell).toHaveAttribute('data-pwa-remote-build', NEW_BUILD);
  await expect(shell).toHaveAttribute('data-pwa-update-state', 'up-to-date');
  await expect(page.getByTestId('pwa-update-banner')).toBeHidden();

  await expect.poll(() => page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    return registration?.waiting === null;
  })).toBe(true);
  await expect.poll(() => page.evaluate(async () => (await caches.keys()).length > 0)).toBe(true);

  await page.getByRole('button', { name: 'Einstellungen', exact: true }).click();
  await expect(page.getByTestId('pwa-update-state')).toHaveText('Aktuell');
  await expect(page.getByTestId('pwa-update-settings-apply')).toHaveCount(0);
});

test('eine wirklich veraltete Homescreen-App informiert den Nutzer und ersetzt nach Zustimmung den alten Cache', async ({ context, page }) => {
  await installAndControlOldBuild(page);
  const oldScriptUrl = await page.evaluate(() => {
    const scripts = [...document.querySelectorAll<HTMLScriptElement>('script[src]')];
    return scripts.map((script) => script.src).find((src) => src.includes('/assets/')) ?? null;
  });
  expect(oldScriptUrl).not.toBeNull();

  await page.evaluate(() => localStorage.setItem('kh:pwa-update-e2e', 'keep-me'));
  await page.getByRole('button', { name: 'Einstellungen', exact: true }).click();
  await page.getByLabel('Modern & ruhig').check();
  await expect(page.locator('.app-shell')).toHaveAttribute('data-visual-theme', 'standard');

  await activateServerBuild(page, 'new');

  // Keep the already used old app open. A second Homescreen-style window is
  // served by the intact old precache and must therefore be offered the newer
  // deployment instead of silently pretending it is already current.
  const reopened = await context.newPage();
  await reopened.goto('/', { waitUntil: 'domcontentloaded' });
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

  expect(await reopened.evaluate(() => localStorage.getItem('kh:pwa-update-e2e'))).toBe('keep-me');
  await expect(reopened.locator('.app-shell')).toHaveAttribute('data-visual-theme', 'standard');
  if (oldScriptUrl) {
    await expect.poll(() => reopened.evaluate(
      async (url) => (await caches.match(url)) === undefined,
      oldScriptUrl
    )).toBe(true);
  }

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

  await page.close();
});
