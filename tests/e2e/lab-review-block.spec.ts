// QA B3: a plan whose first block is a flashcard review ('N cards due')
// used to dead-end the runner on 'Block not found' (no drillId to resolve).
// This spec seeds a due card, runs the planned session end to end, and
// asserts the runner never shows that error and instead offers a way to
// review the cards and move on (§5.5).
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

/** The practice day for "now" under the 04:00 day boundary (§7.6). */
function practiceDayNow(): string {
  const now = new Date();
  const day = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (now.getHours() < 4) day.setDate(day.getDate() - 1);
  return day.toISOString().slice(0, 10);
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

test('planned session with a due flashcard review block completes end to end (QA B3)', async ({ page }) => {
  await completeOnboarding(page);
  const today = practiceDayNow();
  // On day 1 cards are already due: seed one so the plan's first block is a
  // review block with no drillId.
  await idbPut(page, 'cards', [
    { id: 'b3-card-0', deck: 'B3', front: 'B3 card', back: 'Answer B3 card', refs: [], createdAt: '2026-10-20T10:00:00.000Z' },
  ]);
  await idbPut(page, 'cardStates', [
    { cardId: 'b3-card-0', reps: 2, lapses: 0, ease: 2.5, intervalDays: 3, due: today, lastGrade: 2, history: [] },
  ]);

  await page.goto('/lab');
  await page.getByRole('button', { name: 'Start today’s session' }).click();
  await expect(page).toHaveURL(/\/lab\/session\//);

  // Step through every block with Next until the debrief, asserting the
  // error card never appears and the review block shows up once with a
  // working link to /cards/review.
  let sawReviewBlock = false;
  for (let step = 0; step < 20; step += 1) {
    await expect(page.getByText('Block not found')).toHaveCount(0);
    if (await page.getByText('Session debrief').isVisible().catch(() => false)) break;
    if (await page.getByRole('heading', { name: 'Flashcard review' }).isVisible().catch(() => false)) {
      sawReviewBlock = true;
      const link = page.getByRole('link', { name: 'Review cards' });
      await expect(link).toHaveAttribute('href', '/cards/review');
    }
    await page.getByRole('button', { name: 'Next' }).click();
    // The block (or the debrief) swap is driven by an async IndexedDB write;
    // wait for the DOM to settle before the next query so the "Next" button
    // from the block we just left is never raced mid-unmount.
    await page.waitForTimeout(250);
  }
  await expect(page.getByText('Block not found')).toHaveCount(0);
  await expect(page.getByText('Session debrief')).toBeVisible();
  expect(sawReviewBlock).toBe(true);
});
