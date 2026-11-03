// QA m9: the Train badge must show the count Flashcards review would
// actually serve today (daily-capped), not the raw due count — e.g. 111
// due cards on day one with the §7.6 defaults (10 new + 60 reviews) shows
// 70, not 111 (which the dock/rail would otherwise render as "99+").
import { describe, expect, it } from 'vitest';

const specifier: string = 'fake-indexeddb';
const fakeModule = await import(specifier).catch(() => null) as Record<string, unknown> | null;
const fakeAvailable = fakeModule !== null && typeof fakeModule['indexedDB'] === 'object';
if (fakeAvailable) {
  const globals = globalThis as Record<string, unknown>;
  globals['indexedDB'] = fakeModule?.['indexedDB'];
  globals['IDBKeyRange'] = fakeModule?.['IDBKeyRange'];
}

const repos = fakeAvailable ? await import('../../../src/data/repos/index') : null;
const dbModule = fakeAvailable ? await import('../../../src/data/db') : null;
const navBadgesModule = fakeAvailable ? await import('../../../src/services/navBadges') : null;

import type { Card, CardState } from '../../../src/data/schemas';
import { todayIso } from '../../../src/app/plan';

function card(id: string): Card {
  return { id, deck: 'Notation', front: id, back: `${id} back`, refs: [], createdAt: '2026-10-29T05:00:00' };
}

function dueState(id: string): CardState {
  return { cardId: id, reps: 0, lapses: 0, ease: 2.5, intervalDays: 0, due: todayIso(), history: [] };
}

describe.skipIf(!fakeAvailable)('loadNavBadges — capped due count (QA m9)', () => {
  it('caps at the §7.6 defaults (10 new + 60 reviews) instead of showing the raw due count', async () => {
    if (repos === null || dbModule === null || navBadgesModule === null) return;
    await dbModule.resetDbForTests();
    // 111 brand-new cards, all due today: the review screen would only
    // serve 10 of them (the new-card cap), never 111.
    for (let i = 0; i < 111; i += 1) {
      const id = `card-${String(i).padStart(3, '0')}`;
      await repos.cardsRepo.put(card(id));
      await repos.cardStatesRepo.put(dueState(id));
    }
    const badges = await navBadgesModule.loadNavBadges(undefined);
    expect(badges.dueCards).toBe(10);
  });

  it('honours stored caps from settings when present', async () => {
    if (repos === null || dbModule === null || navBadgesModule === null) return;
    await dbModule.resetDbForTests();
    for (let i = 0; i < 5; i += 1) {
      const id = `s-${i}`;
      await repos.cardsRepo.put(card(id));
      await repos.cardStatesRepo.put(dueState(id));
    }
    const badges = await navBadgesModule.loadNavBadges({ newCardsPerDay: 2, reviewsPerDay: 60 });
    expect(badges.dueCards).toBe(2);
  });

  it('returns 0 when nothing is due', async () => {
    if (repos === null || dbModule === null || navBadgesModule === null) return;
    await dbModule.resetDbForTests();
    const badges = await navBadgesModule.loadNavBadges(undefined);
    expect(badges.dueCards).toBe(0);
  });
});
