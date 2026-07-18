import { expect, test } from '@playwright/test';
import {
  BUENO_GTIN,
  expectCatalogReady,
  openCatalogApp,
  readRequiredNumber,
  searchCatalog
} from './catalog-harness';

test.describe.configure({ mode: 'serial' });

async function setClinicMode(page: Parameters<typeof openCatalogApp>[0], mode: 'clinic-only' | 'hybrid' | 'off') {
  await page.getByRole('button', { name: 'Einstellungen', exact: true }).click();
  await page.getByTestId('clinic-mode-select').selectOption(mode);
  await page.getByRole('button', { name: 'Rechner', exact: true }).click();
}

test('normalisiert Kilogramm im echten SQLite-Katalog vor Auswahl und Berechnung', async ({ page }) => {
  await openCatalogApp(page);
  await expectCatalogReady(page);
  await setClinicMode(page, 'off');
  await searchCatalog(page, '0,5 kg Nutella');

  const product = page.getByTestId('catalog-product');
  await expect(product).toBeVisible();
  await expect(product).toHaveAttribute('data-amount', '500');
  const selected = page.getByTestId('catalog-unit-select').locator('option:checked');
  await expect(selected).toHaveAttribute('data-unit-kind', 'g');
  await expect(selected).toHaveAttribute('data-unit-weight-g', '1');

  const carbsPer100 = await readRequiredNumber(product, 'data-carbs-per-100-g');
  const calculation = page.getByTestId('catalog-calculation');
  const total = await readRequiredNumber(calculation, 'data-total-carbs-g');
  expect(total).toBe(500 * carbsPer100 / 100);
});

test('bewahrt bei direkten Klinikwerten eine explizite Grammanfrage und rechnet sie niemals als Stückzahl', async ({ page }) => {
  await openCatalogApp(page);
  await expectCatalogReady(page);
  await setClinicMode(page, 'clinic-only');
  await searchCatalog(page, '100 g Pfannkuchen mit Quark');

  const product = page.getByTestId('catalog-product');
  await expect(product).toContainText('Pfannkuchen mit Quark');
  await expect(product).toHaveAttribute('data-unit-resolution-status', 'not_calculable');
  const unitSelect = page.getByTestId('catalog-unit-select');
  await expect(unitSelect.locator('option:checked')).toHaveAttribute('data-unit-kind', 'g');
  await expect(page.getByTestId('catalog-calculation')).toHaveAttribute('data-status', 'not_calculable');
  await expect(page.getByTestId('catalog-calculation')).not.toHaveAttribute('data-total-carbs-g', /\S+/);

  const pieceOption = unitSelect.locator('option[data-unit-kind="piece"]');
  const pieceValue = await pieceOption.getAttribute('value');
  expect(pieceValue).not.toBeNull();
  await unitSelect.selectOption(pieceValue ?? '');
  await page.getByTestId('catalog-amount-input').fill('2');
  await expect(page.getByTestId('catalog-calculation')).toHaveAttribute('data-status', 'calculated');
  await expect(page.getByTestId('catalog-calculation')).toHaveAttribute('data-total-carbs-g', '38');
});

test('persistiert eine konkrete Nutzerkalibrierung über Reload und erneute SQLite-Suche', async ({ page }) => {
  await openCatalogApp(page);
  await expectCatalogReady(page);
  await setClinicMode(page, 'off');
  await searchCatalog(page, BUENO_GTIN);

  const calibration = page.getByTestId('catalog-calibration');
  if (!await calibration.getAttribute('open')) await calibration.locator('summary').click();
  await page.getByTestId('catalog-calibration-unit').selectOption('bar');
  await page.getByTestId('catalog-calibration-count').fill('10');
  await page.getByTestId('catalog-calibration-weight').fill('200');
  await expect(calibration).toContainText('20 g je Riegel gespeichert.');

  await page.reload({ waitUntil: 'domcontentloaded' });
  await expectCatalogReady(page);
  await searchCatalog(page, BUENO_GTIN);
  const selected = page.getByTestId('catalog-unit-select').locator('option:checked');
  await expect(selected).toHaveAttribute('data-unit-kind', 'bar');
  await expect(selected).toHaveAttribute('data-unit-provenance', 'user-calibration');
  await expect(selected).toHaveAttribute('data-unit-weight-g', '20');
});

test('persistiert den smarten generischen Portionswert über Reload ohne Produktübergriff', async ({ page }) => {
  await openCatalogApp(page);
  await expectCatalogReady(page);
  await setClinicMode(page, 'off');
  await searchCatalog(page, 'eine Portion Nudeln');

  const prompt = page.getByTestId('catalog-smart-unit-prompt');
  await expect(prompt).toHaveAttribute('data-default-value', '200');
  await prompt.getByRole('spinbutton', { name: /Gramm je Portion/ }).fill('225');
  await prompt.getByRole('button', { name: 'Größe übernehmen' }).click();
  await expect(prompt).toBeHidden();

  await page.reload({ waitUntil: 'domcontentloaded' });
  await expectCatalogReady(page);
  await searchCatalog(page, 'eine Portion Nudeln');
  await expect(page.getByTestId('catalog-smart-unit-prompt')).toBeHidden();
  await expect(page.getByTestId('catalog-unit-select').locator('option:checked')).toHaveAttribute('data-unit-kind', 'portion');
  await expect(page.getByTestId('catalog-calculation')).toHaveAttribute('data-total-mass-g', '225');

  await searchCatalog(page, 'eine Portion Reis');
  await expect(page.getByTestId('catalog-smart-unit-prompt')).toHaveAttribute('data-default-value', '200');
  await expect(page.getByTestId('catalog-smart-unit-prompt').getByRole('spinbutton')).toHaveValue('200');
});
