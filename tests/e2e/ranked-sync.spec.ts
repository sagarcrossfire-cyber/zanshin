// 2.0 M2 acceptance — Match Log "Sync ranked": mocked `/api/ranked` bodies
// (rankedOkSchema / rankedErrorSchema shapes), Synced chips, idempotent
// resync, error copy, the stop-loss protocol card, and ranked games on the
// detail page. Runs on the phone and desktop projects (playwright.config.ts).
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page, type Route } from '@playwright/test';

const RANKED = '**/api/ranked**';
const TEKKEN_ID = 'ABCD1234EFGH';
const DEVICE_KEY = 'a'.repeat(32);

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

/** Sets the Tekken ID and device key in Settings so syncRanked() can run. */
async function pairDevice(page: Page) {
  await page.goto('/settings');
  await page.getByLabel('Tekken ID (optional)').fill(TEKKEN_ID);
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByText('Settings saved.')).toBeVisible();
  await page.getByLabel('Device key', { exact: true }).fill(DEVICE_KEY);
  await page.getByRole('button', { name: 'Save device key' }).click();
  await expect(page.getByText(/Device key saved \(ends/)).toBeVisible();
}

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ body: JSON.stringify(body), contentType: 'application/json', status });
}

/** 5-8 ranked battles, two opponents, one rematch set (Kazuya), one
 * non-rematch repeat (two separate Paul sets, more than the 20-minute
 * grouping gap apart) — 4 battles, 3 sets, 4 games total. */
const MAIN_BODY = {
  ok: true,
  source: 'wank',
  cached: false,
  fetchedAt: '2026-11-02T21:00:00.000Z',
  playerName: 'SagarCrossfire',
  total: 4,
  windows: 2,
  battles: [
    {
      battleAt: '2026-11-02T18:08:00.000Z', myCharacter: 'Yoshimitsu', opponentCharacter: 'Kazuya',
      opponentId: 'KAZID001', myRank: 'Fighter', myRankIndex: 5, opponentRank: 'Brawler', opponentRankIndex: 4,
      result: 'win', roundsWon: 3, roundsLost: 1, ratingBefore: 1485, ratingChange: 18,
      source: 'wank', importRef: '1793728080:ABCD1234EFGH:KAZID001',
    },
    {
      battleAt: '2026-11-02T18:00:00.000Z', myCharacter: 'Yoshimitsu', opponentCharacter: 'Kazuya',
      opponentId: 'KAZID001', myRank: 'Fighter', myRankIndex: 5, opponentRank: 'Brawler', opponentRankIndex: 4,
      result: 'loss', roundsWon: 1, roundsLost: 3, ratingBefore: 1500, ratingChange: -15,
      source: 'wank', importRef: '1793727600:ABCD1234EFGH:KAZID001',
    },
    {
      battleAt: '2026-11-02T19:00:00.000Z', myCharacter: 'Yoshimitsu', opponentCharacter: 'Paul',
      opponentId: 'PAULID02', result: 'win', roundsWon: 3, roundsLost: 0, ratingChange: 20,
      source: 'wank', importRef: '1793731200:ABCD1234EFGH:PAULID02',
    },
    {
      battleAt: '2026-11-02T20:30:00.000Z', myCharacter: 'Yoshimitsu', opponentCharacter: 'Paul',
      opponentId: 'PAULID02', result: 'loss', roundsWon: 2, roundsLost: 3, ratingChange: -10,
      source: 'wank', importRef: '1793736600:ABCD1234EFGH:PAULID02',
    },
  ],
};

