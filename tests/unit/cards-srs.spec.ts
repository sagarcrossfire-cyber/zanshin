// AC-CARDS-1/2 — grades schedule exactly per §7.6 (all 9 table rows,
// fixed clocks, including the 01:30 late-night case), due counts are
// correct across the 04:00 boundary, and reviewQueue honours the daily
// caps without hiding overdue cards. gradeAndSchedule persists through
// the Dexie repos, so these tests use the fake-indexeddb pattern from
// tests/unit/data/repos.spec.ts and skip when it is unavailable.
import { describe, expect, it } from 'vitest';

const specifier: string = 'fake-indexeddb';
const fakeModule = await import(specifier).catch(() => null) as Record<string, unknown> | null;
const fakeAvailable = fakeModule !== null && typeof fakeModule['indexedDB'] === 'object';
if (fakeAvailable) {
  const globals = globalThis as Record<string, unknown>;
  globals['indexedDB'] = fakeModule?.['indexedDB'];
  globals['IDBKeyRange'] = fakeModule?.['IDBKeyRange'];
}

const repos = fakeAvailable ? await import('../../src/data/repos/index') : null;
const dbModule = fakeAvailable ? await import('../../src/data/db') : null;
const cardsService = fakeAvailable ? await import('../../src/services/cards') : null;

import { dueCount, practiceDay, type CardState } from '../../src/domain/engine/srs';
import type { Card } from '../../src/data/schemas';

function state(overrides: Partial<CardState> = {}): CardState {
  return {
    cardId: 'c1', reps: 0, lapses: 0, ease: 2.5, intervalDays: 0,
    due: '2026-10-29', history: [], ...overrides,
  };
}

function card(id: string, deck = 'Notation'): Card {
  return {
    id, deck, front: id, back: `${id} back`, refs: [], createdAt: '2026-10-29T05:00:00',
  };
}

describe.skipIf(!fakeAvailable)('gradeAndSchedule — the §7.6 table', () => {
  const AT = '2026-10-30T20:00:00';
  const cases: Array<{
    label: string; start: CardState; grade: 0 | 1 | 2 | 3;
    gradedAt: string; reps: number; interval: number; ease: number; lapses: number; due: string;
  }> = [
    { label: 'new card, Good', start: state(), grade: 2, gradedAt: AT, reps: 1, interval: 1, ease: 2.5, lapses: 0, due: '2026-10-31' },
    { label: 'second review, Good', start: state({ reps: 1, intervalDays: 1 }), grade: 2, gradedAt: AT, reps: 2, interval: 3, ease: 2.5, lapses: 0, due: '2026-11-02' },
    { label: 'third review, Good (7.5 rounds up)', start: state({ reps: 2, intervalDays: 3, ease: 2.5 }), grade: 2, gradedAt: AT, reps: 3, interval: 8, ease: 2.5, lapses: 0, due: '2026-11-07' },
    { label: 'Easy on a new card', start: state(), grade: 3, gradedAt: AT, reps: 1, interval: 4, ease: 2.65, lapses: 0, due: '2026-11-03' },
    { label: 'lapse, Again', start: state({ reps: 3, intervalDays: 8, ease: 2.5 }), grade: 0, gradedAt: AT, reps: 0, interval: 1, ease: 2.3, lapses: 1, due: '2026-10-31' },
    { label: 'Hard', start: state({ reps: 3, intervalDays: 8, ease: 2.5 }), grade: 1, gradedAt: AT, reps: 4, interval: 10, ease: 2.35, lapses: 0, due: '2026-11-09' },
    { label: 'ease floor, Again', start: state({ reps: 3, intervalDays: 8, ease: 1.35 }), grade: 0, gradedAt: AT, reps: 0, interval: 1, ease: 1.3, lapses: 1, due: '2026-10-31' },
    { label: 'interval cap, Good', start: state({ reps: 5, intervalDays: 150, ease: 2.5 }), grade: 2, gradedAt: AT, reps: 6, interval: 180, ease: 2.5, lapses: 0, due: '2027-04-28' },
    {
      label: 'late night, Good at 01:30', start: state(), grade: 2,
      gradedAt: '2026-10-30T01:30:00', reps: 1, interval: 1, ease: 2.5, lapses: 0, due: '2026-10-30',
    },
  ];

  it.each(cases)('$label', async ({ start, grade, gradedAt, reps, interval, ease, lapses, due }) => {
    if (repos === null || dbModule === null || cardsService === null) return;
    await dbModule.resetDbForTests();
    await repos.cardStatesRepo.put({ ...start, cardId: 'c1' });
    const next = await cardsService.gradeAndSchedule('c1', grade, gradedAt, '04:00');
    expect(next.reps).toBe(reps);
    expect(next.intervalDays).toBe(interval);
    expect(next.ease).toBeCloseTo(ease);
    expect(next.lapses).toBe(lapses);
    expect(next.due).toBe(due);
    expect(next.lastGrade).toBe(grade);
    // Persisted: a fresh read returns the graded state.
    const stored = await repos.cardStatesRepo.get('c1');
    expect(stored).toEqual(next);
  });

  it('creates a state when the card has none', async () => {
    if (dbModule === null || cardsService === null || repos === null) return;
    await dbModule.resetDbForTests();
    const next = await cardsService.gradeAndSchedule('c-new', 2, AT, '04:00');
    expect(next.reps).toBe(1);
    expect(next.intervalDays).toBe(1);
    expect(next.due).toBe('2026-10-31');
    expect((await repos.cardStatesRepo.get('c-new'))?.cardId).toBe('c-new');
  });

  it('late-night grading counts for the previous practice day (due count across the boundary)', async () => {
    // Graded 01:30 Oct 30, boundary 04:00 -> practice day Oct 29, due Oct 30.
    expect(practiceDay('2026-10-30T01:30:00', '04:00')).toBe('2026-10-29');
    const states = [
      state({ cardId: 'a', due: '2026-10-29' }),
      state({ cardId: 'b', due: '2026-10-30' }),
      state({ cardId: 'c', due: '2026-10-31' }),
    ];
    expect(dueCount(states, '2026-10-29')).toBe(1);
    expect(dueCount(states, '2026-10-30')).toBe(2);
    expect(dueCount(states, '2026-10-31')).toBe(3);
  });
});

