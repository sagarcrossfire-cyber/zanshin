// Spec §7.1 — mastery model. Pure functions over plain-object inputs; no DB access.

export type MasteryState = 'locked' | 'learning' | 'practicing' | 'solid' | 'mastered' | 'rusty';

export interface MasteryCardInput {
  /** Latest grade: 0 Again, 1 Hard, 2 Good, 3 Easy. */
  grade: 0 | 1 | 2 | 3;
  overdue: boolean;
}

export interface MasterySetInput {
  successes: number;
  reps: number;
  /** ISO date-time of the set, used to order sets newest-first. */
  at: string;
  /** Practice day (YYYY-MM-DD) of the set, used for decay and evidence days. */
  day: string;
}

export interface MasteryKpiInput {
  direction: 'lower' | 'higher';
  target: number;
  value: number;
  sample: number;
  minSample: number;
}

export interface MasteryInput {
  nodeId: string;
  /** Which components this node has (spec §6.4 components flags). */
  hasKnowledge: boolean;
  hasExecution: boolean;
  hasApplication: boolean;
  cards: MasteryCardInput[];
  /**
   * Punish-quiz accuracy over the last 20 questions (0-1), or null when the
   * node has no punish quiz or no questions yet. For punish nodes K is the
   * average of the card share and this accuracy.
   */
  punishQuizAccuracy?: number | null;
  /** True when this node is a punish node (its K averages in quiz accuracy). */
  isPunishNode?: boolean;
  /** All sets for the node, in any order; the newest five by `at` form the E window. */
  sets: MasterySetInput[];
  /** Drill target success rate (0-1) for the E component. */
  drillTarget?: number | null;
  kpis: MasteryKpiInput[];
  /** "Today" as an ISO date (YYYY-MM-DD) or date-time; drives the E decay clock. */
  now: string;
  /** Explicit extra evidence days (card grades, quiz answers) beyond set days. */
  evidenceDays?: string[];
  /** Previous mastery state, for the Rusty rule (was Solid/Mastered/Rusty). */
  previousState?: MasteryState | null;
  /** False when the node's stage is not open, or a prerequisite is below Practicing. */
  stageOpen?: boolean;
  prerequisitesMet?: boolean;
  /** Placement (§7.1): a placed node with no real evidence yet starts Solid at 0.80. */
  placed?: boolean;
}

export interface MasteryResult {
  nodeId: string;
  K: number | null;
  E: number | null;
  A: number | null;
  score: number;
  state: MasteryState;
  placed: boolean;
  evidenceDays: string[];
  updatedAt: string;
}

export const MASTERY_WEIGHTS = { K: 0.2, E: 0.5, A: 0.3 } as const;
const RECENCY_WEIGHTS = [1.0, 0.8, 0.6, 0.4, 0.2];

function dayDiffInDays(fromDay: string, toDay: string): number {
  const from = Date.parse(`${fromDay}T00:00:00Z`);
  const to = Date.parse(`${toDay}T00:00:00Z`);
  if (Number.isNaN(from) || Number.isNaN(to)) return 0;
  return Math.max(0, Math.round((to - from) / 86400000));
}

function datePart(iso: string): string {
  return iso.slice(0, 10);
}

