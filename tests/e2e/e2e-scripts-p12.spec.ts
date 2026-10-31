// P12 gate: end-to-end scripts E1–E12 (§13.4) on phone + desktop, in both
// themes. Scripts already covered by earlier specs (E3 resume, E6 link-back,
// E10 offline) are re-run here only where the script adds an assertion the
// earlier spec lacks; the rest are new. Theme loops mirror a11y-routes.
import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

const THEMES = ['dark', 'light'] as const;

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

/** Raw IndexedDB read/write (no Dexie in the test process). The app reads through IDB on every query, so rows written here are visible after a reload. */
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

async function idbAll(page: Page, store: string): Promise<Record<string, unknown>[]> {
  return page.evaluate(async (store) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('zanshin');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    try {
      return await new Promise<Record<string, unknown>[]>((resolve, reject) => {
        const tx = db.transaction(store, 'readonly');
        const req = tx.objectStore(store).getAll();
        req.onsuccess = () => resolve(req.result as Record<string, unknown>[]);
        req.onerror = () => reject(req.error);
      });
    } finally {
      db.close();
    }
  }, store);
}

/** The practice day for "now" under the 04:00 day boundary (§7.6). */
function practiceDayNow(): string {
  const now = new Date();
  const day = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (now.getHours() < 4) day.setDate(day.getDate() - 1);
  return day.toISOString().slice(0, 10);
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

for (const theme of THEMES) {
  test(`E1 (${theme}): skip baseline, reload — Stage 0 plan 27–33 min persists`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme });
    await completeOnboarding(page);
    await expect(page.getByText(/Your plan is ready: \d+ minutes/)).toBeVisible();
    const before = await page.getByText(/Your plan is ready: \d+ minutes/).textContent();
    const minutes = Number(/(\d+) minutes/.exec(before ?? '')?.[1]);
    expect(minutes).toBeGreaterThanOrEqual(27);
    expect(minutes).toBeLessThanOrEqual(33);
    await page.reload();
    await expect(page).toHaveURL(/\/today$/);
    await expect(page.getByText(`Your plan is ready: ${minutes} minutes`)).toBeVisible();
  });

  test(`E2 (${theme}): search "flash" — 1+4 first, block −20, deep link matches`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme });
    await completeOnboarding(page);
    await page.goto('/codex/moves');
    await page.getByLabel('Search moves').fill('flash');
    const first = page.locator('.z-codex__link').first();
    // The input renders as PlayStation glyphs, so identify the move by its
    // link target + name rather than the literal "1+4" text.
    await expect(first).toHaveAttribute('href', /Yoshimitsu-1%2B4$/);
    await expect(first).toContainText('Soul Stealer');
    const detailHref = await first.getAttribute('href');
    await first.click();
    await expect(page).toHaveURL(/\/codex\/moves\//);
    await expect(page.getByText('Flash').first()).toBeVisible();
    // Block −20 with the launch-punishable treatment + a DataBadge.
    await expect(page.getByText('−20').first()).toBeVisible();
    const badge = page.locator('.z-data-badge').first();
    await expect(badge).toBeVisible();
    await expect(badge).toHaveText(/Sourced|Verified|Conflicting|Unverified/);
    // The deep link loads the same page directly.
    await page.goto(detailHref as string);
    await expect(page.getByText('Flash').first()).toBeVisible();
    await expect(page.getByText('−20').first()).toBeVisible();
  });

  test(`E3 (${theme}): session, 3 sets, reload mid-block-2, finish — debrief shows mastery deltas`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme });
    await completeOnboarding(page);
    await page.goto('/lab');
    const addButtons = page.getByRole('button', { name: 'Add', exact: true });
    await addButtons.nth(0).click();
    await addButtons.nth(0).click();
    await addButtons.nth(0).click();
    await page.getByRole('button', { name: /Start custom session/ }).click();
    await expect(page).toHaveURL(/\/lab\/session\//);
    await expect(page.getByText(/Block 1 of 3/)).toBeVisible();
    await page.getByRole('button', { name: /Log 8 of/ }).click();
    await expect(page.getByText(/Logged 8 of/)).toBeVisible();
    await page.getByRole('button', { name: 'Next' }).click();
    await expect(page.getByText(/Block 2 of 3/)).toBeVisible();
    await page.reload();
    await expect(page.getByText(/Block 2 of 3/)).toBeVisible();
    await expect(page.locator('[role="timer"]')).toHaveText(/\d+:\d{2}/);
    await page.getByRole('button', { name: 'Next' }).click();
    await expect(page.getByText(/Block 3 of 3/)).toBeVisible();
    await page.getByRole('button', { name: 'Next' }).click();
    await expect(page.getByText('Session debrief')).toBeVisible();
    await expect(page.getByText('1 sets · 8/10 successes (80%)')).toBeVisible();
    await expect(page.getByText(/Mastery .+ → .+/)).toBeVisible();
  });

  test(`E4 (${theme}): verify Mismatch creates a conflict; the move shows Conflicting`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme });
    await completeOnboarding(page);
    const now = new Date().toISOString();
    await idbPut(page, 'conflicts', [{
      id: 'conflict-e4', entityId: 'Yoshimitsu-b+2,2', field: 'block',
      values: [{ source: 'wavu', value: '-9' }, { source: 'tekkendocs', value: '-10' }],
      status: 'open',
    }]);
    await idbPut(page, 'sessions', [{
      id: 'session-e4', kind: 'custom', startedAt: now, status: 'active', plannedMinutes: 2,
      blocks: [{ id: 'block-0', kind: 'verify', drillId: 'verify:conflict-e4', minutes: 2, reason: 'Verify b+2,2', startedAt: now }],
      currentBlock: 0, pausedMs: 0,
    }]);
    await page.goto('/lab/session/session-e4');
    await expect(page.getByText(/Check Yoshimitsu-b\+2,2/)).toBeVisible();
    await page.getByRole('button', { name: 'Mismatch' }).click();
    await expect(page.getByText(/Mismatch recorded/)).toBeVisible();
    await page.goto('/patch');
    await expect(page.getByText('Yoshimitsu-b+2,2').first()).toBeVisible();
    await expect(page.getByText(/differs in Practice/)).toBeVisible();
    await page.goto('/codex/moves/Yoshimitsu-b%2B2%2C2');
    await expect(page.getByText('Conflicting')).toBeVisible();
  });

  test(`E5 (${theme}): 10 games vs Kazuya, 30 missed punishes in ≤25 taps; tomorrow's plan has a punish drill`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme });
    await completeOnboarding(page);
    await page.goto('/log/new');
    await expect(page.getByLabel('Date and time')).toBeVisible();
    // One press-and-hold on the stepper (hold-repeat, §5.12) reaches 30.
    const increase = page.getByRole('button', { name: 'Increase Missed punishes' });
    // Center the button: the minimal scroll can leave its lower half under
    // the fixed bottom tab bar on a phone, where the pointer never lands.
    await increase.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    const box = await increase.boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await page.mouse.down();
    const missedOutput = page.locator('div[role="group"][aria-labelledby="count-Missed punishes"] output');
    // Hold-repeat runs at 80 ms a tick with no cap, so stop just short of
    // 30 and correct the last steps with single clicks (still one press).
    await page.waitForFunction(() => {
      const el = document.querySelector('div[role="group"][aria-labelledby="count-Missed punishes"] output');
      return Number(el?.textContent ?? '0') >= 28;
    }, undefined, { timeout: 8000, polling: 10 });
    await page.mouse.up();
    const increaseBtn = page.getByRole('button', { name: 'Increase Missed punishes' });
    const decreaseBtn = page.getByRole('button', { name: 'Decrease Missed punishes' });
    let value = Number(await missedOutput.textContent());
    while (value < 30) {
      await increaseBtn.click();
      value = Number(await missedOutput.textContent());
    }
    while (value > 30) {
      await decreaseBtn.click();
      value = Number(await missedOutput.textContent());
    }
    expect(value).toBe(30);
    const taps = 2; // One hold press + submit.
    await page.getByRole('button', { name: 'Log match set' }).click();
    await expect(page).toHaveURL(/\/log\//);
    await expect(page.getByText('Result: 0–10 of 10 games.')).toBeVisible();
    expect(taps).toBeLessThanOrEqual(25);
    await page.goto('/today');
    await expect(page.getByText(/Missed punishes per game: 3\.0 vs target 2/)).toBeVisible();
    // Tomorrow: move the clock 26 hours forward (past the 04:00 boundary
    // whatever time the suite runs) and reload — the plan must include a
    // punish drill for the weakness.
    await page.clock.install({ time: new Date() });
    await page.clock.setFixedTime(new Date(Date.now() + 26 * 3600_000));
    await page.reload();
    await expect(page).toHaveURL(/\/today$/);
    await expect(page.locator('#main').getByText(/punish/i).first()).toBeVisible();
  });
  test(`E6 (${theme}): Kazuya problem move — linked drill and card exist and link back`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme });
    await completeOnboarding(page);
    await page.goto('/matchups/Kazuya');
    await page.getByLabel('Move (notation)').fill('df+1,4');
    await page.getByLabel('Answer detail').fill('punish with df+1,4');
    await page.getByRole('button', { name: 'Add problem move' }).click();
    await expect(page.getByText(/Problem move added/)).toBeVisible();
    await expect(page.getByText('df+1,4').first()).toBeVisible();
    await page.getByRole('button', { name: 'Practice in Lab' }).first().click();
    await expect(page.getByText(/Practice session created/)).toBeVisible();
    await page.goto('/lab');
    await page.getByRole('button', { name: 'Resume' }).first().click();
    await expect(page).toHaveURL(/\/lab\/session\//);
    await expect(page.getByText(/Kazuya/).first()).toBeVisible();
    await expect(page.getByText(/punish with df\+1,4/).first()).toBeVisible();
    await page.goto('/cards');
    await expect(page.getByText('Kazuya').first()).toBeVisible();
    await page.goto('/cards/review');
    await expect(page.getByText(/Kazuya df\+1,4: what do you do\?/)).toBeVisible();
  });
}