describe('reviewQueue caps and partitioning (pure)', () => {
  it('caps new at 10 and reviews at 60, and counts the overdue remainder', async () => {
    if (cardsService === null) return;
    const cards: Card[] = [];
    const states: CardState[] = [];
    for (let i = 0; i < 15; i += 1) {
      const id = `new-${String(i).padStart(2, '0')}`;
      cards.push(card(id));
      states.push(state({ cardId: id, due: '2026-10-29' }));
    }
    for (let i = 0; i < 70; i += 1) {
      const id = `rev-${String(i).padStart(2, '0')}`;
      cards.push(card(id, 'Core moves'));
      states.push(state({
        cardId: id, reps: 2, intervalDays: 3, due: '2026-10-28',
        history: [{ at: '2026-10-27T20:00:00', grade: 2 }],
      }));
    }
    // One future-due review card is not queued at all.
    cards.push(card('future'));
    states.push(state({
      cardId: 'future', reps: 2, intervalDays: 3, due: '2026-11-15',
      history: [{ at: '2026-10-27T20:00:00', grade: 2 }],
    }));
    const queue = cardsService.reviewQueue(cards, states, '2026-10-29', { newPerDay: 10, reviewsPerDay: 60 });
    expect(queue.newCards).toHaveLength(10);
    expect(queue.reviewCards).toHaveLength(60);
    expect(queue.overdueCount).toBe(15);
    expect(queue.reviewCards.map((c) => c.id)).not.toContain('future');
    // Reviews come earliest-due first; new cards oldest first.
    expect(queue.newCards[0]?.id).toBe('new-00');
  });

  it('treats a card without a state as new, and graded-but-undue cards as not queued', async () => {
    if (cardsService === null) return;
    const cards = [card('stateless'), card('graded-undue')];
    const states = [state({
      cardId: 'graded-undue', reps: 1, intervalDays: 1, due: '2026-11-05',
      history: [{ at: '2026-10-29T20:00:00', grade: 2 }],
    })];
    const queue = cardsService.reviewQueue(cards, states, '2026-10-29', { newPerDay: 10, reviewsPerDay: 60 });
    expect(queue.newCards.map((c) => c.id)).toEqual(['stateless']);
    expect(queue.reviewCards).toHaveLength(0);
    expect(queue.overdueCount).toBe(0);
  });

  it('a new card graded once leaves the new partition', async () => {
    if (cardsService === null) return;
    const cards = [card('c1')];
    const states = [state({
      cardId: 'c1', reps: 1, intervalDays: 1, due: '2026-10-29',
      history: [{ at: '2026-10-28T20:00:00', grade: 2 }],
    })];
    const queue = cardsService.reviewQueue(cards, states, '2026-10-29', { newPerDay: 10, reviewsPerDay: 60 });
    expect(queue.newCards).toHaveLength(0);
    expect(queue.reviewCards.map((c) => c.id)).toEqual(['c1']);
  });
});
