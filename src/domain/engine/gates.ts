// Spec §7.2 — stage gates and baseline placement. Pure functions over plain-object inputs.

import type { MasteryState } from './mastery';

export interface GateCriterion {
  metric: string;
  op: '>=' | '<=';
  value: number;
  window: { kind: 'sets' | 'games' | 'days' | 'questions'; n: number };
  minSample: number;
}

export interface GateDefinition {
  id: string;
  description?: string;
  criteria: GateCriterion[];
}

export interface GateEvidence {
  /** Node states for the stage; Solid/Mastered share must reach 80%. */
  nodes: { nodeId: string; state: MasteryState | string }[];
  /** Observed metric values with their sample sizes, keyed by metric id. */
  metrics: Record<string, { value: number; sample: number }>;
}

export interface GateResult {
  passed: boolean;
  /** Metric ids of failed criteria, plus 'solidShare' when the node share fails. */
  failedCriteria: string[];
  solidShare: number;
}

export const GATE_SOLID_SHARE = 0.8;

/** Placement (§11.5): the punish quiz needs 20 questions instead of 40. */
export const PLACEMENT_PUNISH_QUIZ_QUESTIONS = 20;

export function placementGate(gate: GateDefinition): GateDefinition {
  return {
    ...gate,
    criteria: gate.criteria.map((criterion) =>
      criterion.metric === 'punishQuizAccuracy'
        ? {
            ...criterion,
            minSample: Math.min(criterion.minSample, PLACEMENT_PUNISH_QUIZ_QUESTIONS),
            window: { ...criterion.window, n: Math.min(criterion.window.n, PLACEMENT_PUNISH_QUIZ_QUESTIONS) },
          }
        : criterion,
    ),
  };
}

export function evaluateGate(gate: GateDefinition, evidence: GateEvidence): GateResult {
  const solidCount = evidence.nodes.filter(
    (node) => node.state === 'solid' || node.state === 'mastered',
  ).length;
  const solidShare = evidence.nodes.length === 0 ? 0 : solidCount / evidence.nodes.length;
  const failedCriteria: string[] = [];
  if (solidShare < GATE_SOLID_SHARE) failedCriteria.push('solidShare');
  for (const criterion of gate.criteria) {
    const observed = evidence.metrics[criterion.metric];
    const holds =
      observed !== undefined &&
      observed.sample >= criterion.minSample &&
      (criterion.op === '>=' ? observed.value >= criterion.value : observed.value <= criterion.value);
    if (!holds) failedCriteria.push(criterion.metric);
  }
  return { passed: failedCriteria.length === 0, failedCriteria, solidShare };
}

export type StageState = 'locked' | 'open' | 'passed';

export interface StageInput {
  id: string;
  index: number;
  gate: GateDefinition;
  nodeIds?: string[];
}

export interface StageStatusOptions {
  previousState?: StageState | null;
  /** True when the previous stage has passed (a stage opens when the one before it passes). */
  previousStagePassed?: boolean;
  /** Test-out (§5.4): a locked stage may pass its gate directly. */
  allowTestOut?: boolean;
  /** True when the pass came via placement (test-out / baseline). */
  viaPlacement?: boolean;
  previousViaPlacement?: boolean;
}

export interface StageStatusResult {
  stageId: string;
  state: StageState;
  passed: boolean;
  failedCriteria: string[];
  solidShare: number;
  viaPlacement: boolean;
}

export function evaluateStageStatus(
  stage: StageInput,
  evidence: GateEvidence,
  options: StageStatusOptions = {},
): StageStatusResult {
  // A passed stage never re-locks.
  if (options.previousState === 'passed') {
    const gateResult = evaluateGate(stage.gate, evidence);
    return {
      stageId: stage.id,
      state: 'passed',
      passed: true,
      failedCriteria: gateResult.failedCriteria,
      solidShare: gateResult.solidShare,
      viaPlacement: options.previousViaPlacement ?? false,
    };
  }
  const isFirstStage = stage.index === 0;
  const open = isFirstStage || options.previousStagePassed === true || options.previousState === 'open';
  const gateResult = evaluateGate(stage.gate, evidence);
  const canPass = open || options.allowTestOut === true;
  if (gateResult.passed && canPass) {
    return {
      stageId: stage.id,
      state: 'passed',
      passed: true,
      failedCriteria: [],
      solidShare: gateResult.solidShare,
      viaPlacement: options.viaPlacement ?? false,
    };
  }
  return {
    stageId: stage.id,
    state: open ? 'open' : 'locked',
    passed: false,
    failedCriteria: gateResult.failedCriteria,
    solidShare: gateResult.solidShare,
    viaPlacement: false,
  };
}

export interface PlacementStageInput {
  index: number;
  gate: GateDefinition;
  evidence: GateEvidence;
}

/**
 * Baseline placement (§7.2, §11.5): gates are checked in order on baseline
 * data. Placement waives the 2-day Mastered-evidence rule (handled in mastery
 * placement) and needs only 20 punish-quiz questions. Placement never passes
 * a stage past Stage 3, so the returned starting stage is at most 4
 * (Stage 4 open, Stages 0-3 passed). Stage 0 is open at the start: a missing
 * Stage 0 gate counts as passed.
 */
export function evaluatePlacement(stages: PlacementStageInput[]): number {
  if (stages.length === 0) return 0;
  const ordered = [...stages].sort((a, b) => a.index - b.index);
  const byIndex = new Map(ordered.map((stage) => [stage.index, stage]));
  for (let index = 0; index <= 3; index += 1) {
    const stage = byIndex.get(index);
    if (stage === undefined) continue; // missing gate: treated as passed
    const result = evaluateGate(placementGate(stage.gate), stage.evidence);
    if (!result.passed) return index;
  }
  return 4;
}
