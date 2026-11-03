// 2.0 M2 regression guard — error result kinds not yet covered in
// ranked-sync.spec.ts (device-key, unknown-id/not-found, rate-limited,
// unavailable), plus the session-over reflection card (residual from t_f6169c61
// where only the stop-loss branch had e2e coverage) and an axe sweep on /log.
//
// Runs on phone, tablet AND desktop: playwright.config.ts includes
// **/*regressions.spec.ts in the tablet project's testMatch list.
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page, type Route } from '@playwright/test';

const RANKED = '**/api/ranked**';
const TEKKEN_ID = 'ABCD1234EFGH';
const DEVICE_KEY = 'a'.repeat(32);

// ──────────────────────────────────────────────────────────────────────────────
// Shared helpers — copied from ranked-sync.spec.ts so each file is standalone
// ──────────────────────────────────────────────────────────────────────────────

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

/** Raw IndexedDB write (no Dexie in the test process). */
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

// ──────────────────────────────────────────────────────────────────────────────
// M2 AC: e2e import covers every RankedSyncResult kind (missing error paths)
// handler status codes from src/server/ranked/handler.ts:
//   device-key → 401, not-found → 404, rate-limited → 429, upstream → 502
// ──────────────────────────────────────────────────────────────────────────────

test('M2 r1: Sync ranked device-key error shows wrong-key copy with Settings link', async ({ page }) => {
  await page.route(RANKED, (route) =>
    json(route, { ok: false, code: 'device-key', error: 'Device key hash mismatch.' }, 401),
  );
  await completeOnboarding(page);
  await pairDevice(page);
  await page.goto('/log');
  await page.getByRole('button', { name: 'Sync ranked' }).click();
  const status = page.getByRole('status');
  await expect(status.filter({ hasText: 'missing or wrong' })).toContainText(
    "This device's key is missing or wrong. Fix it in Settings.",
  );
  await expect(status.getByRole('link', { name: 'Settings' })).toBeVisible();
});

test('M2 r2: Sync ranked not-found (unknown-id) shows Tekken-ID copy with Settings link', async ({ page }) => {
  await page.route(RANKED, (route) =>
    json(route, { ok: false, code: 'not-found', error: 'No ranked data for that Tekken ID.' }, 404),
  );
  await completeOnboarding(page);
  await pairDevice(page);
  await page.goto('/log');
  await page.getByRole('button', { name: 'Sync ranked' }).click();
  const status = page.getByRole('status');
  await expect(status.filter({ hasText: 'Tekken ID' })).toContainText('Add your Tekken ID in Settings.');
  await expect(status.getByRole('link', { name: 'Settings' })).toBeVisible();
});

test('M2 r3: Sync ranked rate-limited (HTTP 429) shows slow-down copy', async ({ page }) => {
  await page.route(RANKED, (route) => route.fulfill({ status: 429, body: '', contentType: 'text/plain' }));
  await completeOnboarding(page);
  await pairDevice(page);
  await page.goto('/log');
  await page.getByRole('button', { name: 'Sync ranked' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Too many syncs' })).toContainText(
    'Too many syncs. Try again in a minute.',
  );
});

test("M2 r4: Sync ranked unavailable (upstream 502) shows \"Couldn't reach Wank\" copy", async ({ page }) => {
  await page.route(RANKED, (route) =>
    json(route, { ok: false, code: 'upstream', error: 'Upstream timeout.' }, 502),
  );
  await completeOnboarding(page);
  await pairDevice(page);
  await page.goto('/log');
  await page.getByRole('button', { name: 'Sync ranked' }).click();
  await expect(page.getByRole('status').filter({ hasText: "Couldn't reach" })).toContainText(
    "Couldn't reach Wank right now. Your log is unchanged.",
  );
});

// ──────────────────────────────────────────────────────────────────────────────
// M2 protocol: reflection card (session-over branch)
// Residual from t_f6169c61: ranked-sync.spec.ts only covers the stop-loss
// branch. This test uses idbPut to seed battles from > SESSION_RECENT_MINUTES
// (120 min) ago so computeProtocolCard() enters the "session over" branch.
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Minimal ranked MatchSet for direct IndexedDB seeding.
 * `at` / `battle.at` must be an ISO datetime string; `at` drives display,
 * `battle.at` drives the protocol-card session grouping.
 */
function oldRankedSet(
  id: string,
  at: string,
  result: 'win' | 'loss' | 'draw',
): Record<string, unknown> {
  const day = at.slice(0, 10);
  return {
    id, at, day,
    mode: 'ranked',
    opponentCharacter: 'Kazuya',
    games: 1,
    wins: result === 'win' ? 1 : 0,
    beatBy: [],
    tags: [],
    tallied: false,
    importRef: id,
    tallies: {
      missedPunishes: 0, flashHit: 0, flashBlocked: 0, flashWhiffed: 0,
      spinEscaped: 0, spinPunished: 0, throwsBroken: 0, throwsMissed: 0,
      hitWhileMinus: 0, lowsBlocked: 0, lowsEaten: 0,
      heatConverted: 0, heatWasted: 0, okiConverted: 0,
    },
    ranked: {
      source: 'wank',
      myCharacter: 'Yoshimitsu',
      // battle.at is what rankedBattlesOf → currentSessionBattles reads
      battles: [{ ref: id, at, result }],
    },
  };
}

test('M2 r5: Protocol reflection card shows after a completed session (≥3 games); Dismiss hides it', async ({ page }) => {
  await completeOnboarding(page);

  // Three battles from 180–182 min ago: all > SESSION_RECENT_MINUTES (120 min)
  // so currentSessionBattles(battles, now, null) returns [] and the protocol
  // card enters the "session over" branch.  All three are within the 30-min
  // SESSION_GAP_MINUTES window, so summarizeSession sees games = 3.
  const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
  await idbPut(page, 'matchSets', [
    oldRankedSet('refl-1', ago(182), 'win'),
    oldRankedSet('refl-2', ago(181), 'loss'),
    oldRankedSet('refl-3', ago(180), 'win'),
  ]);

  await page.goto('/log');
  await expect(page.getByRole('heading', { name: 'Session done' })).toBeVisible();
  await expect(page.getByText(/Thirty-second reflection/)).toBeVisible();

  await page.getByRole('button', { name: 'Dismiss' }).click();
  await expect(page.getByRole('heading', { name: 'Session done' })).toHaveCount(0);
});

// ──────────────────────────────────────────────────────────────────────────────
// Axe: /log accessible in dark and light themes (tablet project also runs this)
// ──────────────────────────────────────────────────────────────────────────────

for (const theme of ['dark', 'light'] as const) {
  test(`M2 r6: axe /log no serious/critical violations (${theme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme });
    await completeOnboarding(page);
    await page.goto('/log');
    await expect(page.locator('#main')).toBeVisible();
    const results = await new AxeBuilder({ page: page as never }).analyze();
    const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(serious, JSON.stringify(serious, null, 2)).toEqual([]);
  });
}
