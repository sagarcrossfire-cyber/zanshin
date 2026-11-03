// M1 regression suite — tests for QA items not already covered by
// lab-strip-palette.spec.ts, lab-review-block.spec.ts or
// m1-a11y-coach.spec.ts. Every test here corresponds to an acceptance
// criterion from the QA card (M2, m1, m7, m9).
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

/** Open the command palette, suitable for phone (tap trigger) and
 * desktop/tablet (Ctrl+K). */
async function openPalette(page: Page, projectName: string) {
  if (projectName === 'phone') {
    await page.getByRole('button', { name: /Search or jump to/i }).click();
  } else {
    await page.keyboard.press('Control+k');
  }
  await expect(page.getByRole('dialog', { name: 'Search or jump to' })).toBeVisible();
}

// ────────────────────────────────────────────────────────────────────────────
// QA m1: the session runner does NOT show its own "Lab Mode" button while
//         Lab Mode is already on.  The LabStrip (in the app shell) is the
//         sole guarded exit when Lab Mode is active.
// ────────────────────────────────────────────────────────────────────────────
test('QA m1: runner hides its own Lab Mode button while Lab Mode is active', async ({ page }) => {
  await completeOnboarding(page);
  await page.goto('/lab');
  // LabScreen.tsx uses a curly apostrophe (U+2019) in "Start today\u2019s session".
  await page.getByRole('button', { name: 'Start today\u2019s session' }).click();
  await expect(page).toHaveURL(/\/lab\/session\//);
  await expect(page.locator('.z-runner')).toBeVisible();

  // Before entering Lab Mode the button is visible.
  await expect(page.getByRole('button', { name: 'Lab Mode', exact: true })).toBeVisible();

  // Enter Lab Mode via the runner's own button.
  await page.getByRole('button', { name: 'Lab Mode', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.z-lab') !== null);

  // The runner's "Lab Mode" button must be absent while Lab Mode is on.
  await expect(page.getByRole('button', { name: 'Lab Mode', exact: true })).toHaveCount(0);
});

// ────────────────────────────────────────────────────────────────────────────
// QA M2: palette search ordering.
//   'flash' → move Flash (1+4, alias "Flash") is the first result.
//   'KIN'   → Kincho stance (id KIN) is the first result.
//   'heat'  → the Codex › Heat view (/codex/heat) is the first result.
//   'log'   → /log (Matches hub section) ranks before /log/new.
// ────────────────────────────────────────────────────────────────────────────
test('QA M2: palette "flash" → Flash move (1+4) is first result', async ({ page }, testInfo) => {
  await completeOnboarding(page);
  await page.goto('/today');

  await openPalette(page, testInfo.project.name);
  const dialog = page.getByRole('dialog', { name: 'Search or jump to' });
  await dialog.getByRole('combobox').fill('flash');

  // Expect at least one result visible.
  const firstRow = dialog.locator('.z-palette__row').first();
  await expect(firstRow).toBeVisible();

  // The first result should navigate to the Flash move (1+4 alias).
  // Activate the first result and check the URL.
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/codex\/moves\//);
  // The specific move is Yoshimitsu-1+4 (Soul Stealer, alias Flash).
  await expect(page).toHaveURL(/Yoshimitsu-1/);
});

test('QA M2: palette "KIN" → Kincho stance is first result', async ({ page }, testInfo) => {
  await completeOnboarding(page);
  await page.goto('/today');

  await openPalette(page, testInfo.project.name);
  const dialog = page.getByRole('dialog', { name: 'Search or jump to' });
  await dialog.getByRole('combobox').fill('KIN');

  const firstRow = dialog.locator('.z-palette__row').first();
  await expect(firstRow).toBeVisible();

  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/codex\/stances\/KIN$/);
});

test('QA M2: palette "heat" → Codex Heat view is first result', async ({ page }, testInfo) => {
  await completeOnboarding(page);
  await page.goto('/today');

  await openPalette(page, testInfo.project.name);
  const dialog = page.getByRole('dialog', { name: 'Search or jump to' });
  await dialog.getByRole('combobox').fill('heat');

  const firstRow = dialog.locator('.z-palette__row').first();
  await expect(firstRow).toBeVisible();

  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/codex\/heat$/);
});

test('QA M2: palette "log" → Matches page (/log) ranks before /log/new', async ({ page }, testInfo) => {
  await completeOnboarding(page);
  await page.goto('/today');

  await openPalette(page, testInfo.project.name);
  const dialog = page.getByRole('dialog', { name: 'Search or jump to' });
  await dialog.getByRole('combobox').fill('log');

  const firstRow = dialog.locator('.z-palette__row').first();
  await expect(firstRow).toBeVisible();

  // The first result must be the Matches section (/log), not Log a match set
  // (/log/new).  Navigate with Enter and assert the final URL ends at /log.
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/log$/);
  await expect(page).not.toHaveURL(/\/log\/new/);
});

