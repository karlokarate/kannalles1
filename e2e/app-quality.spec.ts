import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import {
  collectForbiddenProductRequests,
  openAppShell,
} from './catalog-harness';

test('App-Shell, Hauptnavigation und Startansicht bleiben zugänglich', async ({ page }) => {
  const forbidden = collectForbiddenProductRequests(page);
  await openAppShell(page);

  const navigation = page.getByRole('navigation', { name: 'Hauptnavigation' });
  await expect(navigation).toBeVisible();
  for (const label of ['Rechner', 'Verlauf', 'Favoriten', 'Einstellungen']) {
    await expect(navigation.getByRole('button', { name: label, exact: true })).toBeVisible();
  }

  const accessibility = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(accessibility.violations).toEqual([]);
  forbidden.assertNone();
});

test('deterministische manuelle Berechnung funktioniert ohne Produktnetzwerk', async ({ page }) => {
  const forbidden = collectForbiddenProductRequests(page);
  await openAppShell(page);

  await page.getByRole('button', { name: 'Manuell', exact: true }).click();
  const label = page.getByLabel('Bezeichnung');
  await label.fill('Testbrot');
  await page.getByLabel('KH pro 100 g').fill('40');
  await page.getByLabel('Menge in g').fill('100');

  await expect(label).toHaveValue('Testbrot');
  await expect(page.locator('.calculation-result')).toContainText(/40(?:[,.]0)?\s*g KH/);
  forbidden.assertNone();
});

test('lokale Einstellungen und manuelle Berechnung bleiben offline nutzbar', async ({
  page,
  context,
}) => {
  const forbidden = collectForbiddenProductRequests(page);
  await openAppShell(page);

  await context.setOffline(true);
  try {
    await page.getByRole('button', { name: 'Einstellungen', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Einstellungen' })).toBeVisible();
    await page.getByRole('button', { name: 'Rechner', exact: true }).click();
    await page.getByRole('button', { name: 'Manuell', exact: true }).click();
    await page.getByLabel('KH pro 100 g').fill('12.5');
    await page.getByLabel('Menge in g').fill('80');
    await expect(page.locator('.calculation-result')).toContainText(/10(?:[,.]0)?\s*g KH/);
  } finally {
    await context.setOffline(false);
  }
  forbidden.assertNone();
});
