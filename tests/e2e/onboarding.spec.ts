// P3 gate (e2e): onboarding flow in a real browser — first run routes to
// /onboarding, skipping the baseline yields a Stage 0 plan on /today, and a
// reload mid-onboarding resumes at the same step (AC-ONB-1–3).
import { expect, test } from '@playwright/test';

test('onboarding: skip baseline → Stage 0 plan on /today', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/onboarding$/);
  await page.getByRole('button', { name: 'Get started' }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { name: 'Your time' })).toBeVisible();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { name: 'Your history' })).toBeVisible();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { name: 'Calibration' })).toBeVisible();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { name: 'Your placement' })).toBeVisible();
  await expect(page.getByText('Stage 0 — Calibration')).toBeVisible();
  await page.getByRole('button', { name: "Start today's plan" }).click();
  await expect(page).toHaveURL(/\/today$/);
  await expect(page.getByText(/Your plan is ready: \d+ minutes/)).toBeVisible();
});

test('onboarding: reload mid-onboarding resumes at the same step', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Get started' }).click();
  await expect(page.getByRole('heading', { name: 'Your profile' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Your profile' })).toBeVisible();
  await expect(page.getByLabel('Display name')).toHaveValue('Sagar');
});
