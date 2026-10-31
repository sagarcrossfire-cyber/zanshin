// P1 gate: gallery screenshots per theme (§12 P1). Saved under qa/screenshots/P1/.
import { test } from '@playwright/test';

for (const theme of ['dark', 'light'] as const) {
  test(`gallery screenshot: ${theme}`, async ({ page }, testInfo) => {
    await page.goto('/dev/gallery');
    await page.getByRole('button', { name: theme, exact: true }).first().click();
    await page.waitForTimeout(300);
    await page.screenshot({ fullPage: true, path: `qa/screenshots/P1/gallery-${theme}-${testInfo.project.name}.png` });
  });
}
