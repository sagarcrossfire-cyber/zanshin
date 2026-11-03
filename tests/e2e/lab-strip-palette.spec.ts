// M1 fix: B1 (hold-exit must not let the finger-lift click open the
// palette), B2 (the full-screen palette needs a way to close without a
// keyboard), m2 (Escape arms/exits Lab Mode) and m3 (focus the title after
// a keyboard exit).
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

async function enterLabMode(page: Page) {
  await page.goto('/lab');
  await page.getByRole('button', { name: 'Start today’s session' }).click();
  await expect(page).toHaveURL(/\/lab\/session\//);
  await expect(page.locator('.z-runner')).toBeVisible();
  await page.getByRole('button', { name: 'Lab Mode', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.z-lab') !== null);
}

test('B1: touch-hold Exit for 700ms and lift leaves Lab Mode off without opening the palette', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'phone', 'touch-only scenario');
  await completeOnboarding(page);
  await enterLabMode(page);

  const exitButton = page.locator('.z-labstrip__exit');
  const box = await exitButton.boundingBox();
  if (!box) throw new Error('Exit button has no box');
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;

  // Real touch, via CDP, so Chromium synthesizes the finger-lift click the
  // same way a phone does — at the point under the finger, not on a
  // retained element reference (that is the actual B1 mechanism).
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  await page.waitForTimeout(700);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });

  await expect(page.locator('.z-lab')).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: 'Search or jump to' })).toHaveCount(0);
});

test('B2: phone palette has a visible Cancel that closes it', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'phone', 'phone-only scenario');
  await completeOnboarding(page);
  await page.goto('/today');
  await page.getByRole('button', { name: 'Search or jump to' }).click();
  const dialog = page.getByRole('dialog', { name: 'Search or jump to' });
  await expect(dialog).toBeVisible();

  const cancel = dialog.getByRole('button', { name: 'Cancel' });
  await expect(cancel).toBeVisible();
  // Let the palette's 200ms scale-in entrance animation finish; measuring
  // mid-transition reports a transiently smaller box (RCA: §7 catalog).
  await page.waitForTimeout(300);
  const box = await cancel.boundingBox();
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);

  await cancel.click();
  await expect(dialog).toHaveCount(0);
});

test('m2/m3: Escape twice exits Lab Mode and focus lands on the title', async ({ page }) => {
  await completeOnboarding(page);
  await enterLabMode(page);
  // The session has its own focusable fields (Notes); Escape only arms the
  // exit when no text field has focus, so make sure none does first.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());

  await page.keyboard.press('Escape');
  await expect(page.getByText('Press again to exit')).toBeVisible();
  await expect(page.locator('.z-lab')).toHaveCount(1);

  await page.keyboard.press('Escape');
  await expect(page.locator('.z-lab')).toHaveCount(0);

  await expect.poll(async () => page.evaluate(() => {
    const el = document.activeElement;
    return el ? `${el.tagName}.${el.className}` : 'none';
  })).toBe('H1.z-topbar__title');
});
