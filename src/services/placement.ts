// Baseline placement — spec §5.2 (AC-ONB-5), §7.2, §11.5. Pure-ish
// service over the repos: evaluate the Stage 0–3 gates on baseline
// evidence (with the §11.5 placement waivers), write ONE Assessment row,
// and mark passed stages/nodes as placed. Placement never skips a stage
// without its gate passing, and never goes past Stage 3 (max result 4).
import { loadCurriculum } from '../data/packs';
import { assessmentsRepo, masteryRepo, stageStatusRepo } from '../data/repos';
import type { Assessment, Mastery } from '../data/schemas';
import { evaluateGate, evaluatePlacement, placementGate, type GateEvidence } from '../domain/engine/gates';
import { gateEvidenceForStage } from './stages';

/**
 * Canonical Assessment `results` keys for quiz evidence (spec §11.5).
 * These are the ONLY keys gate evidence reads for quizzes
 * (see accumulateQuizEvidence in stages.ts). A placement Assessment row
 * deliberately does NOT carry the `*Correct`/`*Total` keys: it records
 * accuracies/samples and per-stage audit values, so re-running placement
 * never double-counts the same quiz answers as fresh evidence.
 */
export const QUIZ_RESULT_KEYS = {
  punishCorrect: 'punishQuizCorrect',
  punishTotal: 'punishQuizTotal',
  notationCorrect: 'notationQuizCorrect',
  notationTotal: 'notationQuizTotal',
  throwCorrect: 'throwBreakCorrect',
  throwTotal: 'throwBreakTotal',
} as const;

export interface PlacementStageResult {
  stageId: string;
  index: number;
  passed: boolean;
  failedCriteria: string[];
  solidShare: number;
}

export interface PlacementOutcome {
  placementStage: number;
  assessment: Assessment;
  stageResults: PlacementStageResult[];
}

/** Placement-stage score for a node with no real evidence yet (§7.1: Solid at M = 0.80). */
export const PLACED_MASTERY_SCORE = 0.8;

/**
 * Run baseline placement at `nowIso`.
 *
 * Evidence is read fresh for stages 0..3 (gateEvidenceForStage, which
 * already includes quiz evidence from Assessment rows), each gate is
 * evaluated with the placement waivers (placementGate), and the starting
 * stage is the first failing gate (evaluatePlacement, capped at 4).
 * Stages before the placement stage are marked passed viaPlacement;
 * their nodes are marked Solid + placed. The placement stage itself
 * stays open. An already-passed stage is never re-stamped: its
 * passedAt and viaPlacement are preserved untouched.
 */
export async function runPlacement(nowIso: string): Promise<PlacementOutcome> {
  const curriculum = loadCurriculum();
  const stages = [...curriculum.stages].sort((a, b) => a.index - b.index).slice(0, 4);

  const evidences = new Map<string, GateEvidence>();
  const stageResults: PlacementStageResult[] = [];
  for (const stage of stages) {
    const evidence = await gateEvidenceForStage(stage.id);
    evidences.set(stage.id, evidence);
    const result = evaluateGate(placementGate(stage.gate), evidence);
    stageResults.push({
      stageId: stage.id,
      index: stage.index,
      passed: result.passed,
      failedCriteria: result.failedCriteria,
      solidShare: result.solidShare,
    });
  }

  const placementStage = evaluatePlacement(
    stages.map((stage) => ({
      index: stage.index,
      gate: stage.gate,
      evidence: evidences.get(stage.id) as GateEvidence,
    })),
  );

  // Audit results: quiz accuracies/samples plus every per-stage metric
  // value flattened as `<stageId>:<metric>`. No `*Correct`/`*Total` keys
  // (see QUIZ_RESULT_KEYS note above).
  const results: Record<string, number> = {};
  const stage1Evidence = evidences.get('stage-1');
  results['punishQuizAccuracy'] = stage1Evidence?.metrics['punishQuizAccuracy']?.value ?? 0;
  results['punishQuizSample'] = stage1Evidence?.metrics['punishQuizAccuracy']?.sample ?? 0;
  // Stage 0's drillSuccess criterion has a questions window, so its
  // evidence is the notation quiz (see gateEvidenceForStage).
  const notation = evidences.get('stage-0')?.metrics['drillSuccess'];
  results['notationQuizAccuracy'] = notation?.value ?? 0;
  results['notationQuizSample'] = notation?.sample ?? 0;
  for (const stage of stages) {
    const evidence = evidences.get(stage.id);
    if (evidence === undefined) continue;
    for (const [metric, observed] of Object.entries(evidence.metrics)) {
      results[`${stage.id}:${metric}`] = observed.value;
      results[`${stage.id}:${metric}:sample`] = observed.sample;
    }
  }

  const assessment: Assessment = {
    id: `assessment-${Date.parse(nowIso)}`,
    at: nowIso,
    results,
    placementStage,
  };
  await assessmentsRepo.put(assessment);

  // Mark passed stages (never re-stamp an already-passed stage).
  for (let index = 0; index < placementStage; index += 1) {
    const stage = stages[index];
    if (stage === undefined) continue;
    const existing = await stageStatusRepo.get(stage.id);
    if (existing?.state === 'passed') continue;
    await stageStatusRepo.put({
      stageId: stage.id,
      state: 'passed',
      passedAt: nowIso,
      viaPlacement: true,
    });
    for (const nodeId of stage.nodeIds) {
      const existingMastery = await masteryRepo.get(nodeId);
      const placed: Mastery = existingMastery === undefined
        ? {
            nodeId,
            K: null,
            E: null,
            A: null,
            score: PLACED_MASTERY_SCORE,
            state: 'solid',
            placed: true,
            evidenceDays: [],
            updatedAt: nowIso,
          }
        : {
            ...existingMastery,
            state: 'solid',
            placed: true,
            updatedAt: nowIso,
          };
      await masteryRepo.put(placed);
    }
  }

  // The placement stage itself stays open (never downgrade a passed row).
  const currentStage = curriculum.stages.find((stage) => stage.index === placementStage);
  if (currentStage !== undefined) {
    const existing = await stageStatusRepo.get(currentStage.id);
    if (existing === undefined || existing.state === 'locked') {
      await stageStatusRepo.put({
        stageId: currentStage.id,
        state: 'open',
        viaPlacement: false,
        ...(existing?.passedAt !== undefined ? { passedAt: existing.passedAt } : {}),
      });
    }
  }

  return { placementStage, assessment, stageResults };
}
