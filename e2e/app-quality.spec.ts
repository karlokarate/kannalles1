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
  for (const label of ['Suche', 'Verlauf', 'Favoriten', 'Einstellungen']) {
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

  await page.getByRole('tab', { name: 'Manuell' }).click();
  const manualForm = page.locator('form.manual-form');
  await manualForm.getByLabel('Produkt', { exact: true }).fill('Testbrot');
  await manualForm.getByLabel('Menge', { exact: true }).fill('100');
  await manualForm.getByLabel('Einheit', { exact: true }).selectOption('g');
  await page.getByText('Optionale genaue Angaben').click();
  await page.getByLabel('Kohlenhydrate pro 100 Gramm').fill('40');
  await page.getByRole('button', { name: 'Berechnen', exact: true }).click();

  await expect(page.getByRole('heading', { name: 'Ergebnis' })).toBeVisible();
  await expect(page.getByText('Testbrot', { exact: true })).toBeVisible();
  await expect(page.locator('.big-result')).toContainText(/^40\s*g$/);
  await expect(page.getByRole('note')).toContainText(
    'Datenquelle: eigene Eingabe beziehungsweise Etikettwert',
  );
  forbidden.assertNone();
});

test('lokale generische BLS-Referenz bleibt offline und quellenrichtig nutzbar', async ({
  page,
  context,
}) => {
  const forbidden = collectForbiddenProductRequests(page);
  await openAppShell(page);

  await context.setOffline(true);
  try {
    await page
      .getByLabel('Produkt oder Lebensmittel suchen')
      .fill('100 g Nudeln gekocht');
    await page.getByRole('button', { name: 'Suchen', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Ergebnis' })).toBeVisible();
    await expect(page.getByRole('note')).toContainText(
      'Generische Referenz: Bundeslebensmittelschlüssel BLS 4.0',
    );
    await expect(page.getByRole('note')).toContainText('Max Rubner-Institut 2025');
  } finally {
    await context.setOffline(false);
  }
  forbidden.assertNone();
});
