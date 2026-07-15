import { expect, test } from '@playwright/test';
import { openAppShell } from './catalog-harness';

test('manuelles Produkt unterstützt direkte Stück-KH und dieselbe Feinmessung wie Katalogprodukte', async ({ page }) => {
  await openAppShell(page);
  await page.getByRole('button', { name: 'Manuell', exact: true }).click();

  await page.getByRole('button', { name: 'Direkt je Einheit', exact: true }).click();
  await page.getByTestId('manual-product-label').fill('Hausgemachter Müsliriegel');
  await page.getByTestId('manual-serving-unit').selectOption('bar');
  await page.getByTestId('manual-carbs-per-unit').fill('12');
  await page.getByTestId('manual-unit-weight').fill('30');
  await page.getByTestId('manual-unit-count').fill('2');

  await expect(page.getByTestId('manual-derived-per100')).toContainText(/40(?:[,.]0)? g KH \/ 100 g/);
  await expect(page.getByTestId('manual-calculation')).toContainText(/24(?:[,.]0)? g KH/);
  await page.getByTestId('manual-product-save').click();
  await expect(page.getByRole('status')).toContainText('12 g KH je Riegel mit 30 g gespeichert');

  const saved = page.locator('.saved-manual-product').filter({ hasText: 'Hausgemachter Müsliriegel' });
  await expect(saved).toContainText(/Riegel 30 g/);
  await saved.getByRole('button', { name: 'Im Rechner öffnen' }).click();

  const product = page.getByTestId('catalog-product');
  await expect(product).toBeVisible();
  await expect(product).toContainText('Hausgemachter Müsliriegel');
  await expect(page.getByTestId('catalog-unit-select').locator('option:checked')).toHaveAttribute('data-unit-kind', 'bar');
  await expect(page.getByTestId('catalog-unit-select').locator('option:checked')).toHaveAttribute('data-unit-weight-g', '30');
  await expect(page.getByTestId('catalog-calculation')).toHaveAttribute('data-total-carbs-g', '12');
  await expect(page.getByTestId('catalog-calculation')).toHaveAttribute('data-total-mass-g', '30');

  const calibration = page.getByTestId('catalog-calibration');
  await expect(calibration).toBeVisible();
  await calibration.locator('summary').click();
  await page.getByTestId('catalog-calibration-count').fill('2');
  await page.getByTestId('catalog-calibration-weight').fill('70');

  const preview = page.getByTestId('catalog-calibration-preview');
  await expect(preview).toHaveAttribute('data-derived-unit-weight-g', '35');
  await expect(preview).toHaveAttribute('data-derived-carbs-per-unit-g', '14');
  await expect(page.getByRole('status')).toContainText('35 g je Riegel gespeichert');
  await expect(page.getByTestId('catalog-calculation')).toHaveAttribute('data-total-carbs-g', '14');
});
