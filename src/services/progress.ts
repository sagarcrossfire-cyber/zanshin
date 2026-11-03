// Progress charts — spec §5.13. Pure builders over plain inputs (unit-tested,
// AC-PROG-2/3) plus a repo assembler. Rules: bars start at zero, no dual
// axes, sample size always shown, a chart without enough data is hidden with
// the reason stated. Minimum samples: 10 games, 3 sets.
import { format, startOfWeek, addDays } from 'date-fns';
import { assessmentsRepo } from '../data/repos/errors';
import { masteryRepo } from '../data/repos/mastery';
import { matchSetsRepo } from '../data/repos/matchSets';
import { sessionsRepo } from '../data/repos/sessions';
import { setsRepo } from '../data/repos/sets';
import type { Assessment, DrillSet, Mastery, MatchSet, Session } from '../data/schemas';
import { loadCurriculum } from '../data/packs';
import { talliedOnly } from '../domain/engine/tallied';
import { bandFor, compareToPath } from '../domain/ranked/milestones';
import { syncStageStatuses } from './stages';

export const MIN_GAMES = 10;
export const MIN_SETS = 3;

export interface ChartPoint {
  label: string;
  value: number;
  sample: string;
}

export interface ChartData {
  points: ChartPoint[];
  finding: string;
  hiddenReason: string | null;
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function sessionMinutes(session: Session): number {
  if (session.endedAt === undefined) return session.plannedMinutes;
  const elapsed = (Date.parse(session.endedAt) - Date.parse(session.startedAt) - session.pausedMs) / 60000;
  if (!Number.isFinite(elapsed) || elapsed <= 0) return session.plannedMinutes;
  return Math.round(elapsed);
}

/** Mastery index: mean current score of the nodes practiced each day. */
export function masteryIndexSeries(rows: Pick<Mastery, 'score' | 'evidenceDays'>[]): ChartData {
  const byDay = new Map<string, number[]>();
  for (const row of rows) {
    for (const day of row.evidenceDays) {
      const list = byDay.get(day) ?? [];
      list.push(row.score);
      byDay.set(day, list);
    }
  }
  const days = [...byDay.keys()].sort();
  if (days.length === 0) {
    return { points: [], finding: '', hiddenReason: 'No practice days yet. The index starts with your first logged set.' };
  }
  const points = days.map((day) => {
    const scores = byDay.get(day) ?? [];
    return { label: day.slice(5), value: mean(scores), sample: `${scores.length} node${scores.length === 1 ? '' : 's'}` };
  });
  const latest = points[points.length - 1] as ChartPoint;
  return {
    points,
    finding: `Mastery index ${latest.value.toFixed(2)} across ${latest.sample} practiced on the latest day (current scores).`,
    hiddenReason: null,
  };
}

/** Drill success by ISO week (Monday start); weeks with <3 sets are omitted. */
export function drillSuccessSeries(
  sets: Pick<DrillSet, 'drillId' | 'day' | 'reps' | 'successes'>[],
  drillTitle: (drillId: string) => string,
  focusDrillIds: string[],
): ChartData {
  const byWeek = new Map<string, { successes: number; reps: number; sets: number }>();
  for (const set of sets) {
    if (!focusDrillIds.includes(set.drillId)) continue;
    const week = format(startOfWeek(new Date(`${set.day}T12:00:00`), { weekStartsOn: 1 }), 'yyyy-MM-dd');
    const agg = byWeek.get(week) ?? { successes: 0, reps: 0, sets: 0 };
    agg.successes += set.successes;
    agg.reps += set.reps;
    agg.sets += 1;
    byWeek.set(week, agg);
  }
  const weeks = [...byWeek.entries()]
    .filter(([, agg]) => agg.sets >= MIN_SETS)
    .sort(([a], [b]) => (a < b ? -1 : 1));
  if (weeks.length === 0) {
    return {
      points: [],
      finding: '',
      hiddenReason: `No drill has ${MIN_SETS} or more sets yet. Success rates appear once a focus drill reaches ${MIN_SETS} sets.`,
    };
  }
  const points = weeks.map(([week, agg]) => ({
    label: week.slice(5),
    value: agg.reps === 0 ? 0 : agg.successes / agg.reps,
    sample: `${agg.sets} sets`,
  }));
  const latest = points[points.length - 1] as ChartPoint;
  const titles = focusDrillIds.map(drillTitle).join(', ');
  return {
    points,
    finding: `Drill success ${Math.round(latest.value * 100)}% in the latest week (${latest.sample}) across ${titles}.`,
    hiddenReason: null,
  };
}

/** Cumulative punish-quiz accuracy over assessments; shown from 10 questions. */
export function punishQuizSeries(assessments: Assessment[]): ChartData {
  const sorted = [...assessments].sort((a, b) => (a.at < b.at ? -1 : 1));
  let correct = 0;
  let total = 0;
  const points: ChartPoint[] = [];
  for (const assessment of sorted) {
    const c = assessment.results.punishQuizCorrect ?? 0;
    const t = assessment.results.punishQuizTotal ?? 0;
    if (t <= 0) continue;
    correct += c;
    total += t;
    points.push({
      label: assessment.at.slice(0, 10).slice(5),
      value: total === 0 ? 0 : correct / total,
      sample: `${total} questions`,
    });
  }
  if (total < MIN_GAMES) {
    return {
      points: [],
      finding: '',
      hiddenReason: `Punish quiz accuracy appears after ${MIN_GAMES} quiz questions (${total} so far).`,
    };
  }
  const latest = points[points.length - 1] as ChartPoint;
  return {
    points,
    finding: `Punish quiz accuracy ${Math.round(latest.value * 100)}% over ${latest.sample} (cumulative).`,
    hiddenReason: null,
  };
}

export interface KpiWindowPoint extends ChartPoint {
  missedPerGame: number;
  throwBreakRate: number | null;
  hitWhileMinusPerGame: number;
  lowsBlockedRate: number | null;
}

/** Rolling 10-game windows, stepped by set boundary (newest window last). */
export function matchKpiSeries(sets: MatchSet[]): ChartData & { windows: KpiWindowPoint[] } {
  const ordered = talliedOnly(sets).sort((a, b) => (a.at < b.at ? -1 : 1));
  const windows: KpiWindowPoint[] = [];
  for (let end = 0; end < ordered.length; end += 1) {
    let games = 0;
    let missed = 0;
    let broken = 0;
    let throws = 0;
    let hitMinus = 0;
    let lowsBlocked = 0;
    let lows = 0;
    for (let i = end; i >= 0 && games < MIN_GAMES; i -= 1) {
      const set = ordered[i] as MatchSet;
      games += set.games;
      missed += set.tallies.missedPunishes;
      broken += set.tallies.throwsBroken;
      throws += set.tallies.throwsBroken + set.tallies.throwsMissed;
      hitMinus += set.tallies.hitWhileMinus;
      lowsBlocked += set.tallies.lowsBlocked;
      lows += set.tallies.lowsBlocked + set.tallies.lowsEaten;
    }
    if (games < MIN_GAMES) continue;
    windows.push({
      label: (ordered[end] as MatchSet).day.slice(5),
      value: missed / games,
      sample: `${games} games`,
      missedPerGame: missed / games,
      throwBreakRate: throws === 0 ? null : broken / throws,
      hitWhileMinusPerGame: hitMinus / games,
      lowsBlockedRate: lows === 0 ? null : lowsBlocked / lows,
    });
  }
  if (windows.length === 0) {
    return {
      points: [],
      windows: [],
      finding: '',
      hiddenReason: `Match KPIs need ${MIN_GAMES} games logged (${ordered.reduce((s, x) => s + x.games, 0)} so far).`,
    };
  }
  const latest = windows[windows.length - 1] as KpiWindowPoint;
  return {
    points: windows.map((w) => ({ label: w.label, value: w.value, sample: w.sample })),
    windows,
    finding: `Last 10 games: ${latest.missedPerGame.toFixed(1)} missed punishes per game, ${latest.throwBreakRate === null ? 'no throws faced' : `${Math.round(latest.throwBreakRate * 100)}% throws broken`}.`,
    hiddenReason: null,
  };
}

/** Win rate by character; characters under 10 games are listed, not charted. */
export function winRateSeries(sets: MatchSet[]): ChartData & { belowMinimum: { character: string; games: number }[] } {
  const byCharacter = new Map<string, { games: number; wins: number }>();
  for (const set of sets) {
    const agg = byCharacter.get(set.opponentCharacter) ?? { games: 0, wins: 0 };
    agg.games += set.games;
    agg.wins += set.wins;
    byCharacter.set(set.opponentCharacter, agg);
  }
  const belowMinimum = [...byCharacter.entries()]
    .filter(([, agg]) => agg.games < MIN_GAMES)
    .map(([character, agg]) => ({ character, games: agg.games }))
    .sort((a, b) => a.character.localeCompare(b.character));
  const points = [...byCharacter.entries()]
    .filter(([, agg]) => agg.games >= MIN_GAMES)
    .map(([character, agg]) => ({
      label: character,
      value: agg.games === 0 ? 0 : (agg.wins / agg.games) * 100,
      sample: `${agg.games} games`,
    }))
    .sort((a, b) => b.value - a.value);
  if (points.length === 0) {
    return {
      points: [],
      belowMinimum,
      finding: '',
      hiddenReason: `Win rate by character needs ${MIN_GAMES} games against one character.`,
    };
  }
  const best = points[0] as ChartPoint;
  return {
    points,
    belowMinimum,
    finding: `Best win rate: ${best.label} ${Math.round(best.value)}% over ${best.sample}.`,
    hiddenReason: null,
  };
}

/** Minutes practiced per ISO week against the weekly budget. */
export function minutesSeries(sessions: Session[], weeklyMinutes: number): ChartData {
  const byWeek = new Map<string, number>();
  for (const session of sessions) {
    if (session.status !== 'done') continue;
    const week = format(startOfWeek(new Date(session.startedAt), { weekStartsOn: 1 }), 'yyyy-MM-dd');
    byWeek.set(week, (byWeek.get(week) ?? 0) + sessionMinutes(session));
  }
  const weeks = [...byWeek.entries()].sort(([a], [b]) => (a < b ? -1 : 1));
  if (weeks.length === 0) {
    return { points: [], finding: '', hiddenReason: 'No finished sessions yet. Minutes appear after your first Lab session.' };
  }
  const points = weeks.map(([week, minutes]) => ({
    label: week.slice(5),
    value: minutes,
    sample: `${minutes} min`,
  }));
  const latest = points[points.length - 1] as ChartPoint;
  return {
    points,
    finding: `Latest week: ${latest.value} of ${weeklyMinutes} budgeted minutes practiced.`,
    hiddenReason: null,
  };
}

export interface CalendarDay {
  day: string;
  minutes: number;
  practiced: boolean;
}

/** Last 8 weeks of practice days (no streak language, §7.8). */
export function consistencyCalendar(
  sessions: Session[],
  sets: Pick<DrillSet, 'day'>[],
  todayIso: string,
): { days: CalendarDay[]; practicedDays: number; totalDays: number; finding: string } {
  const minutesByDay = new Map<string, number>();
  for (const session of sessions) {
    if (session.status !== 'done') continue;
    const day = session.startedAt.slice(0, 10);
    minutesByDay.set(day, (minutesByDay.get(day) ?? 0) + sessionMinutes(session));
  }
  const setDays = new Set(sets.map((s) => s.day));
  const days: CalendarDay[] = [];
  const today = new Date(`${todayIso}T12:00:00`);
  for (let i = 55; i >= 0; i -= 1) {
    const date = addDays(today, -i);
    const day = format(date, 'yyyy-MM-dd');
    const minutes = minutesByDay.get(day) ?? 0;
    days.push({ day, minutes, practiced: minutes > 0 || setDays.has(day) });
  }
  const practicedDays = days.filter((d) => d.practiced).length;
  return {
    days,
    practicedDays,
    totalDays: days.length,
    finding: `Practiced on ${practicedDays} of the last ${days.length} days.`,
  };
}

export interface RankPoint {
  at: string;
  rankIndex?: number;
  rank?: string;
  rating?: number;
}

/** Every synced ranked battle as a rank/rating point, oldest first.
 * rating = ratingBefore + ratingChange when both are present (2.0 M2). */
export function rankSeries(sets: MatchSet[]): RankPoint[] {
  const points: RankPoint[] = [];
  for (const set of sets) {
    if (!set.ranked) continue;
    for (const battle of set.ranked.battles) {
      const point: RankPoint = { at: battle.at };
      if (battle.myRankIndex !== undefined) point.rankIndex = battle.myRankIndex;
      if (battle.myRank !== undefined) point.rank = battle.myRank;
      if (battle.ratingBefore !== undefined && battle.ratingChange !== undefined) {
        point.rating = battle.ratingBefore + battle.ratingChange;
      }
      points.push(point);
    }
  }
  return points.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
}

export interface RankedProgress {
  hiddenReason: string | null;
  currentRank: string | null;
  currentRankIndex: number | null;
  bandLine: string | null;
  rankChart: ChartData;
  ratingChart: ChartData;
}

const NO_SYNC_REASON = 'Sync ranked games from Matches to see your climb.';

/** The Ranked card's data: current rank, the rank band vs. the Path stage
 * (coach-intel.md §1.5), and the two climb charts. currentStage is the
 * first not-passed Path stage, or null before any stage status exists. */
export function rankedProgressData(sets: MatchSet[], currentStage: number | null): RankedProgress {
  const series = rankSeries(sets);
  if (series.length === 0) {
    return {
      hiddenReason: NO_SYNC_REASON,
      currentRank: null,
      currentRankIndex: null,
      bandLine: null,
      rankChart: { points: [], finding: '', hiddenReason: NO_SYNC_REASON },
      ratingChart: { points: [], finding: '', hiddenReason: NO_SYNC_REASON },
    };
  }

  const withRank = series.filter(
    (p): p is RankPoint & { rankIndex: number; rank: string } => p.rankIndex !== undefined && p.rank !== undefined,
  );
  const withRating = series.filter((p): p is RankPoint & { rating: number } => p.rating !== undefined);

  const firstRank = withRank[0] ?? null;
  const latestRank = withRank[withRank.length - 1] ?? null;
  const currentRank = latestRank?.rank ?? null;
  const currentRankIndex = latestRank?.rankIndex ?? null;

  let bandLine: string | null = null;
  const band = bandFor(currentRankIndex);
  if (band) {
    const [lo, hi] = band.stages;
    const stageText = currentStage === null ? 'not yet known' : `Stage ${currentStage}`;
    const comparison = compareToPath(currentRankIndex, currentStage);
    const comparisonText = comparison === 'ahead'
      ? " — you're ahead of the typical pace for this rank."
      : comparison === 'behind'
        ? " — you're behind the typical pace for this rank."
        : comparison === 'on-track'
          ? ' — on track.'
          : '';
    bandLine = `${band.label}: players here usually work on Path Stage ${lo}\u2013${hi}. You're on ${stageText}${comparisonText}`;
  }

  const rankChart: ChartData = withRank.length === 0
    ? { points: [], finding: '', hiddenReason: 'No rank is recorded in the synced games yet.' }
    : {
        points: withRank.map((p) => ({ label: p.at.slice(5, 10), value: p.rankIndex, sample: p.rank })),
        finding: firstRank && latestRank
          ? `Rank from ${firstRank.rank} to ${latestRank.rank}${
              latestRank.rankIndex === firstRank.rankIndex
                ? ' (no change)'
                : latestRank.rankIndex > firstRank.rankIndex
                  ? `, up ${latestRank.rankIndex - firstRank.rankIndex}`
                  : `, down ${firstRank.rankIndex - latestRank.rankIndex}`
            }.`
          : '',
        hiddenReason: null,
      };

  const ratingChart: ChartData = withRating.length === 0
    ? { points: [], finding: '', hiddenReason: 'No rating is recorded in the synced games yet.' }
    : {
        points: withRating.map((p) => ({ label: p.at.slice(5, 10), value: p.rating, sample: `${p.rating}` })),
        finding: `Rating from ${withRating[0]?.rating} to ${withRating[withRating.length - 1]?.rating}.`,
        hiddenReason: null,
      };

  return { hiddenReason: null, currentRank, currentRankIndex, bandLine, rankChart, ratingChart };
}

export interface ProgressData {
  mastery: ChartData;
  drills: ChartData;
  quiz: ChartData;
  kpis: ChartData & { windows: KpiWindowPoint[] };
  winRate: ChartData & { belowMinimum: { character: string; games: number }[] };
  minutes: ChartData;
  calendar: { days: CalendarDay[]; practicedDays: number; totalDays: number; finding: string };
  ranked: RankedProgress;
}

export async function loadProgressData(profile: { weeklyMinutes: number }, today: string): Promise<ProgressData> {
  const [masteryRows, sets, assessments, matchSets, sessions, stageViews] = await Promise.all([
    masteryRepo.all(),
    setsRepo.all(),
    assessmentsRepo.all(),
    matchSetsRepo.all(),
    sessionsRepo.all(),
    syncStageStatuses(),
  ]);
  const curriculum = loadCurriculum();
  const drillTitleById = new Map(curriculum.drills.map((d) => [d.id, d.title]));
  const drillCounts = new Map<string, number>();
  for (const set of sets) drillCounts.set(set.drillId, (drillCounts.get(set.drillId) ?? 0) + 1);
  const focusDrillIds = [...drillCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([id]) => id);
  const firstOpenIndex = stageViews.findIndex((view) => view.state !== 'passed');
  const currentStage = stageViews.length === 0
    ? null
    : firstOpenIndex === -1 ? stageViews.length - 1 : firstOpenIndex;
  return {
    mastery: masteryIndexSeries(masteryRows),
    drills: drillSuccessSeries(sets, (id) => drillTitleById.get(id) ?? id, focusDrillIds),
    quiz: punishQuizSeries(assessments),
    kpis: matchKpiSeries(matchSets),
    winRate: winRateSeries(matchSets),
    minutes: minutesSeries(sessions, profile.weeklyMinutes),
    calendar: consistencyCalendar(sessions, sets, today),
    ranked: rankedProgressData(matchSets, currentStage),
  };
}
