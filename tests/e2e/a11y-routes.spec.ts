// P11 gate: §13.7/§4.12 — axe on every route in both themes, focus on
// route change, 200% zoom without horizontal scroll, 44 px buttons
// (64 px in Lab Mode), and reduced-motion handling for the enso.
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

const AXE_ROUTES = [
  '/today', '/path', '/lab', '/codex/moves', '/codex/stances', '/codex/combos',
  '/codex/heat', '/punish', '/matchups', '/playbook', '/log', '/log/new',
  '/progress', '/coach', '/cards', '/patch', '/settings', '/diagnostics', '/baseline',
];

for (const theme of ['dark', 'light'] as const) {
  test(`axe: every route has no serious/critical violations (${theme})`, async ({ page }) => {
    test.setTimeout(240_000);
    await page.emulateMedia({ colorScheme: theme });
    await completeOnboarding(page);
    for (const route of AXE_ROUTES) {
      await page.goto(route);
      await expect(page.locator('#main')).toBeVisible();
      const results = await new AxeBuilder({ page: page as never }).analyze();
      const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
      expect(serious, `${route} (${theme}): ${JSON.stringify(serious, null, 2)}`).toEqual([]);
    }
  });
}

test('focus moves to the screen title on route change (§4.12)', async ({ page }) => {
  await completeOnboarding(page);
  await expect(page.locator('#main')).toBeVisible();
  // 2.0: the Codex lives under the Study hub (dock on phones, rail on desktops).
  await page.locator('a:visible', { hasText: /^Study$/ }).first().click();
  await expect(page).toHaveURL(/\/codex\/moves$/);
  // Focus lands on the title after navigation + render; poll for the
  // settled state instead of racing the route-change effect.
  await expect.poll(async () => page.evaluate(() => {
    const el = document.activeElement;
    return el ? `${el.tagName}.${el.className}` : 'none';
  })).toBe('H1.z-topbar__title');
});

test('200% zoom: no horizontal scroll on key routes (§13.7)', async ({ page }) => {
  await completeOnboarding(page);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 2 });
  for (const route of ['/today', '/codex/moves', '/path', '/settings', '/log/new']) {
    await page.goto(route);
    await expect(page.locator('#main')).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, `${route} overflows by ${overflow}px at 200% zoom`).toBeLessThanOrEqual(1);
  }
  await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 1 });
});

test('buttons measure at least 44 px, 64 px in Lab Mode (§13.7)', async ({ page }) => {
  await completeOnboarding(page);
  await page.goto('/today');
  await expect(page.locator('#main')).toBeVisible();
  const small = await page.evaluate(() => {
    const bad: string[] = [];
    for (const el of document.querySelectorAll('button')) {
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      if (rect.width === 0 || style.visibility === 'hidden' || style.display === 'none') continue;
      if (rect.height < 44) bad.push(`${el.textContent?.trim() ?? el.getAttribute('aria-label')}: ${rect.height}`);
    }
    return bad;
  });
  expect(small, `buttons under 44px: ${small.join('; ')}`).toEqual([]);

  // Lab Mode: enter it via the runner's toggle (Lab Mode is user-toggled,
  // not auto-on), then its buttons are 64 px+. Wait for the runner content
  // first so the measurement cannot pass vacuously on a loading state.
  await page.goto('/lab');
  await page.getByRole('button', { name: 'Start today’s session' }).click();
  await expect(page).toHaveURL(/\/lab\/session\//);
  await expect(page.locator('.z-runner')).toBeVisible();
  await page.getByRole('button', { name: 'Lab Mode', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.z-lab') !== null);
  const smallLab = await page.evaluate(() => {
    const bad: string[] = [];
    for (const el of document.querySelectorAll('.z-runner button')) {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0) continue;
      if (rect.height < 64) bad.push(`${el.textContent?.trim()}: ${rect.height}`);
    }
    return bad;
  });
  expect(smallLab, `Lab Mode buttons under 64px: ${smallLab.join('; ')}`).toEqual([]);
});

test('reduced motion: the enso transition takes 0 ms (§13.7)', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await completeOnboarding(page);
  await page.goto('/path');
  await expect(page.locator('.z-enso__arc').first()).toBeVisible();
  const duration = await page.evaluate(() => {
    const el = document.querySelector('.z-enso__arc');
    if (!el) return -1;
    return Number.parseFloat(getComputedStyle(el).transitionDuration);
  });
  // The global reduced-motion rule clamps transitions to 0.01 ms (§4.12);
  // "0 ms" in §13.7 means effectively instant, not a literal zero.
  expect(duration).toBeLessThanOrEqual(0.001);
});
