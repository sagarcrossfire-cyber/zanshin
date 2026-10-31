// Stage status sync + gate evidence — spec §7.2/§11.1. Assembles
// GateEvidence from the stores (sets, match tallies, mastery rows, quiz
// Assessments) and evaluates every stage in order. Metrics with no source
// data report sample 0, so their criteria honestly fail instead of passing
// on nothing. A passed stage never re-locks; only changed rows are written.
import { loadCurriculum } from '../data/packs';
import {
  assessmentsRepo, cardsRepo, cardStatesRepo, masteryRepo, matchSetsRepo, setsRepo, stageStatusRepo,
} from '../data/repos';
import type { Assessment, MatchSet, StageStatus } from '../data/schemas';
import { evaluateStageStatus, type GateEvidence, type StageStatusResult } from '../domain/engine/gates';
import type { MasteryState } from '../domain/engine/mastery';
import { dueCount } from '../domain/engine/srs';
import { QUIZ_RESULT_KEYS } from './placement';

export interface StageView {
  stageId: string;
  index: number;
  act: string;
  title: string;
  goal: string;
  nodeIds: string[];
  state: 'locked' | 'open' | 'passed';
  passed: boolean;
  failedCriteria: string[];
  solidShare: number;
  viaPlacement: boolean;
  solidCount: number;
  totalNodes: number;
}

function tallySums(sets: MatchSet[]): {
  games: number; missedPunishes: number; hitWhileMinus: number;
  throwsBroken: number; throwsMissed: number;
  flashHit: number; flashBlocked: number; flashWhiffed: number;
  spinEscaped: number; spinPunished: number;
  heatConverted: number; heatWasted: number; okiConverted: number;
} {
  const sums = {
    games: 0, missedPunishes: 0, hitWhileMinus: 0,
    throwsBroken: 0, throwsMissed: 0,
    flashHit: 0, flashBlocked: 0, flashWhiffed: 0,
    spinEscaped: 0, spinPunished: 0,
    heatConverted: 0, heatWasted: 0, okiConverted: 0,
  };
  for (const set of sets) {
    sums.games += set.games;
    sums.missedPunishes += set.tallies.missedPunishes;
    sums.hitWhileMinus += set.tallies.hitWhileMinus;
    sums.throwsBroken += set.tallies.throwsBroken;
    sums.throwsMissed += set.tallies.throwsMissed;
    sums.flashHit += set.tallies.flashHit;
    sums.flashBlocked += set.tallies.flashBlocked;
    sums.flashWhiffed += set.tallies.flashWhiffed;
    sums.spinEscaped += set.tallies.spinEscaped;
    sums.spinPunished += set.tallies.spinPunished;
    sums.heatConverted += set.tallies.heatConverted;
    sums.heatWasted += set.tallies.heatWasted;
    sums.okiConverted += set.tallies.okiConverted;
  }
  return sums;
}

/**
 * Quiz evidence from Assessment rows (§11.5, P8). Assessments are read
 * newest first (by `at`, then id) and accumulated until `windowN`
 * questions are covered; older assessments beyond the window are
 * ignored. When the assessment that crosses the window is only partly
 * needed, its correct count is scaled proportionally (the window is
 * treated as the first `windowN` questions, uniformly distributed
 * within that assessment). No assessments, or only zero-question
 * rows, yields exactly { value: 0, sample: 0 }.
 *
 * Result keys are canonical in placement.ts (QUIZ_RESULT_KEYS):
 * punishQuizCorrect/punishQuizTotal and notationQuizCorrect/
 * notationQuizTotal. Placement Assessment rows carry accuracy/sample
 * keys instead, so they never feed this accumulation.
 */
export function accumulateQuizEvidence(
  assessments: Assessment[],
  correctKey: string,
  totalKey: string,
  windowN: number,
): { value: number; sample: number } {
  const newestFirst = [...assessments].sort(
    (a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : (a.id < b.id ? 1 : a.id > b.id ? -1 : 0)),
  );
  let correct = 0;
  let counted = 0;
  for (const assessment of newestFirst) {
    if (counted >= windowN) break;
    const total = assessment.results[totalKey] ?? 0;
    if (total <= 0) continue;
    const rawCorrect = assessment.results[correctKey] ?? 0;
    const clampedCorrect = Math.min(Math.max(rawCorrect, 0), total);
    const remaining = windowN - counted;
    if (total <= remaining) {
      correct += clampedCorrect;
      counted += total;
    } else {
      correct += clampedCorrect * (remaining / total);
      counted += remaining;
    }
  }
  return { value: counted === 0 ? 0 : correct / counted, sample: counted };
}

