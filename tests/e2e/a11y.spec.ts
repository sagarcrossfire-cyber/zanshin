// P1 gate: axe on /dev/gallery in both themes — no serious or critical violations (§13.7).
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

for (const theme of ['dark', 'light'] as const) {
  test(`gallery axe: ${theme} theme has no serious/critical violations`, async ({ page }) => {
    await page.goto('/dev/gallery');
    await page.getByRole('button', { name: theme, exact: true }).first().click();
    await expect(page.locator('.z-gallery')).toHaveAttribute('data-theme', theme);
    // AxeBuilder's bundled playwright-core Page type skews from @playwright/test's;
    // the runtime object is the same page. Cast is type-only.
    const results = await new AxeBuilder({ page: page as never }).analyze();
    const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(serious, JSON.stringify(serious, null, 2)).toEqual([]);
  });
}

// P3 gate: axe on the onboarding pages — no serious or critical violations.
test('onboarding axe: welcome step has no serious/critical violations', async ({ page }) => {
  await page.goto('/onboarding');
  await expect(page.getByText('Welcome to ZANSHIN')).toBeVisible();
  const results = await new AxeBuilder({ page: page as never }).analyze();
  const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(serious, JSON.stringify(serious, null, 2)).toEqual([]);
});

test('onboarding axe: profile step has no serious/critical violations', async ({ page }) => {
  await page.goto('/onboarding');
  await page.getByRole('button', { name: 'Get started' }).click();
  await expect(page.getByRole('heading', { name: 'Your profile' })).toBeVisible();
  const results = await new AxeBuilder({ page: page as never }).analyze();
  const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(serious, JSON.stringify(serious, null, 2)).toEqual([]);
});

// P7 gate: axe on the Match Log, Matchups, Playbook and import routes — no
// serious or critical violations (§13.7). Onboarding is completed first.
async function completeOnboardingForAxe(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Get started' }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: "Start today's plan" }).click();
  await expect(page).toHaveURL(/\/today$/);
}

const P7_ROUTES = ['/log', '/log/new', '/log/import', '/matchups', '/matchups/Kazuya', '/playbook'];

test('P7 axe: log/matchups/playbook have no serious/critical violations', async ({ page }) => {
  await completeOnboardingForAxe(page);
  for (const route of P7_ROUTES) {
    await page.goto(route);
    await expect(page.locator('#main')).toBeVisible();
    const results = await new AxeBuilder({ page: page as never }).analyze();
    const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(serious, `${route}: ${JSON.stringify(serious, null, 2)}`).toEqual([]);
  }
});
