import { expect, test } from '@playwright/test';
import { openAppShell } from './catalog-harness';

test('Comic-Quick-Access zeigt Blutzucker und Gesamtbolus halbiert nebeneinander', async ({ page }) => {
  await openAppShell(page);
  await page.getByRole('button', { name: 'Einstellungen', exact: true }).click();
  await page.getByTestId('diabetes-profile-toggle').check();
  for (const input of await page.getByTestId('carbohydrate-ratio-input').all()) await input.fill('10');
  for (const input of await page.getByTestId('correction-factor-input').all()) await input.fill('50');
  for (const input of await page.getByTestId('target-glucose-input').all()) await input.fill('100');

  await page.getByRole('button', { name: 'Rechner', exact: true }).click();
  const panel = page.getByTestId('diabetes-bolus-panel');
  const details = page.getByTestId('diabetes-bolus-details');
  const quickAccess = page.getByTestId('diabetes-quick-access');
  const glucoseBubble = quickAccess.locator('.diabetes-glucose-input');
  const totalBubble = page.getByTestId('quick-total-bolus');

  await expect(panel).toHaveAttribute('data-collapsed', 'true');
  await expect(details).not.toHaveAttribute('open', '');
  await expect(glucoseBubble).toBeVisible();
  await expect(totalBubble).toBeVisible();

  const geometry = await quickAccess.evaluate((row) => {
    const left = row.querySelector('.diabetes-glucose-input')?.getBoundingClientRect();
    const right = row.querySelector('.diabetes-total-bolus')?.getBoundingClientRect();
    const container = row.getBoundingClientRect();
    return left && right ? {
      widthDelta: Math.abs(left.width - right.width),
      yDelta: Math.abs(left.y - right.y),
      rightStartsAfterLeft: right.x > left.x,
      combinedWidth: left.width + right.width,
      containerWidth: container.width
    } : null;
  });
  expect(geometry).not.toBeNull();
  expect(geometry?.widthDelta).toBeLessThanOrEqual(12);
  expect(geometry?.yDelta).toBeLessThanOrEqual(12);
  expect(geometry?.rightStartsAfterLeft).toBe(true);
  expect(geometry?.combinedWidth ?? Number.POSITIVE_INFINITY).toBeLessThan(geometry?.containerWidth ?? 0);

  await page.getByTestId('current-glucose-input').fill('200');
  await expect(details).not.toHaveAttribute('open', '');
  await expect(totalBubble).toContainText('2,0 E');
  await expect(totalBubble).toContainText('Gesamtbolus');

  await page.getByTestId('diabetes-bolus-toggle').click();
  await expect(details).toHaveAttribute('open', '');
  await expect(page.getByTestId('total-bolus')).toHaveText('2,0 E');
  await expect(totalBubble).toContainText('2,0 E');

  await page.getByRole('button', { name: 'Manuell', exact: true }).click();
  await page.getByLabel('KH pro 100 g').fill('40');
  await page.getByLabel('Menge in g').fill('100');
  await expect(page.getByTestId('diabetes-bolus-details')).not.toHaveAttribute('open', '');
  await expect(page.getByTestId('quick-total-bolus')).toContainText('6,0 E');
});