export async function gateEvidenceForStage(stageId: string): Promise<GateEvidence> {
  const curriculum = loadCurriculum();
  const stage = curriculum.stages.find((s) => s.id === stageId);
  if (!stage) return { nodes: [], metrics: {} };
  const masteryRows = await masteryRepo.all();
  const masteryByNode = new Map(masteryRows.map((row) => [row.nodeId, row.state]));
  const nodes = stage.nodeIds.map((nodeId) => ({
    nodeId,
    state: (masteryByNode.get(nodeId) ?? 'learning') as MasteryState,
  }));

  const metrics: GateEvidence['metrics'] = {};
  const criteria = stage.gate.criteria;
  const needsSets = criteria.some((c) => c.metric === 'drillSuccess');
  const needsMatches = criteria.some((c) => c.metric !== 'drillSuccess' && c.metric !== 'punishQuizAccuracy');
  if (needsSets) {
    const stageDrills = new Set(curriculum.drills.filter((d) => stage.nodeIds.includes(d.nodeId)).map((d) => d.id));
    const sets = (await setsRepo.all()).filter((s) => stageDrills.has(s.drillId));
    // drillSuccess criteria whose window is questions (Stage 0's gate, and
    // Stage 4/7 quiz criteria) are quiz evidence, not sets; they are
    // filled in the quiz section below and skipped here.
    for (const criterion of criteria.filter((c) => c.metric === 'drillSuccess' && c.window.kind !== 'questions')) {
      const windowSets = sets.slice(-criterion.window.n);
      const reps = windowSets.reduce((sum, s) => sum + s.reps, 0);
      const successes = windowSets.reduce((sum, s) => sum + s.successes, 0);
      metrics[criterion.metric] = {
        value: reps === 0 ? 0 : successes / reps,
        sample: windowSets.length,
      };
    }
  }
  if (needsMatches) {
    const allMatches = (await matchSetsRepo.all()).sort((a, b) => (a.at < b.at ? -1 : 1));
    for (const criterion of criteria.filter((c) => c.metric !== 'drillSuccess' && c.metric !== 'punishQuizAccuracy')) {
      // Take the last N games (window kind 'games').
      const wanted = criterion.window.n;
      const picked: MatchSet[] = [];
      let games = 0;
      for (let i = allMatches.length - 1; i >= 0 && games < wanted; i -= 1) {
        const set = allMatches[i];
        if (!set) break;
        picked.unshift(set);
        games += set.games;
      }
      const t = tallySums(picked);
      switch (criterion.metric) {
        case 'missedPunishesPerGame':
          metrics[criterion.metric] = { value: t.games === 0 ? 0 : t.missedPunishes / t.games, sample: t.games };
          break;
        case 'hitWhileMinusPerGame':
          metrics[criterion.metric] = { value: t.games === 0 ? 0 : t.hitWhileMinus / t.games, sample: t.games };
          break;
        case 'throwBreakRate': {
          const attempts = t.throwsBroken + t.throwsMissed;
          metrics[criterion.metric] = { value: attempts === 0 ? 0 : t.throwsBroken / attempts, sample: attempts };
          break;
        }
        case 'panicSuccessRate': {
          const attempts = t.flashHit + t.flashBlocked + t.flashWhiffed + t.spinEscaped + t.spinPunished;
          metrics[criterion.metric] = { value: attempts === 0 ? 0 : (t.flashHit + t.spinEscaped) / attempts, sample: attempts };
          break;
        }
        case 'heatWasteRate': {
          const attempts = t.heatConverted + t.heatWasted;
          metrics[criterion.metric] = { value: attempts === 0 ? 0 : t.heatWasted / attempts, sample: attempts };
          break;
        }
        case 'okiPerGame':
          metrics[criterion.metric] = { value: t.games === 0 ? 0 : t.okiConverted / t.games, sample: t.games };
          break;
        default:
          metrics[criterion.metric] = { value: 0, sample: 0 };
      }
    }
  }
  // Quiz metrics (P8): punish-quiz accuracy from Assessment rows, and
  // drillSuccess criteria with a questions window (Stage 0's gate) from
  // the notation quiz, accumulated newest-first up to the window.
  const quizCriteria = criteria.filter(
    (c) => c.metric === 'punishQuizAccuracy' || (c.metric === 'drillSuccess' && c.window.kind === 'questions'),
  );
  if (quizCriteria.length > 0) {
    const assessments = await assessmentsRepo.all();
    for (const criterion of quizCriteria) {
      if (criterion.metric === 'punishQuizAccuracy') {
        metrics[criterion.metric] = accumulateQuizEvidence(
          assessments, QUIZ_RESULT_KEYS.punishCorrect, QUIZ_RESULT_KEYS.punishTotal, criterion.window.n,
        );
      } else {
        metrics[criterion.metric] = accumulateQuizEvidence(
          assessments, QUIZ_RESULT_KEYS.notationCorrect, QUIZ_RESULT_KEYS.notationTotal, criterion.window.n,
        );
      }
    }
  }
  return { nodes, metrics };
}

