// 2.0 M6 motion: cards rise in one after another (transform only) and the
// whole effect is off under prefers-reduced-motion (design.md C.8). Runs on
// phone, tablet and desktop (*regressions.spec.ts).
import { expect, test, type Page } from '@playwright/test';

async function completeOnboarding(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Get started' }).click();
  for (let i = 0; i < 4; i += 1) await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: "Start today's plan" }).click();
  await expect(page).toHaveURL(/\/today$/);
  await expect(page.locator('.z-today')).toBeVisible();
}

function animationOf(page: Page, selector: string) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const style = getComputedStyle(el);
    return { name: style.animationName, delay: style.animationDelay };
  }, selector);
}

test('M6 motion: roster and Today cards rise in, staggered', async ({ page }) => {
  await completeOnboarding(page);
  expect(await animationOf(page, '.z-today > :nth-child(1)')).toEqual({ name: 'z-rise', delay: '0s' });
  expect((await animationOf(page, '.z-today > :nth-child(2)'))?.delay).toBe('0.04s');
  await page.goto('/matchups');
  await expect(page.locator('.z-select-grid > li').first()).toBeVisible();
  expect((await animationOf(page, '.z-select-grid > li:nth-child(3)'))).toEqual({ name: 'z-rise', delay: '0.08s' });
  // Capped: item 20 waits no longer than item 12.
  expect((await animationOf(page, '.z-select-grid > li:nth-child(20)'))?.delay).toBe('0.44s');
});

test('M6 motion: reduced motion turns the entrance off entirely (no delayed offset either)', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await completeOnboarding(page);
  expect((await animationOf(page, '.z-today > :nth-child(2)'))?.name).toBe('none');
  await page.goto('/matchups');
  await expect(page.locator('.z-select-grid > li').first()).toBeVisible();
  expect((await animationOf(page, '.z-select-grid > li:nth-child(5)'))?.name).toBe('none');
  const transform = await page.evaluate(() => getComputedStyle(document.querySelector('.z-select-grid > li:nth-child(5)')!).transform);
  expect(transform).toBe('none');
});
