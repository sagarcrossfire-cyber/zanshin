// P10 gate: Progress (§5.13, AC-PROG-1), Patch Watch offline (AC-PATCH-1),
// Settings export/import round-trip + RESET gate + instant theme/glyph
// (AC-SET-1/2/3), Diagnostics self-test (AC-DIAG-1), axe on all four
// routes. Onboarding is completed first; each test gets a fresh context.
import AxeBuilder from '@axe-core/playwright';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
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

/** Canonical JSON (spec §6.6): recursive key sort, no whitespace. */
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).filter((key) => record[key] !== undefined).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
}

test('AC-PROG-1: Progress renders with an empty DB — every chart hidden with its reason, no crash', async ({ page }) => {
  await completeOnboarding(page);
  await page.goto('/progress');
  await expect(page.locator('#main')).toBeVisible();
  await expect(page.getByText('No practice days yet')).toBeVisible();
  await expect(page.getByText(/10 quiz questions/)).toBeVisible();
  await expect(page.getByText(/10 games logged/)).toBeVisible();
  await expect(page.getByText(/10 games against one character/)).toBeVisible();
  await expect(page.getByText('No finished sessions yet')).toBeVisible();
  await expect(page.getByText('Rank history is not recorded yet')).toBeVisible();
  await expect(page.getByText('Practiced on 0 of the last 56 days.')).toBeVisible();
});

test('AC-PATCH-1: Patch Watch offline shows the last known state and a retry, never an error page', async ({ page }) => {
  await completeOnboarding(page);
  await page.route('**/w/api.php**', (route) => void route.abort());
  await page.goto('/patch');
  await expect(page.locator('#main')).toBeVisible();
  await expect(page.getByText('Current data')).toBeVisible();
  await page.getByRole('button', { name: 'Check for updates' }).click();
  await expect(page.getByText('Offline. Showing the last known state below')).toBeVisible();
  await expect(page).toHaveURL(/\/patch$/);
  await expect(page.locator('#main')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Check for updates' })).toBeEnabled();
});

test('AC-SET-1: export then import yields identical data (hash recomputed in Node)', async ({ page }) => {
  await completeOnboarding(page);
  await page.goto('/settings');
  await page.getByLabel('Display name').fill('RoundTrip');
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByText('Settings saved.')).toBeVisible();

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export backup' }).click();
  const download = await downloadPromise;
  const path = await download.path();
  expect(path).not.toBeNull();
  const file = JSON.parse(await readFile(path as string, 'utf8')) as {
    format: string; schemaVersion: number; tables: Record<string, unknown[]>; sha256: string;
  };
  expect(file.format).toBe('zanshin-backup');
  expect(file.schemaVersion).toBe(1);
  const recomputed = createHash('sha256').update(canonicalJson(file.tables)).digest('hex');
  expect(recomputed).toBe(file.sha256);
  expect((file.tables['profile'] as { displayName: string }[])[0]?.displayName).toBe('RoundTrip');

  // Change the name, then import: the imported data wins after reload.
  await page.getByLabel('Display name').fill('Changed');
  await page.getByRole('button', { name: 'Save settings' }).click();
  // The first save's toast may still be showing (5s auto-dismiss); either toast proves the save landed.
  await expect(page.getByText('Settings saved.').first()).toBeVisible();
  await page.setInputFiles('input[type="file"]', path as string);
  await expect(page.getByLabel('Display name')).toHaveValue('RoundTrip', { timeout: 15000 });
});

test('AC-SET-2: reset stays disabled until RESET is typed', async ({ page }) => {
  await completeOnboarding(page);
  await page.goto('/settings');
  const resetButton = page.getByRole('button', { name: 'Reset all data' });
  await expect(resetButton).toBeDisabled();
  await page.getByLabel('Type RESET to reset all training data').fill('RES');
  await expect(resetButton).toBeDisabled();
  await page.getByLabel('Type RESET to reset all training data').fill('RESET');
  await expect(resetButton).toBeEnabled();
});

test('AC-SET-3: theme and glyph changes apply instantly without reload', async ({ page }) => {
  await completeOnboarding(page);
  await page.goto('/settings');
  const urlBefore = page.url();
  await page.locator('#set-theme').selectOption('light');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  expect(page.url()).toBe(urlBefore);
  await page.locator('#set-glyph').selectOption('playstation');
  await expect(page.locator('.z-input__btn', { hasText: '△' }).first()).toBeVisible();
  await page.locator('#set-glyph').selectOption('numeric');
  await expect(page.locator('.z-input__btn', { hasText: '△' })).toHaveCount(0);
  await expect(page.locator('.z-input__btn', { hasText: '2' }).first()).toBeVisible();
  expect(page.url()).toBe(urlBefore);
});

test('AC-DIAG-1: Run self-test reports pass or fail for every item', async ({ page }) => {
  await completeOnboarding(page);
  await page.goto('/diagnostics');
  await expect(page.getByText('Database schema')).toBeVisible();
  await page.getByRole('button', { name: 'Run self-test' }).click();
  const rows = page.locator('text=/Database write, read and delete/');
  await expect(rows).toBeVisible();
  for (const label of [
    'Database write, read and delete',
    'Integrity checks',
    'Pack validation and input tokenizing',
    'Dry-run plan and due-card count',
    'Service worker registration',
    'Storage estimate and persistence',
  ]) {
    await expect(page.getByText(new RegExp(`(Pass|Fail) — ${label}`))).toBeVisible();
  }
  await expect(page.getByText(/Pass — Database write, read and delete/)).toBeVisible();
  await expect(page.getByText(/Pass — Pack validation and input tokenizing/)).toBeVisible();
});

test('P10 axe: progress, patch, settings and diagnostics have no serious/critical violations', async ({ page }) => {
  await completeOnboarding(page);
  for (const route of ['/progress', '/patch', '/settings', '/diagnostics']) {
    await page.goto(route);
    await expect(page.locator('#main')).toBeVisible();
    const results = await new AxeBuilder({ page: page as never }).analyze();
    const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(serious, `${route}: ${JSON.stringify(serious, null, 2)}`).toEqual([]);
  }
});
