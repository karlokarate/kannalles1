import AxeBuilder from '@axe-core/playwright';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
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

test('iPhone-Sprachbutton öffnet bei fehlender Web-Speech-API den nativen Diktierweg', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'userAgent', { configurable: true, value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1' });
    Object.defineProperty(window, 'SpeechRecognition', { configurable: true, value: undefined });
    Object.defineProperty(window, 'webkitSpeechRecognition', { configurable: true, value: undefined });
  });
  await openAppShell(page);
  await page.getByTestId('catalog-speech-search').click();
  await expect(page.getByTestId('catalog-search-input')).toBeFocused();
  await expect(page.locator('.speech-message')).toContainText('Siri und Diktierfunktion');
  await expect(page.locator('.speech-message')).toContainText('Mikrofon der geöffneten Tastatur');
});

test('iPhone-Sprachbutton erklärt eine blockierte Safari-Mikrofonfreigabe', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'userAgent', { configurable: true, value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1' });
    class DeniedWebkitSpeechRecognition {
      lang = '';
      interimResults = false;
      continuous = false;
      onstart: (() => void) | null = null;
      onresult: ((event: unknown) => void) | null = null;
      onerror: ((event: { error: string }) => void) | null = null;
      onend: (() => void) | null = null;
      start() { setTimeout(() => this.onerror?.({ error: 'not-allowed' }), 0); }
      stop() { this.onend?.(); }
    }
    Object.defineProperty(window, 'SpeechRecognition', { configurable: true, value: undefined });
    Object.defineProperty(window, 'webkitSpeechRecognition', { configurable: true, value: DeniedWebkitSpeechRecognition });
  });
  await openAppShell(page);
  await page.getByTestId('catalog-speech-search').click();
  await expect(page.getByTestId('catalog-search-input')).toBeFocused();
  await expect(page.locator('.speech-message')).toContainText('Website-Einstellungen');
  await expect(page.locator('.speech-message')).toContainText('Mikrofon');
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
    const legalNotice = page.getByTestId('legal-notice');
    await expect(legalNotice.getByRole('heading', { name: 'Impressum & Lizenzen' })).toBeVisible();
    await expect(legalNotice).toContainText('C. Fischer');
    await expect(legalNotice).toContainText('Leverkusen, Deutschland');
    await expect(legalNotice.getByRole('link', { name: 'fishit.apps@gmail.com' })).toHaveAttribute('href', 'mailto:fishit.apps@gmail.com');
    await expect(legalNotice).toContainText('private, nicht kommerzielle Nutzung');
    await expect(legalNotice).toContainText('keine Dosierfreigabe');
    await expect(legalNotice).toContainText('zwingender gesetzlicher Haftung');
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
  await page.getByTestId('insulin-duration-select').selectOption('5');
  await page.getByTestId('manual-bolus-tracking-toggle').check();
  const ratioGroup = page.getByTestId('diabetes-factor-carbohydrateRatioG');
  const correctionGroup = page.getByTestId('diabetes-factor-correctionFactorMgDl');
  const targetGroup = page.getByTestId('diabetes-factor-targetGlucoseMgDl');
  await expect(ratioGroup).toHaveAttribute('open', '');
  await expect(correctionGroup).not.toHaveAttribute('open', '');
  await correctionGroup.locator('summary').click();
  await targetGroup.locator('summary').click();
  await ratioGroup.getByRole('button', { name: 'Zeitsegment hinzufügen' }).click();
  await expect(ratioGroup.getByTestId('diabetes-segment')).toHaveCount(8);
  await expect(correctionGroup.getByTestId('diabetes-segment')).toHaveCount(7);
  await expect(targetGroup.getByTestId('diabetes-segment')).toHaveCount(7);
  await ratioGroup.getByLabel('KH-Verhältnis, Segment 2: von').fill('03:30');
  await expect(correctionGroup.getByLabel('Korrekturfaktor, Segment 2: von')).toHaveValue('06:00');
  for (const input of await page.getByTestId('carbohydrate-ratio-input').all()) await input.fill('10');
  for (const input of await page.getByTestId('correction-factor-input').all()) await input.fill('50');
  for (const input of await page.getByTestId('target-glucose-input').all()) await input.fill('100');

  const firstRatio = page.getByTestId('carbohydrate-ratio-input').first();
  const secondRatio = page.getByTestId('carbohydrate-ratio-input').nth(1);
  await expect(firstRatio).toHaveAttribute('inputmode', 'decimal');
  await expect(firstRatio).toHaveAttribute('enterkeyhint', 'next');
  await firstRatio.fill('10,5');
  await expect(firstRatio).toHaveValue('10,5');
  await firstRatio.press('Enter');
  await expect(secondRatio).toBeFocused();
  await expect.poll(() => secondRatio.evaluate((input) => ({ start: (input as HTMLInputElement).selectionStart, end: (input as HTMLInputElement).selectionEnd, length: (input as HTMLInputElement).value.length }))).toEqual({ start: 0, end: 2, length: 2 });
  await firstRatio.fill('10');
  await targetGroup.getByRole('button', { name: 'Weiter →' }).first().click();
  await expect(page.getByTestId('target-glucose-input').nth(1)).toBeFocused();

  const editableTarget = page.getByTestId('target-glucose-input').first();
  await editableTarget.selectText();
  await editableTarget.press('Backspace');
  await expect(editableTarget).toHaveValue('');
  await editableTarget.pressSequentially('120');
  await expect(editableTarget).toHaveValue('120');
  await editableTarget.selectText();
  await editableTarget.pressSequentially('100');
  await page.getByTestId('target-glucose-input').last().press('Enter');
  await expect(targetGroup).not.toHaveAttribute('open', '');

  await page.reload();
  await expect(page.locator('.app-shell')).toBeVisible();
  await page.getByRole('button', { name: 'Einstellungen', exact: true }).click();
  await expect(page.getByTestId('diabetes-factor-carbohydrateRatioG')).not.toHaveAttribute('open', '');
  await expect(page.getByTestId('diabetes-factor-correctionFactorMgDl')).not.toHaveAttribute('open', '');
  await expect(page.getByTestId('diabetes-factor-targetGlucoseMgDl')).not.toHaveAttribute('open', '');

  await page.getByRole('button', { name: 'Rechner', exact: true }).click();
  const panel = page.getByTestId('diabetes-bolus-panel');
  await expect(panel).toBeVisible();
  await page.getByTestId('current-glucose-input').fill('200');
  await expect(page.getByTestId('correction-bolus')).toHaveText('+2,0 E');
  await expect(page.getByTestId('total-bolus')).toHaveText('2,0 E');
  const currentTime = await page.evaluate(() => `${String(new Date().getHours()).padStart(2, '0')}:${String(new Date().getMinutes()).padStart(2, '0')}`);
  await page.getByTestId('last-bolus-time').fill(currentTime);
  await page.getByTestId('last-bolus-units').fill('1,0');
  await expect(page.getByTestId('active-insulin')).toHaveText('−1,0 E');
  await expect(page.getByTestId('active-insulin-summary')).toContainText(/noch 1,0+ E aktiv/);
  await expect(page.getByTestId('total-bolus')).toHaveText('1,0 E');

  await page.getByRole('button', { name: 'Manuell', exact: true }).click();
  await page.getByLabel('KH pro 100 g').fill('40');
  await page.getByLabel('Menge in g').fill('100');
  await expect(page.getByTestId('carbohydrate-bolus')).toHaveText('4,0 E');
  await expect(page.getByTestId('total-bolus')).toHaveText('5,0 E');
  await page.getByTestId('current-glucose-input').fill('50');
  await expect(page.getByTestId('correction-bolus')).toHaveText('-1,0 E');
  await expect(page.getByTestId('total-bolus')).toHaveText('2,0 E');
});