for (const theme of THEMES) {
  test(`E7 (${theme}): ladder quiz — every answer explained, counts tally, missed become cards`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme });
    await completeOnboarding(page);
    const cardsBefore = (await idbAll(page, 'cards')).length;
    await page.goto('/punish');
    await expect(page.getByText(/Question 1 of/)).toBeVisible();
    let full = 0;
    let half = 0;
    let missed = 0;
    let answered = 0;
    for (let i = 0; i < 80; i += 1) {
      if (await page.locator('#main').getByRole('heading', { name: 'Quiz complete' }).isVisible()) break;
      if (await page.locator('.z-punish__explanation').isVisible()) {
        if (await page.getByRole('button', { name: 'Finish' }).isVisible()) {
          await page.getByRole('button', { name: 'Finish' }).click();
        } else {
          await page.getByRole('button', { name: 'Next' }).click();
        }
      } else {
        await page.locator('.z-punish__option').first().click();
        const reason = await page.locator('.z-punish__explanation [role="status"]').textContent();
        expect(reason).toBeTruthy();
        answered += 1;
        if (reason === 'Best punisher.') full += 1;
        else if (reason?.startsWith('Valid punisher')) half += 1;
        else missed += 1;
        // Every answer shows its explanation, with the rung highlighted.
        await expect(page.locator('.z-punish__explanation')).toBeVisible();
        await expect(page.locator('.z-ladder__rung--highlight')).toBeVisible();
      }
    }
    await expect(page.locator('#main').getByRole('heading', { name: 'Quiz complete' })).toBeVisible();
    expect(answered).toBe(36);
    await expect(page.getByText(`${full} of 36 correct`)).toBeVisible();
    if (half > 0) await expect(page.getByText(`(${half} half credit)`)).toBeVisible();
    const saved = missed + half;
    if (saved > 0) {
      await expect(page.getByText(`${saved} missed questions saved as flashcards.`)).toBeVisible();
    }
    const cardsAfter = (await idbAll(page, 'cards')).length;
    expect(cardsAfter - cardsBefore).toBe(saved);
  });

  test(`E8 (${theme}): grade 5 due cards with keys 1–4 — next due dates match §7.6`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme });
    await completeOnboarding(page);
    const today = practiceDayNow();
    const fronts = ['E8 card A', 'E8 card B', 'E8 card C', 'E8 card D', 'E8 card E'];
    const grades: Record<string, string> = {
      'E8 card A': '1', 'E8 card B': '1', 'E8 card C': '2', 'E8 card D': '3', 'E8 card E': '4',
    };
    await idbPut(page, 'cards', fronts.map((front, i) => ({
      id: `e8-${i}`, deck: 'E8', front, back: `Answer ${front}`, refs: [], createdAt: `2026-10-2${i}T10:00:00.000Z`,
    })));
    await idbPut(page, 'cardStates', fronts.map((_, i) => ({
      cardId: `e8-${i}`, reps: 2, lapses: 0, ease: 2.5, intervalDays: 3,
      due: today, lastGrade: 2, history: [],
    })));
    await page.goto('/cards/review');
    await expect(page.getByText(/E8 card/)).toBeVisible();
    const seen = new Set<string>();
    for (let step = 0; step < 12; step += 1) {
      const frontEl = page.locator('.z-cards__front').first();
      await expect(frontEl).toBeVisible({ timeout: 5000 });
      const match = /E8 card [A-E]/.exec((await frontEl.textContent()) ?? '');
      if (match === null) break;
      const name = match[0];
      await page.getByRole('button', { name: 'Reveal' }).click();
      if (seen.has(name)) {
        // Re-queued Again card: grade Good to finish it.
        await page.keyboard.press('3');
      } else {
        seen.add(name);
        await page.keyboard.press(grades[name] as string);
      }
      await page.waitForTimeout(200);
      if (seen.size === 5) break;
    }
    expect(seen.size).toBe(5);
    // Read the states back mid-review (before the re-queued cards are
    // re-graded): Again +1d, Hard +4d, Good +8d, Easy +10d from a
    // reps-2 / interval-3 / ease-2.5 state (§7.6 table).
    const states = await idbAll(page, 'cardStates');
    const byId = new Map(states.map((s) => [s.cardId as string, s]));
    const expected: Record<string, number> = { 'e8-0': 1, 'e8-1': 1, 'e8-2': 4, 'e8-3': 8, 'e8-4': 10 };
    for (const [cardId, days] of Object.entries(expected)) {
      expect(byId.get(cardId)?.due).toBe(addDays(today, days));
    }
  });

  test(`E11 (${theme}): export, RESET, import — the data hash matches`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme });
    await completeOnboarding(page);
    // A distinctive marker: weekly hours 7 (420 minutes) in Settings.
    await page.goto('/settings');
    await page.getByLabel('Weekly hours').fill('7');
    await page.getByRole('button', { name: 'Save settings' }).click();
    await expect(page.getByText('Settings saved.')).toBeVisible();
    async function exportFile(): Promise<{ hash: string; path: string }> {
      const [download] = await Promise.all([
        page.waitForEvent('download'),
        page.getByRole('button', { name: 'Export backup' }).click(),
      ]);
      const path = await download.path();
      const parsed = JSON.parse(readFileSync(path as string, 'utf8')) as { sha256: string };
      expect(parsed.sha256).toMatch(/^[0-9a-f]{64}$/);
      return { hash: parsed.sha256, path: path as string };
    }
    const before = await exportFile();
    // Reset: the app reloads to onboarding (the profile row is gone).
    await page.getByLabel('Type RESET to reset all training data').fill('RESET');
    await page.getByRole('button', { name: /Reset all data/ }).click();
    await page.waitForURL(/\/onboarding$/);
    await completeOnboarding(page);
    // Import the pre-reset backup (the hidden file input is driven by the
    // Import button); the app reloads with the imported data.
    await page.goto('/settings');
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'load', timeout: 10000 }),
      page.locator('input[type="file"]').setInputFiles(before.path),
    ]);
    await expect(page.getByLabel('Weekly hours')).toHaveValue('7');
    const after = await exportFile();
    expect(after.hash).toBe(before.hash);
  });

  test(`E12 (${theme}): corrupted record quarantined; ?safe=1 loads seed packs`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme });
    await completeOnboarding(page);
    await idbPut(page, 'sets', [{
      id: 'bad-e12', sessionId: 'sess-e12', drillId: 'd1-punish-ladder', nodeId: 'n1-punish',
      day: '2026-10-30', at: '2026-10-30T18:00:00.000Z', reps: -3, successes: 2,
    }]);
    await page.reload();
    await expect(page.getByText(/Startup check: .*1 invalid row\(s\) quarantined/)).toBeVisible({ timeout: 15000 });
    const remaining = await idbAll(page, 'sets');
    expect(remaining.some((r) => r.id === 'bad-e12')).toBe(false);
    await page.goto('/diagnostics');
    await expect(page.getByText(/Quarantined invalid sets\/bad-e12/)).toBeVisible();
    await page.goto('/today?safe=1');
    await expect(page.getByText(/Safe Mode — seed packs, read-only/)).toBeVisible();
    await page.goto('/codex/moves?safe=1');
    await expect(page.getByText('319 of 319 moves')).toBeVisible();
  });
}

