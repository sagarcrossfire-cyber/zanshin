// Spec §7.4 — weakness detection over the last 10 logged games.

export type Act = 'shu' | 'ha' | 'ri';

export type WeaknessMetric =
  | 'missedPunishesPerGame'
  | 'panicSuccess'
  | 'throwBreaks'
  | 'hitWhileMinusPerGame'
  | 'lowsBlocked'
  | 'heatWasted'
  | 'okiPerGame';

export interface WeaknessTallies {
  missedPunishes: number;
  flashHit: number;
  flashBlocked: number;
  flashWhiffed: number;
  spinEscaped: number;
  spinPunished: number;
  throwsBroken: number;
  throwsMissed: number;
  hitWhileMinus: number;
  lowsBlocked: number;
  lowsEaten: number;
  heatConverted: number;
  heatWasted: number;
  okiConverted: number;
}

export interface WeaknessMatchSet {
  tallies: WeaknessTallies;
  games: number;
  /** ISO date or date-time, newest-first ordering when present on every set. */
  at?: string;
  day?: string;
}

export type WeaknessTrend = 'better' | 'worse' | 'same' | null;

export interface Weakness {
  metric: WeaknessMetric;
  label: string;
  value: number;
  target: number;
  direction: 'lower' | 'higher';
  /** Relative gap to target; only positive gaps become weaknesses. */
  severity: number;
  /** Sample behind the value (games for per-game metrics, attempts otherwise). */
  sample: number;
  games: number;
  trend: WeaknessTrend;
  previousValue: number | null;
  /** Stage indexes the metric feeds (§7.4 table). */
  feedsStages: number[];
}

interface MetricDef {
  metric: WeaknessMetric;
  label: string;
  direction: 'lower' | 'higher';
  minSample: number;
  perGame: boolean;
  targets: Record<Act, number | null>;
  feedsStages: number[];
  compute: (tallies: WeaknessTallies, games: number) => { value: number; sample: number };
}

const METRIC_DEFS: MetricDef[] = [
  {
    metric: 'missedPunishesPerGame',
    label: 'Missed punishes per game',
    direction: 'lower',
    minSample: 5,
    perGame: true,
    targets: { shu: 2.0, ha: 1.0, ri: 0.5 },
    feedsStages: [1, 3],
    compute: (t, games) => ({ value: games === 0 ? 0 : t.missedPunishes / games, sample: games }),
  },
  {
    metric: 'panicSuccess',
    label: 'Panic-tool success',
    direction: 'higher',
    minSample: 5,
    perGame: false,
    targets: { shu: null, ha: 0.55, ri: 0.65 },
    feedsStages: [5],
    compute: (t) => {
      const attempts = t.flashHit + t.flashBlocked + t.flashWhiffed + t.spinEscaped + t.spinPunished;
      return {
        value: attempts === 0 ? 0 : (t.flashHit + t.spinEscaped) / attempts,
        sample: attempts,
      };
    },
  },
  {
    metric: 'throwBreaks',
    label: 'Throw breaks',
    direction: 'higher',
    minSample: 5,
    perGame: false,
    targets: { shu: 0.4, ha: 0.5, ri: 0.6 },
    feedsStages: [1],
    compute: (t) => {
      const total = t.throwsBroken + t.throwsMissed;
      return { value: total === 0 ? 0 : t.throwsBroken / total, sample: total };
    },
  },
  {
    metric: 'hitWhileMinusPerGame',
    label: 'Hit while minus, per game',
    direction: 'lower',
    minSample: 5,
    perGame: true,
    targets: { shu: 2.0, ha: 1.0, ri: 0.5 },
    feedsStages: [1, 2],
    compute: (t, games) => ({ value: games === 0 ? 0 : t.hitWhileMinus / games, sample: games }),
  },
  {
    metric: 'lowsBlocked',
    label: 'Lows blocked',
    direction: 'higher',
    minSample: 5,
    perGame: false,
    targets: { shu: 0.5, ha: 0.6, ri: 0.7 },
    feedsStages: [1],
    compute: (t) => {
      const total = t.lowsBlocked + t.lowsEaten;
      return { value: total === 0 ? 0 : t.lowsBlocked / total, sample: total };
    },
  },
  {
    metric: 'heatWasted',
    label: 'Heat wasted',
    direction: 'lower',
    minSample: 3,
    perGame: false,
    targets: { shu: null, ha: 0.4, ri: 0.25 },
    feedsStages: [4],
    compute: (t) => {
      const total = t.heatConverted + t.heatWasted;
      return { value: total === 0 ? 0 : t.heatWasted / total, sample: total };
    },
  },
  {
    metric: 'okiPerGame',
    label: 'Oki conversions per game',
    direction: 'higher',
    minSample: 5,
    perGame: true,
    targets: { shu: null, ha: 0.5, ri: 1.0 },
    feedsStages: [7],
    compute: (t, games) => ({ value: games === 0 ? 0 : t.okiConverted / games, sample: games }),
  },
];