export function computeMastery(input: MasteryInput): MasteryResult {
  const today = datePart(input.now);
  const sets = [...input.sets]
    .filter((set) => set.reps > 0)
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));

  const evidenceDays = [...new Set([...sets.map((set) => set.day), ...(input.evidenceDays ?? [])])].sort();
  const hasRealEvidence =
    input.cards.length > 0 ||
    sets.length > 0 ||
    input.kpis.some((kpi) => kpi.sample >= kpi.minSample) ||
    (input.punishQuizAccuracy !== undefined && input.punishQuizAccuracy !== null);

  // Placement: no real evidence yet -> Solid at exactly 0.80, placed: true.
  if (input.placed === true && !hasRealEvidence) {
    const locked = input.stageOpen === false || input.prerequisitesMet === false;
    return {
      nodeId: input.nodeId,
      K: null,
      E: null,
      A: null,
      score: 0.8,
      state: locked ? 'locked' : 'solid',
      placed: true,
      evidenceDays,
      updatedAt: input.now,
    };
  }

  // K: share of cards graded Good/Easy and not overdue; punish nodes average
  // that share with punish-quiz accuracy over the last 20 questions.
  let K: number | null = null;
  if (input.hasKnowledge) {
    const cardShare =
      input.cards.length > 0
        ? input.cards.filter((card) => card.grade >= 2 && !card.overdue).length / input.cards.length
        : null;
    const quiz = input.punishQuizAccuracy ?? null;
    if (cardShare !== null && quiz !== null) K = (cardShare + quiz) / 2;
    else if (cardShare !== null) K = cardShare;
    else if (quiz !== null && input.isPunishNode === true) K = quiz;
    else if (quiz !== null) K = quiz;
  }

  // E: recency-weighted success over the last 5 sets, divided by the drill
  // target, capped at 1, decayed by half every 14 days without practice.
  let E: number | null = null;
  if (input.hasExecution && sets.length > 0 && input.drillTarget !== undefined && input.drillTarget !== null && input.drillTarget > 0) {
    const window = sets.slice(0, 5);
    let weighted = 0;
    let weightSum = 0;
    window.forEach((set, index) => {
      const weight = RECENCY_WEIGHTS[index] ?? 0.2;
      weighted += weight * (set.successes / set.reps);
      weightSum += weight;
    });
    const daysSinceLast = dayDiffInDays(window[0]?.day ?? today, today);
    E = Math.min(1, weighted / weightSum / input.drillTarget) * Math.pow(0.5, daysSinceLast / 14);
  }

  // A: mean progress toward KPI targets; KPIs below their minimum sample are left out.
  let A: number | null = null;
  if (input.hasApplication) {
    const progresses: number[] = [];
    for (const kpi of input.kpis) {
      if (kpi.sample < kpi.minSample || kpi.target <= 0) continue;
      let progress: number;
      if (kpi.direction === 'lower') {
        progress = kpi.value <= 0 ? 1 : kpi.target / kpi.value;
      } else {
        progress = kpi.value / kpi.target;
      }
      progresses.push(Math.min(1, Math.max(0, progress)));
    }
    if (progresses.length > 0) {
      A = progresses.reduce((sum, value) => sum + value, 0) / progresses.length;
    }
  }

  // M: weighted mean over non-null components; 0 when every component is null.
  let numerator = 0;
  let denominator = 0;
  if (K !== null) { numerator += MASTERY_WEIGHTS.K * K; denominator += MASTERY_WEIGHTS.K; }
  if (E !== null) { numerator += MASTERY_WEIGHTS.E * E; denominator += MASTERY_WEIGHTS.E; }
  if (A !== null) { numerator += MASTERY_WEIGHTS.A * A; denominator += MASTERY_WEIGHTS.A; }
  const score = denominator === 0 ? 0 : numerator / denominator;

  const locked = input.stageOpen === false || input.prerequisitesMet === false;
  const windowDays = [...new Set(sets.slice(0, 5).map((set) => set.day))];
  const masteredEvidence =
    score >= 0.9 && windowDays.length >= 2 && sets.slice(0, 5).length >= 3;
  const wasSolidOrMastered =
    input.previousState === 'solid' || input.previousState === 'mastered' || input.previousState === 'rusty';

  let state: MasteryState;
  if (locked) state = 'locked';
  else if (wasSolidOrMastered && score < 0.8) state = 'rusty';
  else if (masteredEvidence) state = 'mastered';
  else if (score >= 0.8) state = 'solid';
  else if (score >= 0.5) state = 'practicing';
  else state = 'learning';

  return {
    nodeId: input.nodeId,
    K,
    E,
    A,
    score,
    state,
    placed: false,
    evidenceDays,
    updatedAt: input.now,
  };
}