/** Evaluate all stages in order, persist changed rows, return the views.
 * `testOutStageId` lets one locked stage pass its gate directly (§7.2:
 * test-out is only for the next locked stage); viaPlacement is set only
 * when the stage was locked before the pass. */
export async function syncStageStatuses(options?: { testOutStageId?: string }): Promise<StageView[]> {
  const curriculum = loadCurriculum();
  const stored = await stageStatusRepo.all();
  const storedById = new Map(stored.map((row) => [row.stageId, row]));

  const views: StageView[] = [];
  let previousPassed = false;
  for (const stage of curriculum.stages) {
    const previous = storedById.get(stage.id);
    const evidence = await gateEvidenceForStage(stage.id);
    const wasLocked = previous?.state === 'locked' || (previous === undefined && stage.index > 0);
    const isTestOut = options?.testOutStageId === stage.id && wasLocked;
    const result: StageStatusResult = evaluateStageStatus(
      { id: stage.id, index: stage.index, gate: stage.gate, nodeIds: stage.nodeIds },
      evidence,
      {
        previousState: previous?.state ?? null,
        previousStagePassed: previousPassed,
        previousViaPlacement: previous?.viaPlacement ?? false,
        allowTestOut: isTestOut,
        viaPlacement: isTestOut,
      },
    );
    const solidCount = evidence.nodes.filter((n) => n.state === 'solid' || n.state === 'mastered').length;
    const next: StageStatus = {
      stageId: stage.id,
      state: result.state,
      viaPlacement: result.viaPlacement,
      ...(result.state === 'passed' && previous?.passedAt ? { passedAt: previous.passedAt } : {}),
      ...(result.state === 'passed' && !previous?.passedAt ? { passedAt: new Date().toISOString() } : {}),
    };
    if (previous?.state !== next.state || previous?.viaPlacement !== next.viaPlacement || (next.passedAt !== undefined && previous?.passedAt !== next.passedAt)) {
      await stageStatusRepo.put(next);
    }
    views.push({
      stageId: stage.id,
      index: stage.index,
      act: stage.act,
      title: stage.title,
      goal: stage.goal,
      nodeIds: stage.nodeIds,
      state: result.state,
      passed: result.passed,
      failedCriteria: result.failedCriteria,
      solidShare: result.solidShare,
      viaPlacement: result.viaPlacement,
      solidCount,
      totalNodes: stage.nodeIds.length,
    });
    previousPassed = result.passed;
  }
  return views;
}

/** Due-card counts per deck (0 until P8 builds card states). */
export async function dueCardsByDeck(day: string): Promise<Map<string, number>> {
  const states = await cardStatesRepo.all();
  const cards = await cardsRepo.all();
  const deckByCard = new Map(cards.map((card) => [card.id, card.deck]));
  const statesByDeck = new Map<string, typeof states>();
  for (const state of states) {
    const deck = deckByCard.get(state.cardId) ?? '';
    const list = statesByDeck.get(deck) ?? [];
    list.push(state);
    statesByDeck.set(deck, list);
  }
  const byDeck = new Map<string, number>();
  for (const [deck, list] of statesByDeck) {
    byDeck.set(deck, dueCount(list, day));
  }
  return byDeck;
}
