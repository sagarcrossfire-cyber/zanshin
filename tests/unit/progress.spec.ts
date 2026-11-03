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
  rankedProgressData,
  rankSeries,
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

describe('tallied filter (2.0 M2) — an untallied set changes the record, not per-game KPIs', () => {
  it('winRateSeries (record) counts an untallied set; matchKpiSeries (per-game) ignores it', () => {
    const tenTallied = Array.from({ length: 10 }, (_, i) => matchSet(`t${i}`, '2026-10-29', {
      wins: i < 5 ? 1 : 0, tallies: tallies({ missedPunishes: 2 }),
    }));
    const kpisBefore = matchKpiSeries(tenTallied);
    const recordBefore = winRateSeries(tenTallied);
    expect(kpisBefore.hiddenReason).toBeNull();
    expect(kpisBefore.windows[0]?.missedPerGame).toBeCloseTo(2);
    expect(recordBefore.points[0]?.value).toBe(50);

    // An imported set: games/wins present, zero tallies, tallied:false —
    // a win should move the record but the KPI consumer must not count it.
    const untallied: MatchSet = matchSet('ranked-1', '2026-10-30', {
      games: 1, wins: 1, tallied: false, tallies: tallies(), importRef: '1:a:b',
    });
    const withUntallied = [...tenTallied, untallied];

    const recordAfter = winRateSeries(withUntallied);
    const kpisAfter = matchKpiSeries(withUntallied);

    // Record (win rate) changed: now 6 wins of 11 games.
    expect(recordAfter.points[0]?.value).not.toBe(recordBefore.points[0]?.value);
    expect(recordAfter.points[0]?.value).toBeCloseTo((6 / 11) * 100, 1);

    // Per-game KPIs are unaffected by the untallied set (still the same 10-game window).
    expect(kpisAfter.windows).toEqual(kpisBefore.windows);
    expect(kpisAfter.finding).toBe(kpisBefore.finding);
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
    expect(data.ranked.hiddenReason).toContain('Sync ranked games from Matches');
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

describe('rankSeries (2.0 M2)', () => {
  const ranked = (overrides: Partial<MatchSet['ranked']> = {}): MatchSet['ranked'] => ({
    source: 'wank', myCharacter: 'Yoshimitsu',
    battles: [{ ref: 'r1', at: '2026-10-29T10:00:00.000Z', result: 'win' }],
    ...overrides,
  });

  it('orders points from every battle across sets by time, oldest first', () => {
    const sets: MatchSet[] = [
      matchSet('m2', '2026-10-30', {
        ranked: ranked({ battles: [{ ref: 'r3', at: '2026-10-30T10:00:00.000Z', result: 'win', myRank: 'Garyu', myRankIndex: 15 }] }),
      }),
      matchSet('m1', '2026-10-29', {
        ranked: ranked({
          battles: [
            { ref: 'r2', at: '2026-10-29T12:00:00.000Z', result: 'loss', myRank: 'Eliminator', myRankIndex: 14 },
            { ref: 'r1', at: '2026-10-29T10:00:00.000Z', result: 'win', myRank: 'Destroyer', myRankIndex: 13 },
          ],
        }),
      }),
    ];
    const series = rankSeries(sets);
    expect(series.map((p) => p.at)).toEqual([
      '2026-10-29T10:00:00.000Z', '2026-10-29T12:00:00.000Z', '2026-10-30T10:00:00.000Z',
    ]);
    expect(series.map((p) => p.rank)).toEqual(['Destroyer', 'Eliminator', 'Garyu']);
  });

  it('omits rank/rating fields a battle does not carry, and skips non-ranked sets', () => {
    const sets: MatchSet[] = [
      matchSet('m1', '2026-10-29', { mode: 'player', ranked: undefined }),
      matchSet('m2', '2026-10-29', {
        ranked: ranked({ battles: [{ ref: 'r1', at: '2026-10-29T10:00:00.000Z', result: 'win' }] }),
      }),
    ];
    const series = rankSeries(sets);
    expect(series).toHaveLength(1);
    expect(series[0]?.rankIndex).toBeUndefined();
    expect(series[0]?.rank).toBeUndefined();
    expect(series[0]?.rating).toBeUndefined();
  });

  it('computes rating as ratingBefore + ratingChange only when both are present', () => {
    const sets: MatchSet[] = [
      matchSet('m1', '2026-10-29', {
        ranked: ranked({
          battles: [
            { ref: 'r1', at: '2026-10-29T10:00:00.000Z', result: 'win', ratingBefore: 1500, ratingChange: 24 },
            { ref: 'r2', at: '2026-10-29T11:00:00.000Z', result: 'loss', ratingBefore: 1524 },
          ],
        }),
      }),
    ];
    const series = rankSeries(sets);
    expect(series[0]?.rating).toBe(1524);
    expect(series[1]?.rating).toBeUndefined();
  });
});

describe('rankedProgressData (2.0 M2)', () => {
  const battle = (overrides: Partial<MatchSet> = {}) => matchSet('r1', '2026-10-29', {
    ranked: {
      source: 'wank', myCharacter: 'Yoshimitsu',
      battles: [{ ref: 'b1', at: '2026-10-29T10:00:00.000Z', result: 'win', myRank: 'Eliminator', myRankIndex: 14, ratingBefore: 1500, ratingChange: 20 }],
    },
    ...overrides,
  });

  it('shows the empty state with no synced ranked games', () => {
    const data = rankedProgressData([], null);
    expect(data.hiddenReason).toBe('Sync ranked games from Matches to see your climb.');
    expect(data.currentRank).toBeNull();
    expect(data.bandLine).toBeNull();
  });

  it('reports the latest synced rank, band line and comparison', () => {
    const sets = [
      battle(),
      matchSet('r2', '2026-10-30', {
        ranked: {
          source: 'wank', myCharacter: 'Yoshimitsu',
          battles: [{ ref: 'b2', at: '2026-10-30T10:00:00.000Z', result: 'win', myRank: 'Garyu', myRankIndex: 15, ratingBefore: 1520, ratingChange: 24 }],
        },
      }),
    ];
    const data = rankedProgressData(sets, 2); // Garyu (band stages 4-5) vs Path stage 2 -> behind
    expect(data.hiddenReason).toBeNull();
    expect(data.currentRank).toBe('Garyu');
    expect(data.currentRankIndex).toBe(15);
    expect(data.bandLine).toContain('Garyu');
    expect(data.bandLine).toContain('Path Stage 4–5');
    expect(data.bandLine).toContain("You're on Stage 2");
    expect(data.bandLine).toContain('behind the typical pace');
    expect(data.rankChart.hiddenReason).toBeNull();
    expect(data.rankChart.finding).toContain('Eliminator to Garyu');
    expect(data.ratingChart.hiddenReason).toBeNull();
    expect(data.ratingChart.finding).toBe('Rating from 1520 to 1544.');
  });

  it('hides the rating chart but keeps the rank chart when no battle has ratings', () => {
    const sets = [matchSet('r1', '2026-10-29', {
      ranked: {
        source: 'wank', myCharacter: 'Yoshimitsu',
        battles: [{ ref: 'b1', at: '2026-10-29T10:00:00.000Z', result: 'win', myRank: 'Eliminator', myRankIndex: 14 }],
      },
    })];
    const data = rankedProgressData(sets, null);
    expect(data.rankChart.hiddenReason).toBeNull();
    expect(data.ratingChart.hiddenReason).toContain('No rating is recorded');
  });
});
