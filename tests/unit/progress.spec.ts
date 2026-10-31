// P10 — Progress charts (§5.13): finding sentences match crafted data
// (AC-PROG-2), minimum-sample rules hide charts with the reason stated
// (AC-PROG-3), and the empty-DB assembler never crashes (AC-PROG-1).
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  consistencyCalendar,
  drillSuccessSeries,
  loadProgressData,
  masteryIndexSeries,
  matchKpiSeries,
  minutesSeries,
  punishQuizSeries,
  winRateSeries,
} from '../../src/services/progress';
import {
  assessmentsRepo,
  masteryRepo,
  matchSetsRepo,
  resetDbForTests,
  sessionsRepo,
  setsRepo,
} from '../../src/data/repos';
import type { Assessment, DrillSet, Mastery, MatchSet, Session } from '../../src/data/schemas';

beforeEach(async () => {
  await resetDbForTests();
});

afterEach(async () => {
  await resetDbForTests();
});

const tallies = (overrides: Partial<MatchSet['tallies']> = {}): MatchSet['tallies'] => ({
  missedPunishes: 0, flashHit: 0, flashBlocked: 0, flashWhiffed: 0,
  spinEscaped: 0, spinPunished: 0, throwsBroken: 0, throwsMissed: 0,
  hitWhileMinus: 0, lowsBlocked: 0, lowsEaten: 0,
  heatConverted: 0, heatWasted: 0, okiConverted: 0,
  ...overrides,
});

const matchSet = (id: string, day: string, overrides: Partial<MatchSet> = {}): MatchSet => ({
  id, day, at: `${day}T20:00:00.000Z`, opponentCharacter: 'Kazuya',
  games: 1, wins: 0, tallies: tallies(), mode: 'ranked', beatBy: [], tags: [],
  ...overrides,
});

const masteryRow = (nodeId: string, score: number, evidenceDays: string[]): Mastery => ({
  nodeId, K: null, E: null, A: null, score, state: 'practicing', placed: false,
  evidenceDays, updatedAt: '2026-10-29T10:00:00.000Z',
});

const drillSet = (id: string, drillId: string, day: string, reps: number, successes: number): DrillSet => ({
  id, drillId, nodeId: 'n1-punish', at: `${day}T20:00:00.000Z`, day, reps, successes,
});

const doneSession = (id: string, startedAt: string, endedAt: string, plannedMinutes: number): Session => ({
  id, kind: 'plan', startedAt, endedAt, status: 'done', plannedMinutes,
  blocks: [], currentBlock: 0, pausedMs: 0,
});

describe('mastery index (AC-PROG-2)', () => {
  it('hides with a reason when there are no practice days', () => {
    const data = masteryIndexSeries([]);
    expect(data.points).toEqual([]);
    expect(data.hiddenReason).toContain('No practice days yet');
  });

  it('plots the mean current score per practiced day with a finding', () => {
    const data = masteryIndexSeries([
      masteryRow('n1', 80, ['2026-10-28', '2026-10-29']),
      masteryRow('n2', 60, ['2026-10-29']),
    ]);
    expect(data.hiddenReason).toBeNull();
    expect(data.points).toEqual([
      { label: '10-28', value: 80, sample: '1 node' },
      { label: '10-29', value: 70, sample: '2 nodes' },
    ]);
    expect(data.finding).toBe('Mastery index 70.00 across 2 nodes practiced on the latest day (current scores).');
  });
});

