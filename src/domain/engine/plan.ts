// Spec §7.3 — daily plan generator. Pure and deterministic: the same inputs
// always produce byte-identical JSON. No clock, no unseeded randomness.

import { hashSeed, mulberry32 } from './prng';

export type PlanDayType = 'rest' | 'light' | 'full';

export interface PlanNode {
  nodeId: string;
  title?: string;
  drillId: string;
  drillTitle?: string;
  /** Drill type, used for the "never two consecutive blocks of the same type" rule. */
  drillType: string;
  importance: 1 | 2 | 3;
  stageOpen: boolean;
  masteryScore: number;
  masteryState: string;
  /** Days since last practice; null when never practiced (counts as stale). */
  lastPracticedDaysAgo?: number | null;
  practicedToday?: boolean;
  /** Nodes this node unlocks as a prerequisite (counted at most 3). */
  prerequisiteForCount?: number;
  /** True when the node maps to a top-two weakness (§7.4). */
  inTopWeakness?: boolean;
  /**
   * Precomputed reason citing the data behind the drill (in the real app this
   * comes from weakness detection, e.g. "Missed punishes 3.0 per game vs target
   * 2.0 (last 10 games)"). When absent a generic reason is built from mastery.
   */
  reasonDetail?: string;
}

export interface PlanMatchSet {
  day: string; // practice day YYYY-MM-DD
}

export interface PlanVerifyTask {
  id: string;
  input?: string;
  importance: number;
}

export interface PlanState {
  profileId: string;
  currentStageIndex: number;
  nodes: PlanNode[];
  dueCards: number;
  matchSets: PlanMatchSet[];
  /** Sessions already completed (all time); today is a match day on every 2nd session. */
  sessionsCompleted: number;
  /** Consecutive days with a session; 5 or more forces a rest day. */
  consecutiveSessionDays: number;
  weeklyMinutesUsed: number;
  verifyTasks: PlanVerifyTask[];
  /** Label of the top weakness for the application block's text, if known. */
  topWeakness?: string | null;
  unfinishedSession?: boolean;
  /** A gate whose node conditions are met and is ready to take. */
  gateReady?: boolean;
  gateStageIndex?: number;
  sessionRanToday?: boolean;
  sessionCompletedToday?: boolean;
}

export interface PlanSettings {
  sessionMinutes: number;
  weeklyMinutes: number;
  /** Weekdays that are preferred days, 0 = Sunday .. 6 = Saturday. Empty = every day preferred. */
  preferredDays: number[];
}

export type PlanBlockKind = 'warmup' | 'review' | 'verify' | 'application' | 'drill';

export interface PlanBlock {
  kind: PlanBlockKind;
  drillId?: string;
  minutes: number;
  reason: string;
  verifyTaskIds?: string[];
}

export type PrimaryActionKind =
  | 'resume-session'
  | 'take-gate'
  | 'rest-day'
  | 'review-cards'
  | 'log-matches'
  | 'start-session';

export interface PrimaryAction {
  kind: PrimaryActionKind;
  stageIndex?: number;
  dueCards?: number;
}

export interface Plan {
  date: string;
  dayType: PlanDayType;
  budget: number;
  total: number;
  primaryAction: PrimaryAction;
  blocks: PlanBlock[];
}