test('exportiert, teilt und importiert Verlauf, Diabeteseinstellungen und Portions-Overrides als eine Datei', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => true });
    Object.defineProperty(navigator, 'share', { configurable: true, value: async (data: ShareData) => { (window as typeof window & { sharedFileName?: string }).sharedFileName = data.files?.[0]?.name; } });
  });
  await openAppShell(page);
  await page.getByRole('button', { name: 'Einstellungen', exact: true }).click();
  await page.getByTestId('diabetes-profile-toggle').check();
  await page.getByTestId('carbohydrate-ratio-input').first().fill('12');
  await page.getByTestId('insulin-duration-select').selectOption('4.5');
  await page.getByTestId('manual-bolus-tracking-toggle').check();

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Datei exportieren' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^fishit-kh-daten-\d{4}-\d{2}-\d{2}\.json$/);
  const downloadPath = await download.path();
  if (!downloadPath) throw new Error('export download did not produce a readable file');
  const contents = readFileSync(downloadPath, 'utf8');
  const transferred = JSON.parse(contents);
  expect(transferred).toMatchObject({ format: 'fishit-kh-checker-transfer', schemaVersion: 1, diabetes: { enabled: true, insulinActivityDurationHours: 4.5, manualBolusTrackingEnabled: true }, history: { calculations: [], meals: [], calibrations: [] } });

  await page.getByRole('button', { name: 'Nativ teilen', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as typeof window & { sharedFileName?: string }).sharedFileName ?? '')).toMatch(/^fishit-kh-daten-.*\.txt$/);

  await page.getByTestId('carbohydrate-ratio-input').first().fill('20');
  await page.getByTestId('insulin-duration-select').selectOption('6');
  await page.getByTestId('manual-bolus-tracking-toggle').uncheck();
  await page.getByTestId('transfer-file-input').setInputFiles({ name: 'fishit-kh-daten.json', mimeType: 'application/json', buffer: Buffer.from(contents) });
  await expect(page.locator('.transfer-settings').getByRole('status')).toContainText('Diabeteseinstellungen wurden importiert');
  await expect(page.getByTestId('carbohydrate-ratio-input').first()).toHaveValue('12');
  await expect(page.getByTestId('insulin-duration-select')).toHaveValue('4.5');
  await expect(page.getByTestId('manual-bolus-tracking-toggle')).toBeChecked();
});