/** KPI target editor data (Settings, §5.17): one override per metric; blank means the per-act engine default. */
export const KPI_TARGET_EDITOR: { metric: WeaknessMetric; label: string; direction: 'lower' | 'higher'; defaults: Record<Act, number | null> }[] =
  METRIC_DEFS.map((def) => ({ metric: def.metric, label: def.label, direction: def.direction, defaults: def.targets }));

function zeroTallies(): WeaknessTallies {
  return {
    missedPunishes: 0, flashHit: 0, flashBlocked: 0, flashWhiffed: 0,
    spinEscaped: 0, spinPunished: 0, throwsBroken: 0, throwsMissed: 0,
    hitWhileMinus: 0, lowsBlocked: 0, lowsEaten: 0, heatConverted: 0,
    heatWasted: 0, okiConverted: 0,
  };
}

function addScaled(into: WeaknessTallies, from: WeaknessTallies, fraction: number): void {
  (Object.keys(into) as (keyof WeaknessTallies)[]).forEach((key) => {
    into[key] += from[key] * fraction;
  });
}

interface Window {
  tallies: WeaknessTallies;
  games: number;
}

/**
 * Take `gamesWanted` games from the newest sets, skipping `skipGames` games
 * first. A set that straddles either boundary contributes proportionally.
 */
function takeGames(setsNewestFirst: WeaknessMatchSet[], skipGames: number, gamesWanted: number): Window {
  const tallies = zeroTallies();
  let games = 0;
  let skipped = 0;
  for (const set of setsNewestFirst) {
    if (games >= gamesWanted || set.games <= 0) continue;
    const availableFrom = Math.max(0, set.games - Math.max(0, skipGames - skipped));
    skipped += set.games;
    if (availableFrom <= 0) continue;
    const take = Math.min(availableFrom, gamesWanted - games);
    addScaled(tallies, set.tallies, take / set.games);
    games += take;
  }
  return { tallies, games };
}

function normaliseAct(act: string): Act {
  const lower = act.toLowerCase();
  if (lower === 'shu' || lower === 'ha' || lower === 'ri') return lower;
  return 'shu';
}

/**
 * Detect weaknesses from logged match sets (oldest first; when every set
 * carries `at`/`day`, ordering is by that stamp, newest first). Returns at
 * most the top two weaknesses by severity. Metrics below their minimum
 * sample, metrics with no target in this act, and metrics already meeting
 * their target are left out. Trend compares the last 10 games with the
 * 10 before them and needs 20 games.
 */
export function detectWeaknesses(
  matchSets: WeaknessMatchSet[],
  act: Act | string,
  targetOverrides?: Partial<Record<WeaknessMetric, number | null>>,
): Weakness[] {
  const actKey = normaliseAct(act);
  const ordered = [...matchSets];
  const allStamped = ordered.length > 0 && ordered.every((set) => set.at !== undefined || set.day !== undefined);
  if (allStamped) {
    ordered.sort((a, b) => {
      const aKey = a.at ?? a.day ?? '';
      const bKey = b.at ?? b.day ?? '';
      return aKey < bKey ? 1 : aKey > bKey ? -1 : 0;
    });
  } else {
    ordered.reverse();
  }
  const current = takeGames(ordered, 0, 10);
  // Previous window: the next 10 games after the current window.
  const previousWindow = takeGames(ordered, 10, 10);

  const totalGames = ordered.reduce((sum, set) => sum + set.games, 0);
  const weaknesses: Weakness[] = [];
  for (const def of METRIC_DEFS) {
    const target = targetOverrides !== undefined && def.metric in targetOverrides
      ? (targetOverrides[def.metric] ?? null)
      : def.targets[actKey];
    if (target === null || target === undefined) continue;
    const { value, sample } = def.compute(current.tallies, current.games);
    if (sample < def.minSample) continue;
    const severity =
      def.direction === 'lower' ? (value - target) / target : (target - value) / target;
    if (severity <= 0) continue;
    let trend: WeaknessTrend = null;
    let previousValue: number | null = null;
    if (totalGames >= 20) {
      const prev = def.compute(previousWindow.tallies, previousWindow.games);
      if (prev.sample >= def.minSample) {
        previousValue = prev.value;
        const prevGap =
          def.direction === 'lower' ? prev.value - target : target - prev.value;
        const currentGap = severity * target;
        if (currentGap < prevGap - 1e-9) trend = 'better';
        else if (currentGap > prevGap + 1e-9) trend = 'worse';
        else trend = 'same';
      }
    }
    weaknesses.push({
      metric: def.metric,
      label: def.label,
      value,
      target,
      direction: def.direction,
      severity,
      sample,
      games: current.games,
      trend,
      previousValue,
      feedsStages: def.feedsStages,
    });
  }
  weaknesses.sort((a, b) => b.severity - a.severity || (a.metric < b.metric ? -1 : 1));
  return weaknesses.slice(0, 2);
}