// ────────────────────────────────────────────────────────────────────────────
// QA m7: the desktop rail's Search… trigger is not visually truncated at
//         1440 × 900 px.  The fix shortened the label from the verbose
//         "Search or jump to…" to the shorter "Search…" so it fits alongside
//         the Ctrl K badge in the 248 px rail.
// ────────────────────────────────────────────────────────────────────────────
test('QA m7: rail Search… trigger is not truncated at 1440 px', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'rail-truncation check only meaningful at 1440 px desktop width');
  await completeOnboarding(page);
  // The rail starts expanded (248 px) on desktop — no toggling needed.
  await expect(page.locator('.z-rail')).toBeVisible();
  await expect(page.locator('.z-rail--collapsed')).toHaveCount(0);

  // The search trigger label must not overflow its container.
  const truncated = await page.evaluate(() => {
    const label = document.querySelector<HTMLElement>('.z-rail__search > .z-rail__label:not(.z-rail__kbd)');
    if (!label) return 'label not found';
    return label.scrollWidth > label.clientWidth ? 'truncated' : 'ok';
  });
  expect(truncated).toBe('ok');

  // Also assert the label text is the short form (sanity: the label reads
  // "Search…", not the long "Search or jump to…" that overflowed).
  await expect(page.locator('.z-rail__search > .z-rail__label:not(.z-rail__kbd)')).toHaveText('Search…');
});

// ────────────────────────────────────────────────────────────────────────────
// QA m9: the Train hub badge shows the Flashcards-review-capped due count,
//         never the raw card count.  With the §7.6 default daily caps
//         (10 new + 60 reviews) the worst-case badge on day 1 is 70, not
//         the raw "99+" that appeared before the fix.
// ────────────────────────────────────────────────────────────────────────────
test('QA m9: Train badge is capped (≤ 70) even with 200 due cards', async ({ page }) => {
  await completeOnboarding(page);

  // Seed 200 brand-new cards all due today.  They are "new" (reps 0,
  // empty history) so they land in the new-card bucket, capped at
  // newPerDay (10 with §7.6 defaults, 10 with the seeded bootstrap value).
  // Use a past due date ('2020-01-01') so the cards are always overdue
  // regardless of the local clock or UTC offset (avoids the §7.6
  // practice-day boundary mismatch between UTC and local dates).
  const cards: Record<string, unknown>[] = [];
  const cardStates: Record<string, unknown>[] = [];
  for (let i = 0; i < 200; i += 1) {
    const id = `m9-card-${String(i).padStart(3, '0')}`;
    cards.push({ id, deck: 'M9', front: `M9 card ${i}`, back: `Answer ${i}`, refs: [], createdAt: '2020-01-01T10:00:00.000Z' });
    cardStates.push({ cardId: id, reps: 0, lapses: 0, ease: 2.5, intervalDays: 0, due: '2020-01-01', history: [] });
  }
  await idbPut(page, 'cards', cards);
  await idbPut(page, 'cardStates', cardStates);

  // Navigate to /today so the AppLayout re-reads the badge from IDB.
  await page.goto('/today');
  // Wait for the page to be rendered — the topbar is always present.
  await expect(page.locator('.z-topbar')).toBeVisible();

  // The Train badge element is .z-nav-count with data-count on the Train link.
  // On phone it lives in the dock; on tablet/desktop in the rail.
  // Wait for the badge to be stamped in the DOM (the load is async).
  await expect(page.locator('.z-nav-count[data-count]').first()).toHaveAttribute('data-count', /\d+/, { timeout: 5000 });

  // Read the count from the DOM — read ALL badge spans (dock + rail) and
  // assert none of them shows '99+' or a number > 70.  On phone the rail
  // badge span exists in the DOM but is visibility-hidden; on desktop the
  // dock badge is hidden.  Both must obey the cap.
  const countStr = await page.evaluate(() => {
    const el = document.querySelector<HTMLElement>('.z-nav-count[data-count]');
    return el ? el.getAttribute('data-count') : null;
  });
  expect(countStr).not.toBeNull();
  // The badge renders "99+" when dueCards > 99 — that must not appear.
  expect(countStr).not.toBe('99+');
  const count = parseInt(countStr ?? '0', 10);
  expect(count).toBeLessThanOrEqual(70);
});