test('Sync ranked: rows appear with Synced chips and the right set count', async ({ page }) => {
  await page.route(RANKED, (route) => json(route, MAIN_BODY));
  await completeOnboarding(page);
  await pairDevice(page);
  await page.goto('/log');
  await page.getByRole('button', { name: 'Sync ranked' }).click();
  await expect(page.getByRole('button', { name: 'Syncing…' })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'Added' })).toContainText('Added 4 games (3 new sets).');
  await expect(page.getByText('Synced')).toHaveCount(3);
  await expect(page.getByRole('heading', { name: 'Kazuya' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Paul' })).toBeVisible();

  const results = await new AxeBuilder({ page: page as never }).analyze();
  const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(serious, JSON.stringify(serious, null, 2)).toEqual([]);
});

test('Sync ranked again with the same body: unchanged, "Up to date."', async ({ page }) => {
  await page.route(RANKED, (route) => json(route, MAIN_BODY));
  await completeOnboarding(page);
  await pairDevice(page);
  await page.goto('/log');
  await page.getByRole('button', { name: 'Sync ranked' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Added' })).toContainText('Added 4 games (3 new sets).');
  await expect(page.getByText('Synced')).toHaveCount(3);

  await page.getByRole('button', { name: 'Sync ranked' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Up to date.' })).toBeVisible();
  await expect(page.getByText('Synced')).toHaveCount(3);
});

test('Sync ranked: device-key-unset (503) shows the not-switched-on line', async ({ page }) => {
  await page.route(RANKED, (route) => json(route, { ok: false, code: 'device-key-unset', error: 'no device key hash configured' }, 503));
  await completeOnboarding(page);
  await pairDevice(page);
  await page.goto('/log');
  await page.getByRole('button', { name: 'Sync ranked' }).click();
  await expect(page.getByRole('status').filter({ hasText: "isn't switched on" })).toContainText("Ranked sync isn't switched on for this site yet.");
});

test('Protocol: three straight recent losses show the stop-loss card; Keep going hides it', async ({ page }) => {
  const now = Date.now();
  const iso = (minutesAgo: number) => new Date(now - minutesAgo * 60_000).toISOString();
  const body = {
    ok: true, source: 'wank', cached: false, fetchedAt: new Date(now).toISOString(),
    total: 3, windows: 1,
    battles: [
      {
        battleAt: iso(2), myCharacter: 'Yoshimitsu', opponentCharacter: 'Jin', opponentId: 'JINID001',
        result: 'loss', roundsWon: 1, roundsLost: 3, source: 'wank', importRef: `${Math.floor((now - 2 * 60_000) / 1000)}:ABCD1234EFGH:JINID001`,
      },
      {
        battleAt: iso(4), myCharacter: 'Yoshimitsu', opponentCharacter: 'Jin', opponentId: 'JINID001',
        result: 'loss', roundsWon: 0, roundsLost: 3, source: 'wank', importRef: `${Math.floor((now - 4 * 60_000) / 1000)}:ABCD1234EFGH:JINID001`,
      },
      {
        battleAt: iso(6), myCharacter: 'Yoshimitsu', opponentCharacter: 'Jin', opponentId: 'JINID001',
        result: 'loss', roundsWon: 1, roundsLost: 3, source: 'wank', importRef: `${Math.floor((now - 6 * 60_000) / 1000)}:ABCD1234EFGH:JINID001`,
      },
    ],
  };
  await page.route(RANKED, (route) => json(route, body));
  await completeOnboarding(page);
  await pairDevice(page);
  await page.goto('/log');
  await page.getByRole('button', { name: 'Sync ranked' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Added' })).toContainText('Added 3 games (1 new set).');
  await expect(page.getByRole('heading', { name: 'Three losses in a row' })).toBeVisible();
  await expect(page.getByText('Take a five-minute reset before the next set.')).toBeVisible();
  await page.getByRole('button', { name: 'Keep going' }).click();
  await expect(page.getByRole('heading', { name: 'Three losses in a row' })).toHaveCount(0);
});

test('Detail page lists the synced games; editing tallies clears "Add tallies"', async ({ page }) => {
  await page.route(RANKED, (route) => json(route, MAIN_BODY));
  await completeOnboarding(page);
  await pairDevice(page);
  await page.goto('/log');
  await page.getByRole('button', { name: 'Sync ranked' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Added' })).toContainText('Added 4 games (3 new sets).');

  await expect(page.getByRole('link', { name: 'Add tallies' }).first()).toBeVisible();
  const paulCard = page.locator('.z-card', { hasText: 'Paul' });
  await paulCard.getByRole('link', { name: /— 1–0 \(ranked\)/ }).click();
  await expect(page).toHaveURL(/\/log\/[^/]+$/);
  await expect(page.getByRole('heading', { name: 'Synced games' })).toBeVisible();
  await expect(page.getByText(/win \(3–0 rounds\)/)).toBeVisible();

  const results = await new AxeBuilder({ page: page as never }).analyze();
  const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(serious, JSON.stringify(serious, null, 2)).toEqual([]);

  await page.getByRole('link', { name: 'Edit' }).click();
  await expect(page.getByLabel('Date and time')).toBeVisible();
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page).toHaveURL(/\/log\/[^/]+$/);
  await page.goto('/log');
  await expect(page.getByRole('link', { name: 'Add tallies' })).toHaveCount(2);
});
