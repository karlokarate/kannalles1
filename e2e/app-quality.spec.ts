import AxeBuilder from '@axe-core/playwright';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import {
  collectForbiddenProductRequests,
  openAppShell,
} from './catalog-harness';

test('App-Shell, Hauptnavigation und Startansicht bleiben zugänglich', async ({ page }) => {
  const forbidden = collectForbiddenProductRequests(page);
  await openAppShell(page);
  await expect(page.locator('.app-shell')).toHaveAttribute('data-visual-theme', 'comic');

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
  await page.getByTestId('manual-product-photo').setInputFiles(fileURLToPath(new URL('../public-template/generic-foods/rice-cooked.png', import.meta.url)));
  await expect(page.getByRole('status')).toContainText('Foto verkleinert');
  await page.getByTestId('manual-product-save').click();
  await expect(page.getByRole('heading', { name: 'Eigene Produkte' })).toBeVisible();
  await expect(page.locator('.saved-manual-product')).toContainText('Testbrot');
  await expect(page.locator('.saved-manual-product img')).toBeVisible();
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
    await page.locator('input[name="visual-theme"][value="standard"]').check();
    await expect(page.locator('.app-shell')).toHaveAttribute('data-visual-theme', 'standard');
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

test('segmentiertes Diabetikerprofil berechnet Korrektur allein und zusammen mit KH', async ({ page }) => {
  await openAppShell(page);
  await page.getByRole('button', { name: 'Einstellungen', exact: true }).click();
  await page.getByTestId('diabetes-profile-toggle').check();
  for (const input of await page.getByTestId('carbohydrate-ratio-input').all()) await input.fill('10');
  for (const input of await page.getByTestId('correction-factor-input').all()) await input.fill('50');
  for (const input of await page.getByTestId('target-glucose-input').all()) await input.fill('100');

  const editableTarget = page.getByTestId('target-glucose-input').first();
  await editableTarget.selectText();
  await editableTarget.press('Backspace');
  await expect(editableTarget).toHaveValue('');
  await editableTarget.pressSequentially('120');
  await expect(editableTarget).toHaveValue('120');
  await editableTarget.selectText();
  await editableTarget.pressSequentially('100');

  await page.getByRole('button', { name: 'Rechner', exact: true }).click();
  const panel = page.getByTestId('diabetes-bolus-panel');
  await expect(panel).toBeVisible();
  await page.getByTestId('current-glucose-input').fill('200');
  await expect(page.getByTestId('correction-bolus')).toHaveText('+2,0 E');
  await expect(page.getByTestId('total-bolus')).toHaveText('2,0 E');

  await page.getByRole('button', { name: 'Manuell', exact: true }).click();
  await page.getByLabel('KH pro 100 g').fill('40');
  await page.getByLabel('Menge in g').fill('100');
  await expect(page.getByTestId('carbohydrate-bolus')).toHaveText('4,0 E');
  await expect(page.getByTestId('total-bolus')).toHaveText('6,0 E');
  await page.getByTestId('current-glucose-input').fill('50');
  await expect(page.getByTestId('correction-bolus')).toHaveText('-1,0 E');
  await expect(page.getByTestId('total-bolus')).toHaveText('3,0 E');
});
