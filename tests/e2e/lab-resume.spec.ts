// P5 gate: run a 3-block session, reload mid-block, and resume — twice in
// a row (spec §12 P5 gate). Each test gets a fresh browser context, so the
// two runs are independent end-to-end passes.
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

async function runThreeBlockSession(page: Page) {
  await completeOnboarding(page);
  await page.goto('/lab');
  // Add the first three drills from the unfiltered list (stable pack order).
  const addButtons = page.getByRole('button', { name: 'Add', exact: true });
  await addButtons.nth(0).click();
  await addButtons.nth(0).click();
  await addButtons.nth(0).click();
  await page.getByRole('button', { name: /Start custom session/ }).click();
  await expect(page).toHaveURL(/\/lab\/session\//);

  // Block 1: log a set, then reload mid-block and resume the same block.
  await expect(page.getByText(/Block 1 of 3/)).toBeVisible();
  await page.getByRole('button', { name: /Log 8 of/ }).click();
  await expect(page.getByText(/Logged 8 of/)).toBeVisible();
  await page.reload();
  await expect(page.getByText(/Block 1 of 3/)).toBeVisible();
  await expect(page.locator('[role="timer"]')).toHaveText(/\d+:\d{2}/);

  // Block 2: reload mid-block again, then advance.
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByText(/Block 2 of 3/)).toBeVisible();
  await page.reload();
  await expect(page.getByText(/Block 2 of 3/)).toBeVisible();

  // Block 3, then the debrief.
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByText(/Block 3 of 3/)).toBeVisible();
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByText('Session debrief')).toBeVisible();
  await expect(page.getByText('1 sets · 8/10 successes (80%)')).toBeVisible();
}

test('lab resume: 3-block session survives reload mid-block (run 1)', async ({ page }) => {
  await runThreeBlockSession(page);
});

test('lab resume: 3-block session survives reload mid-block (run 2)', async ({ page }) => {
  await runThreeBlockSession(page);
});
