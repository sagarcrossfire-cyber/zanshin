// 2.0 M2 — Progress "Ranked" card: current rank + band line from synced
// ranked games, the empty state when nothing is synced yet, and axe on
// /progress in both themes.
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

/** Raw IndexedDB write (no Dexie in the test process) — pattern from
 * tests/e2e/lab-review-block.spec.ts. */
async function idbPut(page: Page, store: string, rows: Record<string, unknown>[]): Promise<void> {
  await page.evaluate(async ({ store, rows }) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('zanshin');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(store, 'readwrite');
        const os = tx.objectStore(store);
        for (const row of rows) os.put(row);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  }, { store, rows });
}

function syncedRankedSet(id: string, day: string, at: string, myRank: string, myRankIndex: number, ratingBefore: number, ratingChange: number) {
  return {
    id, at, day, mode: 'ranked', opponentCharacter: 'Kazuya', opponentRank: 'Garyu',
    games: 1, wins: 1, beatBy: [], tags: [], tallied: false, importRef: id,
    tallies: {
      missedPunishes: 0, flashHit: 0, flashBlocked: 0, flashWhiffed: 0,
      spinEscaped: 0, spinPunished: 0, throwsBroken: 0, throwsMissed: 0,
      hitWhileMinus: 0, lowsBlocked: 0, lowsEaten: 0,
      heatConverted: 0, heatWasted: 0, okiConverted: 0,
    },
    ranked: {
      source: 'wank', myCharacter: 'Yoshimitsu',
      battles: [{
        ref: id, at, result: 'win', myRank, myRankIndex,
        opponentRank: 'Garyu', opponentRankIndex: 15,
        ratingBefore, ratingChange,
      }],
    },
  };
}

test('synced ranked games show the Ranked card with the current rank and band line', async ({ page }) => {
  await completeOnboarding(page);
  await idbPut(page, 'matchSets', [
    syncedRankedSet('ranked-1', '2026-10-28', '2026-10-28T10:00:00.000Z', 'Destroyer', 13, 1480, 18),
    syncedRankedSet('ranked-2', '2026-10-29', '2026-10-29T10:00:00.000Z', 'Eliminator', 14, 1498, 22),
  ]);
  await page.goto('/progress');
  const card = page.locator('.z-card', { has: page.getByRole('heading', { name: 'Ranked' }) });
  await expect(card.getByText('Eliminator', { exact: true })).toBeVisible();
  await expect(card.getByText('Target: Tekken King')).toBeVisible();
  await expect(card.getByText(/Path Stage 0.3/)).toBeVisible();
  await expect(card.getByText(/You're on Stage/)).toBeVisible();
});

test('no synced ranked games shows the empty state with a link to Matches', async ({ page }) => {
  await completeOnboarding(page);
  await page.goto('/progress');
  const card = page.locator('.z-card', { has: page.getByRole('heading', { name: 'Ranked' }) });
  await expect(card.getByText('Target: Tekken King')).toBeVisible();
  await expect(card.getByText('Sync ranked games from Matches to see your climb.')).toBeVisible();
  await card.getByRole('link', { name: 'Go to Matches' }).click();
  await expect(page).toHaveURL(/\/log$/);
});

for (const theme of ['dark', 'light'] as const) {
  test(`axe: /progress with a synced Ranked card has no serious/critical violations (${theme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme });
    await completeOnboarding(page);
    await idbPut(page, 'matchSets', [
      syncedRankedSet('ranked-1', '2026-10-28', '2026-10-28T10:00:00.000Z', 'Destroyer', 13, 1480, 18),
      syncedRankedSet('ranked-2', '2026-10-29', '2026-10-29T10:00:00.000Z', 'Eliminator', 14, 1498, 22),
    ]);
    await page.goto('/progress');
    await expect(page.locator('#main')).toBeVisible();
    await expect(page.getByText('Eliminator').first()).toBeVisible();
    const results = await new AxeBuilder({ page: page as never }).analyze();
    const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(serious, JSON.stringify(serious, null, 2)).toEqual([]);
  });
}
