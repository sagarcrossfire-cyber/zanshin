// P11 — performance budgets (§13.8), measured not asserted from memory:
// move search <100 ms/keystroke over 500 moves, plan generation <50 ms,
// mastery recompute over a year of history <500 ms, one IndexedDB set
// write <50 ms. Thresholds are the spec budgets; the suite runs on a slow
// VM, so each measurement repeats and takes the median.
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadMovesYoshimitsu } from '../../src/data/packs';
import { buildMoveIndex, searchMoves } from '../../src/domain/codex/search';
import { generatePlan, type PlanNode, type PlanSettings, type PlanState } from '../../src/domain/engine/plan';
import { resetDbForTests, setsRepo } from '../../src/data/repos';
import { recomputeNodeMastery } from '../../src/services/lab';
import type { Move } from '../../src/data/schemas';

beforeEach(async () => {
  await resetDbForTests();
});

afterEach(async () => {
  await resetDbForTests();
});

function median(samples: number[]): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

describe('§13.8 budgets', () => {
  it('move search stays under 100 ms per keystroke over 500 moves', () => {
    const base = loadMovesYoshimitsu();
    const moves: Move[] = [];
    for (let i = 0; i < 500; i += 1) {
      const src = base[i % base.length] as Move;
      moves.push({ ...src, id: `${src.id}#${i}` });
    }
    const index = buildMoveIndex(moves);
    expect(index).toHaveLength(500);
    const samples: number[] = [];
    for (const query of ['1', '1+', 'flash', 'b+2', 'nss', 'spin', 'heat', 'throw']) {
      const start = performance.now();
      const found = searchMoves(index, query);
      samples.push(performance.now() - start);
      expect(found.length).toBeGreaterThanOrEqual(0);
    }
    expect(median(samples)).toBeLessThan(100);
    expect(Math.max(...samples)).toBeLessThan(100);
  });

  it('plan generation stays under 50 ms', () => {
    const node = (id: string): PlanNode => ({
      nodeId: id, drillId: `d-${id}`, drillTitle: `Drill ${id}`, drillType: 'execution',
      importance: 2, stageOpen: true, masteryScore: 0.5, masteryState: 'learning',
      lastPracticedDaysAgo: 1, prerequisiteForCount: 0,
    });
    const settings: PlanSettings = { sessionMinutes: 30, weeklyMinutes: 150, preferredDays: [0, 1, 2, 3, 4, 5, 6] };
    const state: PlanState = {
      profileId: 'me', currentStageIndex: 2,
      nodes: Array.from({ length: 50 }, (_, i) => node(`n${i}`)),
      dueCards: 3, matchSets: [], sessionsCompleted: 10,
      consecutiveSessionDays: 1, weeklyMinutesUsed: 60, verifyTasks: [],
    };
    const samples: number[] = [];
    for (let i = 0; i < 9; i += 1) {
      const start = performance.now();
      const plan = generatePlan('2026-10-30', state, settings, i);
      samples.push(performance.now() - start);
      expect(plan.blocks.length).toBeGreaterThan(0);
    }
    expect(median(samples)).toBeLessThan(50);
  });

  it('mastery recompute over a year of history stays under 500 ms', async () => {
    const day = (offset: number): string => {
      const d = new Date(Date.UTC(2025, 9, 30) + offset * 86_400_000);
      return d.toISOString().slice(0, 10);
    };
    for (let i = 0; i < 365; i += 1) {
      const date = day(i);
      await setsRepo.put({
        id: `year-${i}`, sessionId: `sess-${i}`, drillId: 'd1-punish-ladder', nodeId: 'n1-punish',
        day: date, at: `${date}T18:00:00.000Z`, reps: 10, successes: 5 + (i % 5),
      });
    }
    const samples: number[] = [];
    for (let i = 0; i < 3; i += 1) {
      const start = performance.now();
      const result = await recomputeNodeMastery('n1-punish', '2026-10-30T18:00:00.000Z');
      samples.push(performance.now() - start);
      expect(result).not.toBeNull();
    }
    expect(median(samples)).toBeLessThan(500);
  });

  it('one IndexedDB set write stays under 50 ms', async () => {
    const samples: number[] = [];
    for (let i = 0; i < 5; i += 1) {
      const start = performance.now();
      await setsRepo.put({
        id: `w-${i}`, sessionId: 'sess', drillId: 'd1-punish-ladder', nodeId: 'n1-punish',
        day: '2026-10-30', at: '2026-10-30T18:00:00.000Z', reps: 10, successes: 7,
      });
      samples.push(performance.now() - start);
    }
    expect(median(samples)).toBeLessThan(50);
  });
});
