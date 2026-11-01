// P4 gate: axe is clean on every Codex route, and screenshots are saved in
// qa/screenshots/P4/. Onboarding is completed first (Codex routes are
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

const CODEX_ROUTES = [
  '/codex/moves',
  '/codex/moves/Yoshimitsu-1%2B4',
  '/codex/stances',
  '/codex/stances/NSS',
  '/codex/combos',
  '/codex/combos/c-bnb-regular',
  '/codex/heat',
];

test('codex axe: every Codex route has no serious/critical violations', async ({ page }) => {
  // axe over the 319-row move list plus the 2.0 nav takes ~15 s a route on a
  // loaded runner; same budget as the other axe passes (design.spec.ts).
  test.setTimeout(180_000);
  await completeOnboarding(page);
  for (const route of CODEX_ROUTES) {
    await page.goto(route);
    await expect(page.locator('#main')).toBeVisible();
    const results = await new AxeBuilder({ page: page as never }).analyze();
    const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(serious, `${route}: ${JSON.stringify(serious, null, 2)}`).toEqual([]);
  }
});

test('codex screenshots: moves list', async ({ page }, testInfo) => {
  await completeOnboarding(page);
  await page.goto('/codex/moves');
  await page.waitForTimeout(300);
  // Viewport screenshot only: the 319-row list as a full page crashes the
  // phone renderer (target crash in the P4 gate run).
  await page.screenshot({ path: `qa/screenshots/P4/moves-${testInfo.project.name}.png` });
});

test('codex screenshots: move detail', async ({ page }, testInfo) => {
  await completeOnboarding(page);
  await page.goto('/codex/moves/Yoshimitsu-1%2B4');
  await page.waitForTimeout(300);
  await page.screenshot({ fullPage: true, path: `qa/screenshots/P4/detail-${testInfo.project.name}.png` });
});

test('codex screenshots: stance map and heat', async ({ page }, testInfo) => {
  await completeOnboarding(page);
  await page.goto('/codex/stances');
  await page.waitForTimeout(300);
  await page.screenshot({ fullPage: true, path: `qa/screenshots/P4/stances-${testInfo.project.name}.png` });
  await page.goto('/codex/heat');
  await page.waitForTimeout(300);
  await page.screenshot({ fullPage: true, path: `qa/screenshots/P4/heat-${testInfo.project.name}.png` });
});
