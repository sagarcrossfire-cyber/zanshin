// M1 fix verification (QA M1, M3, m4, m5, n4): collapsed-rail link names,
// Coach ?about= prefill (and its URL cleanup), unknown Coach sections,
// Settings data/app-health links, and the skip-to-content link.
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

test('QA M1: the collapsed desktop rail still names Train accessibly', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'desktop-only rail scenario');
  await completeOnboarding(page);
  await page.keyboard.press('[');
  await expect(page.locator('.z-rail--collapsed')).toBeVisible();
  await expect(page.getByRole('link', { name: /^Train/ })).toBeVisible();
});

test('QA m5: /coach/bogus redirects to /coach/ask', async ({ page }) => {
  await completeOnboarding(page);
  await page.goto('/coach/bogus');
  await expect(page).toHaveURL(/\/coach\/ask$/);
});

test('QA M3: ?about= prefills the Copy-context question and is dropped from the URL', async ({ page }) => {
  await completeOnboarding(page);
  await page.goto('/coach/ask?about=1%2B4');
  await expect(page.getByLabel('Your question')).toHaveValue(/1\+4/);
  await expect(page).not.toHaveURL(/about=/);
});

test('QA m4: Settings links to Diagnostics and Retake the baseline', async ({ page }) => {
  await completeOnboarding(page);
  await page.goto('/settings');
  await page.getByRole('link', { name: 'Diagnostics' }).click();
  await expect(page).toHaveURL(/\/diagnostics$/);
  await page.goto('/settings');
  await page.getByRole('link', { name: 'Retake the baseline' }).click();
  await expect(page).toHaveURL(/\/baseline$/);
});

test('QA n4: the first Tab on /today focuses Skip to content', async ({ page }) => {
  await completeOnboarding(page);
  await page.goto('/today');
  await expect(page.locator('#main')).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
});
