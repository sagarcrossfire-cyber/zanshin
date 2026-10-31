// Spec §7.8 (consistency, not streaks) and §5.13 (finding sentences, KPI rollups).

import type { WeaknessMatchSet, WeaknessTallies } from './weakness';

export interface WeekSession {
  minutes: number;
}

export interface WeeklyConsistency {
  sessionsDone: number;
  sessionsPlanned: number;
  minutes: number;
  minutesPlanned: number;
  /** Null when the plan is zero, so no ratio is invented. */
  sessionsRatio: number | null;
  minutesRatio: number | null;
}

/** Sessions per week against plan and minutes against budget. No streaks. */
export function weeklyConsistency(
  sessions: WeekSession[],
  plannedSessions: number,
  plannedMinutes: number,
): WeeklyConsistency {
  const minutes = sessions.reduce((sum, session) => sum + session.minutes, 0);
  return {
    sessionsDone: sessions.length,
    sessionsPlanned: plannedSessions,
    minutes,
    minutesPlanned: plannedMinutes,
    sessionsRatio: plannedSessions > 0 ? sessions.length / plannedSessions : null,
    minutesRatio: plannedMinutes > 0 ? minutes / plannedMinutes : null,
  };
}

export interface RollingWindow {
  /** Index of the window (0 = earliest set included). */
  index: number;
  day?: string;
  games: number;
  missedPunishesPerGame: number;
  panicSuccess: number | null;
  throwBreakRate: number | null;
  lowsBlocked: number | null;
}

function zeroTallies(): WeaknessTallies {
  return {
    missedPunishes: 0, flashHit: 0, flashBlocked: 0, flashWhiffed: 0,
    spinEscaped: 0, spinPunished: 0, throwsBroken: 0, throwsMissed: 0,
    hitWhileMinus: 0, lowsBlocked: 0, lowsEaten: 0, heatConverted: 0,
    heatWasted: 0, okiConverted: 0,
  };
}

/**
 * KPI rollups over rolling 10-game windows: for each logged set, in
 * chronological order, the KPIs over the last 10 games ending at that set
 * (the oldest set in the window contributes proportionally). Rate values are
 * null below their §7.4 minimum samples (5 attempts / throws / lows).
 */
export function kpiRollups(matchSets: WeaknessMatchSet[], windowGames = 10): RollingWindow[] {
  const ordered = [...matchSets];
  const allStamped = ordered.length > 0 && ordered.every((set) => set.at !== undefined || set.day !== undefined);
  if (allStamped) {
    ordered.sort((a, b) => {
      const aKey = a.at ?? a.day ?? '';
      const bKey = b.at ?? b.day ?? '';
      return aKey < bKey ? -1 : aKey > bKey ? 1 : 0;
    });
  }
  const windows: RollingWindow[] = [];
  for (let end = 0; end < ordered.length; end += 1) {
    const tallies = zeroTallies();
    let games = 0;
    for (let i = end; i >= 0 && games < windowGames; i -= 1) {
      const set = ordered[i];
      if (set === undefined || set.games <= 0) continue;
      const take = Math.min(set.games, windowGames - games);
      const fraction = take / set.games;
      (Object.keys(tallies) as (keyof WeaknessTallies)[]).forEach((key) => {
        tallies[key] += set.tallies[key] * fraction;
      });
      games += take;
    }
    const attempts = tallies.flashHit + tallies.flashBlocked + tallies.flashWhiffed + tallies.spinEscaped + tallies.spinPunished;
    const throws = tallies.throwsBroken + tallies.throwsMissed;
    const lows = tallies.lowsBlocked + tallies.lowsEaten;
    windows.push({
      index: end,
      ...(ordered[end]?.day !== undefined ? { day: ordered[end]?.day as string } : {}),
      games,
      missedPunishesPerGame: games === 0 ? 0 : tallies.missedPunishes / games,
      panicSuccess: attempts >= 5 ? (tallies.flashHit + tallies.spinEscaped) / attempts : null,
      throwBreakRate: throws >= 5 ? tallies.throwsBroken / throws : null,
      lowsBlocked: lows >= 5 ? tallies.lowsBlocked / lows : null,
    });
  }
  return windows;
}

export type FindingFormat = 'rate' | 'perGame' | 'percent' | 'minutes' | 'count';

export interface FindingSeries {
  /** Chart label, e.g. "Missed punishes per game". Starts the sentence. */
  metricLabel: string;
  /** Values in chronological order. */
  values: number[];
  target?: number | null;
  direction: 'lower' | 'higher';
  format: FindingFormat;
  /** Sample behind the latest value (games, sets, throws...), when known. */
  sample?: number;
  minSample?: number;
}

function formatFindingValue(value: number, format: FindingFormat): string {
  switch (format) {
    case 'rate':
    case 'percent':
      return `${Math.round(value * 100)}%`;
    case 'perGame':
      return value.toFixed(1);
    case 'minutes':
    case 'count':
      return String(Math.round(value));
    default:
      return String(value);
  }
}

/**
 * The one-sentence finding heading a Progress chart (§5.13): it always
 * carries its number. Below the minimum sample it states the shortfall
 * instead of a finding.
 */
export function findingSentence(series: FindingSeries): string {
  const { metricLabel, values } = series;
  if (values.length === 0) return `No data yet for ${metricLabel}.`;
  if (
    series.minSample !== undefined &&
    series.sample !== undefined &&
    series.sample < series.minSample
  ) {
    return `Not enough data for ${metricLabel}: ${series.sample} of ${series.minSample} required.`;
  }
  const latest = values[values.length - 1] as number;
  const latestText = formatFindingValue(latest, series.format);
  const targetText =
    series.target !== undefined && series.target !== null
      ? ` (target ${formatFindingValue(series.target, series.format)})`
      : '';
  const sampleText =
    series.sample !== undefined ? ` (sample ${series.sample})` : '';
  if (values.length === 1) {
    return `${metricLabel} is ${latestText}${targetText}${sampleText}.`;
  }
  const first = values[0] as number;
  const delta = latest - first;
  const goodDirection =
    series.direction === 'lower' ? delta < -1e-9 : delta > 1e-9;
  const flat = Math.abs(delta) <= 1e-9;
  const trendWord = flat ? 'unchanged' : goodDirection ? 'improved' : 'declined';
  return (
    `${metricLabel} ${trendWord} from ${formatFindingValue(first, series.format)} ` +
    `to ${latestText}${targetText} over ${values.length} points${sampleText}.`
  );
}
