// 2.0 M2 — Settings "Ranked sync": dashed Tekken ID saves and reloads, an
// invalid ID shows the inline error, and the device key shows masked after
// Save and clears with Clear.
import { expect, test, type Page } from '@playwright/test';

async function completeOnboarding(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Get started' }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: "Start today's plan" }).click();
  await expect(page).toHaveURL(/\/today$/);
}

test('a dashed Tekken ID saves and survives a reload', async ({ page }) => {
  await completeOnboarding(page);
  await page.goto('/settings');
  await page.getByLabel('Tekken ID (optional)').fill('ABCD-1234-EFGH');
  await expect(page.getByText(/That isn.t a Tekken ID/)).toHaveCount(0);
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByText('Settings saved.')).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Tekken ID (optional)')).toHaveValue('ABCD1234EFGH');
});

test('an invalid Tekken ID shows the inline error and blocks Save', async ({ page }) => {
  await completeOnboarding(page);
  await page.goto('/settings');
  await page.getByLabel('Tekken ID (optional)').fill('not-a-valid-id');
  await expect(page.getByText("That isn't a Tekken ID: 12 letters and numbers, dashes optional.")).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save settings' })).toBeDisabled();
  await page.getByLabel('Tekken ID (optional)').fill('');
  await expect(page.getByRole('button', { name: 'Save settings' })).toBeEnabled();
});

test('the device key shows masked after Save, and Clear removes it', async ({ page }) => {
  await completeOnboarding(page);
  await page.goto('/settings');
  await expect(page.getByLabel('Device key', { exact: true })).toBeVisible();
  await page.getByLabel('Device key', { exact: true }).fill('a'.repeat(32));
  await page.getByRole('button', { name: 'Save device key' }).click();
  await expect(page.getByText('Device key saved (ends …aaaa).')).toBeVisible();
  await expect(page.getByLabel('Device key', { exact: true })).toHaveCount(0);
  await page.reload();
  await expect(page.getByText('Device key saved (ends …aaaa).')).toBeVisible();
  await page.getByRole('button', { name: 'Clear device key' }).click();
  await expect(page.getByLabel('Device key', { exact: true })).toBeVisible();
});