function weekdayOf(date: string): number {
  const parts = date.split('-').map((part) => Number(part));
  const year = parts[0] ?? NaN;
  const month = parts[1] ?? NaN;
  const day = parts[2] ?? NaN;
  if (Number.isNaN(year) || Number.isNaN(month) || Number.isNaN(day)) return -1;
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

function dayDiff(fromDay: string, toDay: string): number {
  const from = Date.parse(`${fromDay}T00:00:00Z`);
  const to = Date.parse(`${toDay}T00:00:00Z`);
  if (Number.isNaN(from) || Number.isNaN(to)) return 0;
  return Math.round((to - from) / 86400000);
}

function daysAgoPhrase(daysAgo: number | null | undefined): string {
  if (daysAgo === null || daysAgo === undefined) return 'never practiced';
  if (daysAgo === 0) return 'practiced today';
  if (daysAgo === 1) return 'last practiced 1 day ago';
  return `last practiced ${daysAgo} days ago`;
}

function priorityOf(node: PlanNode): number {
  const weakness = node.inTopWeakness === true ? 1.5 : 1;
  const daysAgo = node.lastPracticedDaysAgo ?? null;
  const practicedToday = node.practicedToday === true || daysAgo === 0;
  const freshness = practicedToday ? 0.6 : daysAgo === null || daysAgo >= 3 ? 1.2 : 1;
  const rusty = node.masteryState === 'rusty' ? 1.3 : 1;
  const unlock = 1 + 0.1 * Math.min(node.prerequisiteForCount ?? 0, 3);
  const mastery = Math.min(1, Math.max(0, node.masteryScore));
  return node.importance * (1 - mastery) * weakness * freshness * rusty * unlock;
}

export function generatePlan(
  date: string,
  state: PlanState,
  settings: PlanSettings,
  seed?: string | number,
): Plan {
  const seedNumber =
    seed === undefined
      ? hashSeed(`${date}:${state.profileId}`)
      : typeof seed === 'number'
        ? seed
        : hashSeed(seed);
  const rng = mulberry32(seedNumber);
  // Seeded tie-breaks: one draw per node, assigned in nodeId order so the
  // draw sequence does not depend on input ordering.
  const tieBreak = new Map<string, number>();
  [...state.nodes]
    .sort((a, b) => (a.nodeId < b.nodeId ? -1 : a.nodeId > b.nodeId ? 1 : 0))
    .forEach((node) => tieBreak.set(node.nodeId, rng()));

  const weekday = weekdayOf(date);
  const isRest =
    (settings.weeklyMinutes > 0 && state.weeklyMinutesUsed >= 1.1 * settings.weeklyMinutes) ||
    state.consecutiveSessionDays >= 5;
  const dayType: PlanDayType = isRest
    ? 'rest'
    : settings.preferredDays.length > 0 && weekday !== -1 && !settings.preferredDays.includes(weekday)
      ? 'light'
      : 'full';

  const primaryAction = (blocks: PlanBlock[]): PrimaryAction => {
    if (state.unfinishedSession === true) return { kind: 'resume-session' };
    if (state.gateReady === true) {
      return state.gateStageIndex !== undefined
        ? { kind: 'take-gate', stageIndex: state.gateStageIndex }
        : { kind: 'take-gate' };
    }
    if (dayType === 'rest') return { kind: 'rest-day' };
    if (state.dueCards > 20 && state.sessionRanToday !== true) {
      return { kind: 'review-cards', dueCards: state.dueCards };
    }
    if (
      state.sessionCompletedToday === true &&
      blocks.some((block) => block.kind === 'application')
    ) {
      return { kind: 'log-matches' };
    }
    return { kind: 'start-session' };
  };

  // Rest day: only an optional 5-minute review.
  if (dayType === 'rest') {
    const blocks: PlanBlock[] = [
      {
        kind: 'review',
        minutes: 5,
        reason:
          state.dueCards > 0
            ? `Rest day: optional review, ${state.dueCards} cards due`
            : 'Rest day: optional 5-minute review',
      },
    ];
    return { date, dayType, budget: 5, total: 5, primaryAction: primaryAction(blocks), blocks };
  }

  const budget = dayType === 'light' ? Math.round(settings.sessionMinutes / 2) : settings.sessionMinutes;
  const blocks: PlanBlock[] = [];

  // Warm-up (3 min): highest-priority rusty node, else the most recently
  // mastered execution drill. Skipped in Stage 0.
  let warmupDrillType: string | null = null;
  if (state.currentStageIndex > 0) {
    const rusty = state.nodes.filter(
      (node) => node.stageOpen && node.masteryState === 'rusty' && node.drillId !== '',
    );
    const mastered = state.nodes.filter(
      (node) =>
        node.stageOpen && node.masteryState === 'mastered' && node.drillType === 'execution' && node.drillId !== '',
    );
    let warmup: PlanNode | undefined;
    if (rusty.length > 0) {
      warmup = [...rusty].sort((a, b) => {
        if (b.importance !== a.importance) return b.importance - a.importance;
        if (a.masteryScore !== b.masteryScore) return a.masteryScore - b.masteryScore;
        return (tieBreak.get(a.nodeId) ?? 0) - (tieBreak.get(b.nodeId) ?? 0);
      })[0];
    } else if (mastered.length > 0) {
      warmup = [...mastered].sort((a, b) => {
        const aDays = a.lastPracticedDaysAgo ?? Number.POSITIVE_INFINITY;
        const bDays = b.lastPracticedDaysAgo ?? Number.POSITIVE_INFINITY;
        if (aDays !== bDays) return aDays - bDays;
        if (b.importance !== a.importance) return b.importance - a.importance;
        return (tieBreak.get(a.nodeId) ?? 0) - (tieBreak.get(b.nodeId) ?? 0);
      })[0];
    }
    if (warmup !== undefined) {
      warmupDrillType = warmup.drillType;
      const title = warmup.drillTitle ?? warmup.title ?? warmup.drillId;
      blocks.push({
        kind: 'warmup',
        drillId: warmup.drillId,
        minutes: 3,
        reason:
          warmup.masteryState === 'rusty'
            ? `Keep ${title} fresh: rusty, ${daysAgoPhrase(warmup.lastPracticedDaysAgo)}`
            : `Keep ${title} fresh: mastered, ${daysAgoPhrase(warmup.lastPracticedDaysAgo)}`,
      });
    }
  }

  // Review: 0.3 minutes per due card, from 2 to 6 minutes, when any card is due.
  if (state.dueCards > 0) {
    const minutes = Math.min(6, Math.max(2, Math.round(0.3 * state.dueCards)));
    blocks.push({ kind: 'review', minutes, reason: `${state.dueCards} cards due` });
  }

  // Verify: 2 minutes, up to 3 checks, most important first.
  if (state.verifyTasks.length > 0) {
    const tasks = [...state.verifyTasks]
      .sort((a, b) => b.importance - a.importance || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .slice(0, 3);
    const firstInput = tasks[0]?.input;
    blocks.push({
      kind: 'verify',
      minutes: 2,
      reason:
        firstInput !== undefined && firstInput !== ''
          ? `Verify ${tasks.length} changed move${tasks.length === 1 ? '' : 's'}: ${firstInput}`
          : `Verify ${tasks.length} changed move${tasks.length === 1 ? '' : 's'}`,
      verifyTaskIds: tasks.map((task) => task.id),
    });
  }

  // Application: 35% of T on match days.
  const latestMatchDay = state.matchSets
    .filter((set) => set.day <= date)
    .map((set) => set.day)
    .sort()
    .at(-1);
  const lastMatchDaysAgo = latestMatchDay === undefined ? null : dayDiff(latestMatchDay, date);
  const isMatchDay =
    (state.sessionsCompleted + 1) % 2 === 0 ||
    (state.currentStageIndex >= 1 && (lastMatchDaysAgo === null || lastMatchDaysAgo >= 3));
  if (isMatchDay) {
    blocks.push({
      kind: 'application',
      minutes: Math.round(0.35 * budget),
      reason:
        state.topWeakness !== undefined && state.topWeakness !== null && state.topWeakness !== ''
          ? `Play 5–10 games. Focus: ${state.topWeakness}.`
          : 'Play 5–10 games.',
    });
  }

  // Focus drills fill the remaining time: open, unmastered nodes, ranked by
  // priority. At most 3 distinct drills (1 on a light day), each >= 5 minutes.
  const fixedMinutes = blocks.reduce((sum, block) => sum + block.minutes, 0);
  const remaining = budget - fixedMinutes;
  const maxFocus = dayType === 'light' ? 1 : 3;
  const candidates = state.nodes
    .filter(
      (node) =>
        node.stageOpen &&
        (node.masteryState === 'learning' ||
          node.masteryState === 'practicing' ||
          node.masteryState === 'rusty') &&
        node.drillId !== '',
    )
    .map((node) => ({ node, priority: priorityOf(node) }))
    .sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority;
      return (tieBreak.get(a.node.nodeId) ?? 0) - (tieBreak.get(b.node.nodeId) ?? 0);
    });

  const selected: PlanNode[] = [];
  let lastType: string | null = warmupDrillType;
  for (const candidate of candidates) {
    if (selected.length >= maxFocus) break;
    if (candidate.node.drillType === lastType) continue;
    selected.push(candidate.node);
    lastType = candidate.node.drillType;
  }
  // Fallback (only when no alternative type remains): fill the remaining slots
  // regardless of type so the budget can still be met.
  if (selected.length < maxFocus) {
    for (const candidate of candidates) {
      if (selected.length >= maxFocus) break;
      if (selected.includes(candidate.node)) continue;
      selected.push(candidate.node);
      lastType = candidate.node.drillType;
    }
  }

  if (selected.length > 0 && remaining >= 5) {
    let focus: { node: PlanNode; minutes: number }[] = [];
    const split = (pool: PlanNode[], total: number): { node: PlanNode; minutes: number }[] => {
      const base = Math.floor(total / pool.length);
      const extra = total - base * pool.length;
      return pool.map((node, index) => ({ node, minutes: base + (index < extra ? 1 : 0) }));
    };
    focus = split(selected, remaining);
    // A block that cannot reach 5 minutes is dropped and its minutes are redistributed.
    while (focus.some((entry) => entry.minutes < 5) && focus.length > 0) {
      if (focus.length === 1) {
        focus = [];
        break;
      }
      const dropped = focus[focus.length - 1];
      const pool = focus.filter((entry) => entry !== dropped).map((entry) => entry.node);
      focus = split(pool, remaining);
    }
    for (const entry of focus) {
      const node = entry.node;
      const title = node.drillTitle ?? node.title ?? node.drillId;
      const reason =
        node.reasonDetail !== undefined && node.reasonDetail !== ''
          ? node.reasonDetail
          : `${title}: mastery ${node.masteryScore.toFixed(2)}, ${daysAgoPhrase(node.lastPracticedDaysAgo)}${node.masteryState === 'rusty' ? ', rusty' : ''}${node.inTopWeakness === true ? ', top weakness' : ''}`;
      blocks.push({ kind: 'drill', drillId: node.drillId, minutes: entry.minutes, reason });
    }
    // Trim the last focus block so the total lands within ±10% of T (in
    // practice the equal split already lands on T; this covers dropped blocks).
    let total = blocks.reduce((sum, block) => sum + block.minutes, 0);
    for (;;) {
      const focusBlocks = blocks.filter((block) => block.kind === 'drill');
      if (focusBlocks.length === 0 || total === budget) break;
      const last = focusBlocks[focusBlocks.length - 1];
      if (last === undefined) break;
      const diff = budget - total;
      if (diff > 0) {
        last.minutes += diff;
        total = budget;
        break;
      }
      if (last.minutes + diff >= 5) {
        last.minutes += diff;
        total = budget;
        break;
      }
      blocks.splice(blocks.indexOf(last), 1);
      total = blocks.reduce((sum, block) => sum + block.minutes, 0);
    }
  }

  const total = blocks.reduce((sum, block) => sum + block.minutes, 0);
  return { date, dayType, budget, total, primaryAction: primaryAction(blocks), blocks };
}
