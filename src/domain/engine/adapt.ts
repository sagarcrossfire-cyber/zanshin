// Spec §7.5 — difficulty adaptation. Pure functions returning decisions + coach notes.

export interface AdaptationSet {
  successes: number;
  reps: number;
}

export interface AdaptDrill {
  id: string;
  title?: string;
  /** Target success rate (0-1). */
  targetRate: number;
  progressions: string[];
  regressions: string[];
  /** Index of the next progression to apply (0 = first). */
  progressionIndex?: number;
  regressionIndex?: number;
}

export type AdaptationType = 'progression' | 'regression' | 'plateau' | 'tilt' | 'none';

export interface AdaptationDecision {
  type: AdaptationType;
  drillId?: string;
  /** The progression/regression step to apply, when one exists. */
  action?: string;
  /** True when a refresh block for a Learning/Rusty prerequisite is added. */
  refreshPrerequisite?: boolean;
  /** True when the drill moves to every-other-session scheduling (plateau). */
  spaced?: boolean;
  /** Coach note string; empty for 'none'. */
  note: string;
}

function rateOf(set: AdaptationSet): number {
  return set.reps > 0 ? set.successes / set.reps : 0;
}

function lastSets(sets: AdaptationSet[], n: number): AdaptationSet[] {
  return sets.filter((set) => set.reps > 0).slice(-n);
}

/**
 * Progression: the last 3 sets each beat the drill target by 10 points or more.
 */
export function progressionDecision(drill: AdaptDrill, sets: AdaptationSet[]): AdaptationDecision {
  const last3 = lastSets(sets, 3);
  if (last3.length < 3) return { type: 'none', drillId: drill.id, note: '' };
  const beats = last3.every((set) => rateOf(set) >= drill.targetRate + 0.1);
  if (!beats) return { type: 'none', drillId: drill.id, note: '' };
  const next = drill.progressions[drill.progressionIndex ?? 0];
  if (next === undefined) {
    return {
      type: 'none',
      drillId: drill.id,
      note: '',
    };
  }
  return {
    type: 'progression',
    drillId: drill.id,
    action: next,
    note: `${drill.title ?? drill.id}: the last 3 sets beat the target by 10 points or more. Next step: ${next}.`,
  };
}

/**
 * Regression: the last 3 sets are each below 50%. When a prerequisite is
 * Learning or Rusty, one refresh block for it is added.
 */
export function regressionDecision(
  drill: AdaptDrill,
  sets: AdaptationSet[],
  prerequisiteState?: string | null,
): AdaptationDecision {
  const last3 = lastSets(sets, 3);
  if (last3.length < 3) return { type: 'none', drillId: drill.id, note: '' };
  const below = last3.every((set) => rateOf(set) < 0.5);
  if (!below) return { type: 'none', drillId: drill.id, note: '' };
  const refresh = prerequisiteState === 'learning' || prerequisiteState === 'rusty';
  const next = drill.regressions[drill.regressionIndex ?? 0];
  return {
    type: 'regression',
    drillId: drill.id,
    action: next,
    refreshPrerequisite: refresh,
    note:
      `${drill.title ?? drill.id}: below 50% on the last 3 sets.` +
      (next !== undefined ? ` Step back to: ${next}.` : '') +
      (refresh ? ' Add one refresh block for the prerequisite.' : ''),
  };
}

/**
 * Plateau: after 5 sessions on a drill with execution moving 2 points or
 * less (max-min <= 0.02) while below target. `executions` are per-session
 * execution values in chronological order.
 */
export function plateauDecision(
  drill: AdaptDrill,
  executions: number[],
): AdaptationDecision {
  if (executions.length < 5) return { type: 'none', drillId: drill.id, note: '' };
  const last5 = executions.slice(-5);
  const min = Math.min(...last5);
  const max = Math.max(...last5);
  const latest = last5[last5.length - 1] as number;
  if (max - min > 0.02 || latest >= drill.targetRate) {
    return { type: 'none', drillId: drill.id, note: '' };
  }
  return {
    type: 'plateau',
    drillId: drill.id,
    spaced: true,
    note:
      `${drill.title ?? drill.id}: execution has moved 2 points or less over 5 sessions ` +
      `while below target. Try a different method: record a replay, watch the reference, ` +
      `or split the input. This drill moves to every other session.`,
  };
}

/**
 * Tilt guard: after 5 logged losses in a row on one day, Today suggests
 * ending ranked for the day and offers a short Lab block instead. Results
 * are chronological; only the most recent day's trailing run counts.
 */
export function tiltGuard(
  results: { day: string; won: boolean }[],
): AdaptationDecision {
  if (results.length === 0) return { type: 'none', note: '' };
  const latestDay = results[results.length - 1]?.day;
  let trailingLosses = 0;
  for (let i = results.length - 1; i >= 0; i -= 1) {
    const result = results[i];
    if (result === undefined || result.day !== latestDay || result.won) break;
    trailingLosses += 1;
  }
  if (trailingLosses < 5) return { type: 'none', note: '' };
  return {
    type: 'tilt',
    note:
      'Five losses in a row today. End ranked for the day and take a short Lab block instead.',
  };
}

/**
 * One decision per drill, checked in order: progression, regression, plateau.
 * `executions` are per-session execution values for the plateau check.
 */
export function adaptationForDrill(
  drill: AdaptDrill,
  sets: AdaptationSet[],
  executions: number[] = [],
  prerequisiteState?: string | null,
): AdaptationDecision {
  const progression = progressionDecision(drill, sets);
  if (progression.type !== 'none') return progression;
  const regression = regressionDecision(drill, sets, prerequisiteState);
  if (regression.type !== 'none') return regression;
  return plateauDecision(drill, executions);
}
