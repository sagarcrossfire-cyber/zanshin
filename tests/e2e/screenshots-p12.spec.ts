// P12 screenshots: every primary route, both themes, both projects, into
// qa/screenshots/P12/. For human visual review against the P1 gallery shots.
import { expect, test, type Page } from '@playwright/test';

const THEMES = ['dark', 'light'] as const;
const ROUTES: { name: string; path: string }[] = [
  { name: 'today', path: '/today' },
  { name: 'path', path: '/path' },
  { name: 'codex-moves', path: '/codex/moves' },
  { name: 'move-detail', path: '/codex/moves/Yoshimitsu-1%2B4' },
  { name: 'stances', path: '/codex/stances' },
  { name: 'combos', path: '/codex/combos' },
  { name: 'heat', path: '/codex/heat' },
  { name: 'lab', path: '/lab' },
  { name: 'log', path: '/log' },
  { name: 'matchups', path: '/matchups' },
  { name: 'playbook', path: '/playbook' },
  { name: 'punish', path: '/punish' },
  { name: 'cards', path: '/cards' },
  { name: 'cards-review', path: '/cards/review' },
  { name: 'baseline', path: '/baseline' },
  { name: 'coach', path: '/coach' },
  { name: 'progress', path: '/progress' },
  { name: 'patch', path: '/patch' },
  { name: 'settings', path: '/settings' },
  { name: 'diagnostics', path: '/diagnostics' },
  { name: 'onboarding', path: '/onboarding' },
];

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

for (const theme of THEMES) {
  for (const route of ROUTES) {
    test(`screenshot ${route.name} (${theme})`, async ({ page }, testInfo) => {
      await page.emulateMedia({ colorScheme: theme });
      if (route.path !== '/onboarding' && route.path !== '/baseline') {
        await completeOnboarding(page);
      }
      if (route.path === '/cards/review') {
        // One due card so the review screen has content.
        await page.evaluate(async () => {
          const db = await new Promise<IDBDatabase>((resolve, reject) => {
            const req = indexedDB.open('zanshin');
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
          });
          await new Promise<void>((resolve, reject) => {
            const tx = db.transaction(['cards', 'cardStates'], 'readwrite');
            tx.objectStore('cards').put({ id: 'shot-1', deck: 'Core moves', front: '1+4', back: 'Flash', refs: [], createdAt: '2026-10-20T10:00:00.000Z' });
            tx.objectStore('cardStates').put({ cardId: 'shot-1', reps: 1, lapses: 0, ease: 2.5, intervalDays: 1, due: '2026-10-29', lastGrade: 3, history: [] });
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
          });
          db.close();
        });
      }
      await page.goto(route.path);
      await page.locator('#main').waitFor();
      await page.waitForTimeout(300);
      const project = testInfo.project.name;
      await page.screenshot({ path: `qa/screenshots/P12/${route.name}-${theme}-${project}.png` });
    });
  }

  test(`screenshot lab-runner (${theme})`, async ({ page }, testInfo) => {
    await page.emulateMedia({ colorScheme: theme });
    await completeOnboarding(page);
    const now = new Date().toISOString();
    await page.evaluate(async (now) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open('zanshin');
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('sessions', 'readwrite');
        tx.objectStore('sessions').put({
          id: 'session-shot', kind: 'custom', startedAt: now, status: 'active', plannedMinutes: 10,
          blocks: [{ id: 'block-0', kind: 'drill', drillId: 'd1-punish-ladder', minutes: 5, reason: 'Screenshot', startedAt: now }],
          currentBlock: 0, pausedMs: 0,
        });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      db.close();
    }, now);
    await page.goto('/lab/session/session-shot');
    await page.locator('#main').waitFor();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `qa/screenshots/P12/lab-runner-${theme}-${testInfo.project.name}.png` });
  });
}