describe('drill success (AC-PROG-3)', () => {
  it('hides below 3 sets and omits thin weeks', () => {
    const two = drillSuccessSeries(
      [drillSet('s1', 'd1', '2026-10-26', 10, 6), drillSet('s2', 'd1', '2026-10-27', 10, 7)],
      () => 'Punish ladder', ['d1'],
    );
    expect(two.hiddenReason).toContain('3 or more sets');
    const thinWeek = drillSuccessSeries(
      [
        drillSet('s1', 'd1', '2026-10-26', 10, 6),
        drillSet('s2', 'd1', '2026-10-27', 10, 7),
        drillSet('s3', 'd1', '2026-10-28', 10, 8),
        drillSet('s4', 'd1', '2026-11-02', 10, 5),
        drillSet('s5', 'd1', '2026-11-03', 10, 5),
      ],
      () => 'Punish ladder', ['d1'],
    );
    expect(thinWeek.points).toHaveLength(1);
    expect(thinWeek.points[0]?.value).toBeCloseTo(0.7);
    expect(thinWeek.finding).toBe('Drill success 70% in the latest week (3 sets) across Punish ladder.');
  });
});

describe('punish quiz (AC-PROG-2/3)', () => {
  const assessment = (id: string, at: string, correct: number, total: number): Assessment => ({
    id, at, results: { punishQuizCorrect: correct, punishQuizTotal: total }, placementStage: 0,
  });

  it('hides below 10 questions and shows cumulative accuracy from 10', () => {
    const nine = punishQuizSeries([assessment('a1', '2026-10-28T10:00:00.000Z', 6, 9)]);
    expect(nine.hiddenReason).toContain('10 quiz questions (9 so far)');
    const ten = punishQuizSeries([
      assessment('a1', '2026-10-28T10:00:00.000Z', 6, 9),
      assessment('a2', '2026-10-29T10:00:00.000Z', 1, 1),
    ]);
    expect(ten.hiddenReason).toBeNull();
    expect(ten.points).toHaveLength(2);
    expect(ten.points[1]?.value).toBeCloseTo(0.7);
    expect(ten.finding).toBe('Punish quiz accuracy 70% over 10 questions (cumulative).');
  });
});

describe('match KPIs (AC-PROG-2/3)', () => {
  it('hides at 9 games and shows the rolling window at 10', () => {
    const nine = Array.from({ length: 9 }, (_, i) => matchSet(`m${i}`, '2026-10-29', {
      tallies: tallies({ missedPunishes: 3 }),
    }));
    const hidden = matchKpiSeries(nine);
    expect(hidden.hiddenReason).toContain('10 games logged (9 so far)');
    const ten = [...nine, matchSet('m9', '2026-10-29', { tallies: tallies({ missedPunishes: 0 }) })];
    const shown = matchKpiSeries(ten);
    expect(shown.hiddenReason).toBeNull();
    expect(shown.windows).toHaveLength(1);
    expect(shown.windows[0]?.missedPerGame).toBeCloseTo(2.7);
    expect(shown.finding).toContain('2.7 missed punishes per game');
    expect(shown.finding).toContain('no throws faced');
  });

  it('reports the throw-break rate when throws were faced', () => {
    const sets = Array.from({ length: 10 }, (_, i) => matchSet(`m${i}`, '2026-10-29', {
      tallies: tallies({ throwsBroken: 3, throwsMissed: 1 }),
    }));
    const shown = matchKpiSeries(sets);
    expect(shown.finding).toContain('75% throws broken');
  });
});

describe('win rate (AC-PROG-3)', () => {
  it('lists below-minimum characters instead of charting them', () => {
    const sets = Array.from({ length: 9 }, (_, i) => matchSet(`m${i}`, '2026-10-29', { wins: 1 }));
    const data = winRateSeries(sets);
    expect(data.points).toEqual([]);
    expect(data.belowMinimum).toEqual([{ character: 'Kazuya', games: 9 }]);
    expect(data.hiddenReason).toContain('10 games against one character');
  });

  it('charts characters at 10 games with the best first', () => {
    const sets = [
      ...Array.from({ length: 10 }, (_, i) => matchSet(`k${i}`, '2026-10-29', { wins: i < 6 ? 1 : 0 })),
      ...Array.from({ length: 10 }, (_, i) => matchSet(`j${i}`, '2026-10-29', {
        opponentCharacter: 'Jin', wins: i < 3 ? 1 : 0,
      })),
    ];
    const data = winRateSeries(sets);
    expect(data.points.map((p) => p.label)).toEqual(['Kazuya', 'Jin']);
    expect(data.points[0]?.value).toBe(60);
    expect(data.finding).toBe('Best win rate: Kazuya 60% over 10 games.');
  });
});

