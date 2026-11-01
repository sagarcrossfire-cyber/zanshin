// P0 e2e smoke: /today loads with no console errors (spec §12 P0 step 8).
import { expect, test } from '@playwright/test';

test('P0 smoke: /today loads with no console errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(String(err)));
  await page.goto('/today');
  await expect(page.getByText('Welcome to ZANSHIN')).toBeVisible();
  expect(errors).toEqual([]);
});
