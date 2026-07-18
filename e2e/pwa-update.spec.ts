import { expect, test } from '@playwright/test';

const OLD_BUILD = 'pwa-old';
const NEW_BUILD = 'pwa-new';

test('eine bereits installierte App prüft beim Öffnen den Deploy und aktualisiert nur nach Zustimmung', async ({ context, page }) => {
  // A retry may reuse the switchable test server after the first attempt has
  // selected the new deployment. Reset it before the browser is opened.
  const reset = await page.request.post('/__pwa_test__/activate/old');
  expect(reset.ok()).toBe(true);

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const oldShell = page.locator('.app-shell');
  await expect(oldShell).toHaveAttribute('data-app-build', OLD_BUILD);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });

  // Reload once so the old deployment is demonstrably controlled by its SW,
  // matching an app that has already been used and locally installed.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('.app-shell')).toHaveAttribute('data-app-build', OLD_BUILD);
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);

  await page.evaluate(() => localStorage.setItem('kh:pwa-update-e2e', 'keep-me'));
  await page.getByRole('button', { name: 'Einstellungen', exact: true }).click();
  await page.getByLabel('Modern & ruhig').check();
  await expect(page.locator('.app-shell')).toHaveAttribute('data-visual-theme', 'standard');

  const activated = await page.request.post('/__pwa_test__/activate/new');
  expect(activated.ok()).toBe(true);
  expect(await activated.json()).toEqual({ activeBuild: 'new' });

  // Keep the already used old app open. This prevents a no-client activation
  // from silently replacing it before the newly opened window can display the
  // explicit user-controlled update prompt.
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
