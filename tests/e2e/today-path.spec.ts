// P6 gate: axe is clean on Today, Path and node detail — no serious or
// critical violations (§13.7). Onboarding is completed first (routes are
// guarded); each test gets a fresh browser context.
import AxeBuilder from '@axe-core/playwright';
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

const P6_ROUTES = ['/today', '/path', '/path/n0-controls'];

test('today/path axe: no serious/critical violations', async ({ page }) => {
  await completeOnboarding(page);
  for (const route of P6_ROUTES) {
    await page.goto(route);
    await expect(page.locator('#main')).toBeVisible();
    const results = await new AxeBuilder({ page: page as never }).analyze();
    const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(serious, `${route}: ${JSON.stringify(serious, null, 2)}`).toEqual([]);
  }
});
