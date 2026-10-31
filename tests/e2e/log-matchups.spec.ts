// P7 gate: Match Log, Matchups, Playbook (§5.11/§5.12, AC-LOG-1–4,
// AC-MU-1–3, AC-PB-1). Onboarding is completed first (routes are guarded);
// each test gets a fresh browser context. The tap-count test counts the
// clicks it performs and asserts the §5.12 budget (≤25 taps, <60 s).
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

async function clickStepper(page: Page, label: string, times: number, taps: { count: number }) {
  const button = page.getByRole('button', { name: `Increase ${label}` });
  for (let i = 0; i < times; i += 1) {
    await button.click();
    taps.count += 1;
  }
}

test('AC-LOG-1: log a 10-game set in ≤25 taps and <60s', async ({ page }) => {
  await completeOnboarding(page);
  const taps = { count: 0 };
  const started = Date.now();
  await page.goto('/log');
  await page.getByRole('button', { name: 'Log a match set' }).click();
  taps.count += 1;
  await expect(page.getByLabel('Date and time')).toBeVisible();
  await clickStepper(page, 'Games won', 3, taps);
  await clickStepper(page, 'Missed punishes', 6, taps);
  await clickStepper(page, 'Lows blocked', 2, taps);
  await clickStepper(page, 'Heat converted', 1, taps);
  await clickStepper(page, 'Flash hit', 1, taps);
  await page.getByRole('button', { name: 'Log match set' }).click();
  taps.count += 1;
  await expect(page).toHaveURL(/\/log\//);
  await expect(page.getByText('Result: 3–7 of 10 games.')).toBeVisible();
  expect(taps.count).toBeLessThanOrEqual(25);
  expect(Date.now() - started).toBeLessThan(60_000);
});

test('AC-LOG-2/G5: two logged 5-game sets drive Today Focus (3.0 vs 2.0)', async ({ page }) => {
  await completeOnboarding(page);
  for (let round = 0; round < 2; round += 1) {
    await page.goto('/log/new');
    await expect(page.getByLabel('Date and time')).toBeVisible();
    // The steppers repeat while held, so on a busy machine a pointer click
    // whose release is delayed can step twice. Enter fires a plain click:
    // one step each, every time.
    const decrease = page.getByRole('button', { name: 'Decrease Games played' });
    await decrease.focus();
    for (let i = 0; i < 5; i += 1) await page.keyboard.press('Enter'); // Games: 10 -> 5.
    await expect(page.locator('output', { hasText: /^5$/ }).first()).toBeVisible();
    const increaseMissed = page.getByRole('button', { name: 'Increase Missed punishes' });
    await increaseMissed.focus();
    for (let i = 0; i < 15; i += 1) await page.keyboard.press('Enter');
    await expect(page.locator('output', { hasText: /^15$/ })).toBeVisible();
    await page.getByRole('button', { name: 'Log match set' }).click();
    await expect(page).toHaveURL(/\/log\//);
    await expect(page.getByText(/of 5 games/)).toBeVisible();
  }
  await page.goto('/today');
  // Focus renders the weakness label, value to one decimal, and the target
  // as the number 2 (not 2.0). The whole card text is in the failure message.
  const focus = page.locator('#main');
  await expect(focus).toContainText(/Missed punishes per game/);
  expect(await focus.innerText()).toMatch(/Missed punishes per game: 3\.0 vs target 2/);
});

test('AC-LOG-3: CSV import dedupes on re-import', async ({ page }) => {
  await completeOnboarding(page);
  const csv = 'date,opponent,character,result,games,wins\n2026-10-30,Fan1,Kazuya,W,5,3\n';
  await page.goto('/log/import');
  await page.setInputFiles('input[aria-label="CSV file"]', {
    name: 'matches.csv', mimeType: 'text/csv', buffer: Buffer.from(csv),
  });
  await expect(page.getByText(/Imported 1 set\(s\) from CSV/)).toBeVisible();
  await page.setInputFiles('input[aria-label="CSV file"]', {
    name: 'matches.csv', mimeType: 'text/csv', buffer: Buffer.from(csv),
  });
  await expect(page.getByText(/Imported 0 set\(s\) from CSV \(1 duplicate\(s\) skipped\)/)).toBeVisible();
});

test('AC-LOG-4/AC-MU-1: "what beat me" becomes a problem move with drill + card', async ({ page }) => {
  await completeOnboarding(page);
  await page.goto('/log/new');
  await expect(page.getByLabel('Date and time')).toBeVisible();
  await page.getByLabel('Opponent move (notation)').fill('df+2');
  await page.getByLabel('Answer detail').fill('Block and launch with df+2.');
  await page.getByRole('button', { name: 'Add as problem move' }).click();
  await expect(page.getByText(/Problem move added: df\+2/)).toBeVisible();
  await page.getByRole('button', { name: 'Log match set' }).click();
  await expect(page).toHaveURL(/\/log\//);
  await page.goto('/matchups/Kazuya');
  // The move itself renders as PlayStation glyphs (InputString), so assert
  // the plain-text answer plus the Lab action.
  await expect(page.getByText(/punish: Block and launch with df\+2/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Practice in Lab' })).toBeVisible();
});

test('AC-MU-2/AC-MU-3: matchups list, win-rate threshold, external links', async ({ page }) => {
  await completeOnboarding(page);
  await page.goto('/matchups');
  await expect(page.getByRole('heading', { name: 'Kazuya' })).toBeVisible();
  // Every roster card shows the threshold line; assert the first one.
  await expect(page.getByText('Not enough games yet (0/10).').first()).toBeVisible();
  await page.goto('/matchups/Kazuya');
  const wavu = page.getByRole('link', { name: 'Wavu Wiki page' });
  await expect(wavu).toHaveAttribute('href', /wavu\.wiki/);
  await expect(wavu).toHaveAttribute('target', '_blank');
  await expect(page.getByRole('link', { name: 'Counterplay page' })).toHaveAttribute('target', '_blank');
});

test('AC-PB-1: playbook counterplay and plans link to moves and drills', async ({ page }) => {
  await completeOnboarding(page);
  await page.goto('/playbook');
  await expect(page.getByRole('heading', { name: 'Counterplay — what they do to Yoshimitsu' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Sidestep to his right' })).toBeVisible();
  const moveLink = page.locator('a[href^="/codex/moves/"]').first();
  await expect(moveLink).toBeVisible();
  await expect(page.locator('a[href^="/path/"]').first()).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Keepout' })).toBeVisible();
});