describe('minutes + calendar (AC-PROG-1/2)', () => {
  it('hides minutes with no finished sessions and reports the budget after one', () => {
    expect(minutesSeries([], 300).hiddenReason).toContain('No finished sessions yet');
    const data = minutesSeries(
      [doneSession('s1', '2026-10-27T19:00:00.000Z', '2026-10-27T19:30:00.000Z', 30)],
      300,
    );
    expect(data.points).toEqual([{ label: '10-26', value: 30, sample: '30 min' }]);
    expect(data.finding).toBe('Latest week: 30 of 300 budgeted minutes practiced.');
  });

  it('builds a 56-day calendar with no streak language', () => {
    const calendar = consistencyCalendar(
      [doneSession('s1', '2026-10-29T19:00:00.000Z', '2026-10-29T19:30:00.000Z', 30)],
      [drillSet('s1', 'd1', '2026-10-28', 10, 5)],
      '2026-10-29',
    );
    expect(calendar.days).toHaveLength(56);
    expect(calendar.days[55]?.day).toBe('2026-10-29');
    expect(calendar.practicedDays).toBe(2);
    expect(calendar.finding).toBe('Practiced on 2 of the last 56 days.');
    expect(calendar.finding.toLowerCase()).not.toContain('streak');
  });
});

describe('loadProgressData (AC-PROG-1)', () => {
  it('returns every chart hidden with reasons on an empty DB, without crashing', async () => {
    const data = await loadProgressData({ weeklyMinutes: 300 }, '2026-10-29');
    expect(data.mastery.hiddenReason).not.toBeNull();
    expect(data.drills.hiddenReason).not.toBeNull();
    expect(data.quiz.hiddenReason).not.toBeNull();
    expect(data.kpis.hiddenReason).not.toBeNull();
    expect(data.winRate.hiddenReason).not.toBeNull();
    expect(data.minutes.hiddenReason).not.toBeNull();
    expect(data.calendar.days).toHaveLength(56);
    expect(data.rankHiddenReason).toContain('Rank history is not recorded yet');
  });

  it('wires seeded rows through every builder', async () => {
    await masteryRepo.put(masteryRow('n1', 80, ['2026-10-29']));
    await setsRepo.put(drillSet('s1', 'd1', '2026-10-26', 10, 6));
    await setsRepo.put(drillSet('s2', 'd1', '2026-10-27', 10, 8));
    await setsRepo.put(drillSet('s3', 'd1', '2026-10-28', 10, 7));
    await assessmentsRepo.put({
      id: 'a1', at: '2026-10-29T10:00:00.000Z',
      results: { punishQuizCorrect: 8, punishQuizTotal: 10 }, placementStage: 0,
    });
    for (let i = 0; i < 10; i += 1) {
      await matchSetsRepo.put(matchSet(`m${i}`, '2026-10-29', {
        tallies: tallies({ missedPunishes: 2 }), wins: i < 5 ? 1 : 0,
      }));
    }
    await sessionsRepo.put(doneSession('s1', '2026-10-27T19:00:00.000Z', '2026-10-27T19:30:00.000Z', 30));
    const data = await loadProgressData({ weeklyMinutes: 300 }, '2026-10-29');
    expect(data.mastery.hiddenReason).toBeNull();
    expect(data.drills.hiddenReason).toBeNull();
    expect(data.quiz.hiddenReason).toBeNull();
    expect(data.kpis.hiddenReason).toBeNull();
    expect(data.winRate.hiddenReason).toBeNull();
    expect(data.minutes.hiddenReason).toBeNull();
    expect(data.kpis.windows).toHaveLength(1);
  });
});
