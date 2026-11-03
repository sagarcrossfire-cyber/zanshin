// 2.0 M6: Today's "Move of the day" stays out of the way without media. With
// clips imported it plays muted on a loop (covered by unit tests and checked by
// eye; e2e media seeding of video is too slow for every run).
import { expect, test } from '@playwright/test';

test('M6: Today shows no Move of the day card when no clips are imported', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Get started' }).click();
  for (let i = 0; i < 4; i += 1) await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: "Start today's plan" }).click();
  await expect(page.locator('.z-today')).toBeVisible();
  await expect(page.getByTestId('move-of-the-day')).toHaveCount(0);
});