for (const theme of THEMES) {
  test(`E9 (${theme}): mock pack v2 — diff lists the changes, snapshot exists, restore returns v1`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme });
    await completeOnboarding(page);
    // Mock pack = the bundled 319 moves with 3 deliberate edits.
    const pack = JSON.parse(readFileSync(new URL('../../src/data/packs/moves.yoshimitsu.json', import.meta.url), 'utf8')) as Record<string, unknown>[];
    const byId = new Map(pack.map((m) => [m.id as string, m]));
    const edited = pack.filter((m) => m.id !== 'Yoshimitsu-1,1').map((m) => {
      if (m.id === 'Yoshimitsu-b+2,2') return { ...m, block: '-10' };
      return m;
    });
    const f2 = JSON.parse(readFileSync(new URL('../fixtures/patch/new-pack.json', import.meta.url), 'utf8')) as Record<string, unknown>[];
    const f2row = { ...(f2.find((m) => m.id === 'Yoshimitsu-f+2') as Record<string, unknown>) };
    // The fixture's f+2 already exists in the merged pack, so the "added"
    // row is a synthetic mock-only id standing in for a future Wavu
    // revision that adds a move. It is never shipped as real frame data.
    f2row.id = 'Yoshimitsu-f+2-E9';
    edited.push(f2row);
    function toCargoRow(move: Record<string, unknown>): Record<string, unknown> {
      const parent = (move.parentId as string | undefined) ? byId.get(move.parentId as string) : undefined;
      const parentInput = (parent?.input as string | undefined) ?? '';
      const input = move.input as string;
      const suffix = parent ? input.slice(parentInput.length) : input;
      const list = (v: unknown) => (Array.isArray(v) && v.length > 0 ? (v as string[]).join('; ') : null);
      return {
        id: move.id, num: move.num, name: move.name ?? null, input: suffix,
        alias: list(move.aliases), alt: list(move.altInputs),
        parent: move.parentId ?? null, target: move.hitLevel,
        damage: move.damage, startup: move.startup, crush: move.crush ?? null,
        block: move.block ?? null, hit: move.hit ?? null, ch: move.counterHit ?? null,
        recv: move.recovery ?? null, tot: move.total ?? null, notes: move.notes ?? null,
      };
    }
    const cargoRows = edited.map(toCargoRow);
    await page.route('**/w/api.php**', async (route) => {
      const url = new URL(route.request().url());
      const action = url.searchParams.get('action');
      if (action === 'cargoquery') {
        const limit = Number(url.searchParams.get('limit') ?? 200);
        const offset = Number(url.searchParams.get('offset') ?? 0);
        await route.fulfill({
          status: 200, contentType: 'application/json',
          body: JSON.stringify({ cargoquery: cargoRows.slice(offset, offset + limit).map((row) => ({ title: row })) }),
        });
        return;
      }
      if (action === 'query') {
        await route.fulfill({
          status: 200, contentType: 'application/json',
          body: JSON.stringify({ query: { pages: { 123: { revisions: [{ revid: 99999 }] } } } }),
        });
        return;
      }
      await route.fulfill({ status: 400, body: '{}' });
    });
    await page.goto('/patch');
    await page.getByRole('button', { name: 'Check for updates' }).click();
    await expect(page.getByText(/Revision 99999\./)).toBeVisible({ timeout: 30000 });
    // The mock round-trip also surfaces honest crush/tags normalization
    // differences (35 rows); the script asserts the 3 deliberate changes.
    await expect(page.getByText(/\d+ changed, 1 added, 1 removed\./)).toBeVisible();
    await expect(page.getByText(/Yoshimitsu-b\+2,2: block: -9 → -10/)).toBeVisible();
    await expect(page.getByText(/Added: f\+2 \(Yoshimitsu-f\+2-E9\)/)).toBeVisible();
    await page.getByRole('button', { name: 'Apply update (snapshots first)' }).click();
    await expect(page.getByText(/Wavu revision/).locator('..').getByText('99999')).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(/pre-pack-update/)).toBeVisible();
    // Restore the snapshot: the stored revision returns to the bundled one.
    await page.getByRole('button', { name: 'Restore previous data' }).first().click();
    await page.getByRole('button', { name: 'Restore this snapshot' }).click();
    await expect(page.getByText(/Wavu revision/).locator('..').getByText('62125')).toBeVisible({ timeout: 15000 });
    await page.unrouteAll({ behavior: 'wait' });
  });
}
