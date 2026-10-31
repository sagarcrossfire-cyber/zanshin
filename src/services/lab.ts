// Lab orchestration — spec §5.5/§7.1. Screens call these; only the repos
// touch IndexedDB. Every change persists immediately.
import { loadCurriculum } from '../data/packs';
import {
  conflictsRepo, masteryRepo, matchSetsRepo, sessionsRepo, setsRepo, verificationsRepo,
} from '../data/repos';
import type { DataConflict, DrillSet, MatchSet, Session, SessionBlock, VerificationRecord } from '../data/schemas';
import { computeMastery, type MasteryResult } from '../domain/engine/mastery';
import type { Plan } from '../domain/engine/plan';
import { startBlock } from '../domain/lab/timer';
import { format } from 'date-fns/format';

export function todayDay(now: Date): string {
  return format(now, 'yyyy-MM-dd');
}

/** Build a 'plan' session from a generated plan. Verify blocks expand to
 * one block per verify task so each check gets its own runner card (D-027). */
export function sessionFromPlan(plan: Plan, nowIso: string): Session {
  const blocks: SessionBlock[] = [];
  for (const block of plan.blocks) {
    if (block.kind === 'verify' && block.verifyTaskIds !== undefined && block.verifyTaskIds.length > 0) {
      for (const taskId of block.verifyTaskIds) {
        blocks.push({
          id: `block-${blocks.length}`,
          kind: 'verify',
          drillId: `verify:${taskId}`,
          minutes: 2,
          reason: block.reason,
        });
      }
    } else {
      blocks.push({
        id: `block-${blocks.length}`,
        kind: block.kind,
        drillId: block.drillId,
        minutes: block.minutes,
        reason: block.reason,
      });
    }
  }
  if (blocks.length > 0) {
    blocks[0] = { ...blocks[0] as SessionBlock, startedAt: nowIso };
  }
  return {
    id: `session-plan-${Date.parse(nowIso)}`,
    kind: 'plan',
    startedAt: nowIso,
    status: 'active',
    plannedMinutes: plan.total,
    blocks,
    currentBlock: 0,
    pausedMs: 0,
  };
}

export async function createCustomSession(
  blocks: Array<{ drillId?: string; minutes: number; reason: string; kind: SessionBlock['kind'] }>,
  nowIso: string,
): Promise<Session> {
  const session: Session = {
    id: `session-custom-${Date.parse(nowIso)}`,
    kind: 'custom',
    startedAt: nowIso,
    status: 'active',
    plannedMinutes: blocks.reduce((sum, b) => sum + b.minutes, 0),
    blocks: blocks.map((block, i) => ({
      id: `block-${i}`,
      kind: block.kind,
      drillId: block.drillId,
      minutes: block.minutes,
      reason: block.reason,
      ...(i === 0 ? { startedAt: nowIso } : {}),
    })),
    currentBlock: 0,
    pausedMs: 0,
  };
  return sessionsRepo.put(session);
}

/** Log one set, persist it, and recalculate the node's mastery (AC-LAB-4).
 * Returns the set id plus mastery before/after, for debrief deltas (P6). */
export async function logSet(args: {
  sessionId: string;
  drillId: string;
  nodeId: string;
  reps: number;
  successes: number;
  side?: 'p1' | 'p2';
  now: Date;
}): Promise<{ id: string; before: MasteryResult | null; after: MasteryResult | null }> {
  const before = args.nodeId.startsWith('combo:') || args.nodeId === 'verify'
    ? null
    : await masteryRepo.get(args.nodeId).then((row) => (row === undefined ? null : {
      nodeId: row.nodeId, K: row.K, E: row.E, A: row.A, score: row.score,
      state: row.state, placed: row.placed, evidenceDays: row.evidenceDays, updatedAt: row.updatedAt,
    }));
  const set: DrillSet = {
    id: `set-${Date.parse(args.now.toISOString())}-${Math.floor(Math.random() * 1_000_000)}`,
    sessionId: args.sessionId,
    drillId: args.drillId,
    nodeId: args.nodeId,
    at: args.now.toISOString(),
    day: todayDay(args.now),
    reps: args.reps,
    successes: args.successes,
    ...(args.side ? { side: args.side } : {}),
  };
  await setsRepo.put(set);
  const after = await recomputeNodeMastery(args.nodeId, args.now.toISOString());
  return { id: set.id, before, after };
}

/** Undo a logged set: remove it and recalculate mastery again. */
export async function undoSet(setId: string, nodeId: string, nowIso: string): Promise<void> {
  await setsRepo.remove(setId);
  await recomputeNodeMastery(nodeId, nowIso);
}

/** Recompute one node's mastery from its sets (P7: + KPI evidence from match
 * sets; cards arrive with P8). KPIs below their minimum sample are left out
 * (§7.1). Returns the result, or null for non-curriculum nodes. */
export async function recomputeNodeMastery(nodeId: string, nowIso: string): Promise<MasteryResult | null> {
  if (nodeId.startsWith('combo:') || nodeId === 'verify' || nodeId.startsWith('problem:')) return null; // No curriculum node.
  const curriculum = loadCurriculum();
  const node = curriculum.nodes.find((n) => n.id === nodeId);
  if (!node) return null;
  const [sets, matchSets] = await Promise.all([setsRepo.allByNode(nodeId), matchSetsRepo.all()]);
  const previous = await masteryRepo.get(nodeId);
  const drill = curriculum.drills.find((d) => d.nodeId === nodeId);
  const stageIndex = curriculum.stages.findIndex((s) => s.id === node.stageId);
  const kpis = kpiInputsForNode(node.kpis, sets, matchSets);
  const result = computeMastery({
    nodeId,
    hasKnowledge: node.components.knowledge,
    hasExecution: node.components.execution,
    hasApplication: node.components.application,
    cards: [],
    sets: sets.map((s) => ({ successes: s.successes, reps: s.reps, at: s.at, day: s.day })),
    drillTarget: drill?.target.successRate ?? null,
    kpis,
    now: nowIso,
    previousState: previous?.state ?? null,
    stageOpen: stageIndex === 0,
    prerequisitesMet: true,
  });
  await masteryRepo.put({
    nodeId: result.nodeId,
    K: result.K,
    E: result.E,
    A: result.A,
    score: result.score,
    state: result.state,
    placed: result.placed,
    evidenceDays: result.evidenceDays,
    updatedAt: result.updatedAt,
  });
  return result;
}

/** Recompute every curriculum node's mastery (after a match-log change, §7.1). */
export async function recomputeAllMastery(nowIso: string): Promise<void> {
  const curriculum = loadCurriculum();
  for (const node of curriculum.nodes) {
    await recomputeNodeMastery(node.id, nowIso);
  }
}

interface NodeKpiDef {
  metric: string;
  op: '>=' | '<=';
  value: number;
  window: { kind: string; n: number };
  minSample: number;
}

interface KpiInput {
  direction: 'lower' | 'higher';
  target: number;
  value: number;
  sample: number;
  minSample: number;
}

/**
 * Current KPI values from sets + match tallies over the last 10 games.
 * Metrics with no source data (verifiedShare, quizzes) are left out.
 */
export function kpiInputsForNode(
  defs: NodeKpiDef[],
  sets: DrillSet[],
  matchSets: MatchSet[],
): KpiInput[] {
  const ordered = [...matchSets].sort((a, b) => (a.at < b.at ? -1 : 1));
  const windowSets: typeof ordered = [];
  let games = 0;
  for (let i = ordered.length - 1; i >= 0 && games < 10; i -= 1) {
    const set = ordered[i];
    if (!set) break;
    windowSets.unshift(set);
    games += set.games;
  }
  const t = windowSets.reduce(
    (sums, set) => {
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
      sums.lowsBlocked += set.tallies.lowsBlocked;
      sums.lowsEaten += set.tallies.lowsEaten;
      sums.heatConverted += set.tallies.heatConverted;
      sums.heatWasted += set.tallies.heatWasted;
      sums.okiConverted += set.tallies.okiConverted;
      return sums;
    },
    {
      games: 0, missedPunishes: 0, hitWhileMinus: 0,
      throwsBroken: 0, throwsMissed: 0,
      flashHit: 0, flashBlocked: 0, flashWhiffed: 0,
      spinEscaped: 0, spinPunished: 0,
      lowsBlocked: 0, lowsEaten: 0,
      heatConverted: 0, heatWasted: 0, okiConverted: 0,
    },
  );
  const inputs: KpiInput[] = [];
  for (const def of defs) {
    let observed: { value: number; sample: number } | null = null;
    switch (def.metric) {
      case 'drillSuccess': {
        const window = sets.slice(-def.window.n);
        const reps = window.reduce((sum, s) => sum + s.reps, 0);
        const successes = window.reduce((sum, s) => sum + s.successes, 0);
        observed = { value: reps === 0 ? 0 : successes / reps, sample: window.length };
        break;
      }
      case 'missedPunishesPerGame':
        observed = { value: t.games === 0 ? 0 : t.missedPunishes / t.games, sample: t.games };
        break;
      case 'hitWhileMinusPerGame':
        observed = { value: t.games === 0 ? 0 : t.hitWhileMinus / t.games, sample: t.games };
        break;
      case 'throwBreakRate': {
        const attempts = t.throwsBroken + t.throwsMissed;
        observed = { value: attempts === 0 ? 0 : t.throwsBroken / attempts, sample: attempts };
        break;
      }
      case 'panicSuccessRate': {
        const attempts = t.flashHit + t.flashBlocked + t.flashWhiffed + t.spinEscaped + t.spinPunished;
        observed = { value: attempts === 0 ? 0 : (t.flashHit + t.spinEscaped) / attempts, sample: attempts };
        break;
      }
      case 'lowBlockRate':
      case 'lowsBlocked': {
        const attempts = t.lowsBlocked + t.lowsEaten;
        observed = { value: attempts === 0 ? 0 : t.lowsBlocked / attempts, sample: attempts };
        break;
      }
      case 'heatWasteRate': {
        const attempts = t.heatConverted + t.heatWasted;
        observed = { value: attempts === 0 ? 0 : t.heatWasted / attempts, sample: attempts };
        break;
      }
      case 'okiPerGame':
        observed = { value: t.games === 0 ? 0 : t.okiConverted / t.games, sample: t.games };
        break;
      default:
        observed = null; // verifiedShare, punishQuizAccuracy: no source yet.
    }
    if (observed !== null && observed.sample >= def.minSample) {
      inputs.push({
        direction: def.op === '<=' ? 'lower' : 'higher',
        target: def.value,
        value: observed.value,
        sample: observed.sample,
        minSample: def.minSample,
      });
    }
  }
  return inputs;
}

export interface VerifyOutcome {
  record: VerificationRecord;
  conflict: DataConflict | null;
}

/**
 * Record a verify-task outcome (AC-LAB-6). A Match resolves the backing
 * conflict with the confirmed value; a Mismatch keeps it open and appends
 * the Practice observation. The move's DataBadge follows the open-conflict
 * list, so it changes with the outcome.
 */
export async function recordVerification(args: {
  entityId: string;
  field: VerificationRecord['field'];
  expected: string;
  observed?: string;
  result: 'match' | 'mismatch';
  patch: string;
  nowIso: string;
}): Promise<VerifyOutcome> {
  const record: VerificationRecord = {
    id: `verify-${Date.parse(args.nowIso)}-${Math.floor(Math.random() * 1_000_000)}`,
    entityId: args.entityId,
    field: args.field,
    expected: args.expected,
    ...(args.observed !== undefined ? { observed: args.observed } : {}),
    result: args.result,
    patch: args.patch,
    at: args.nowIso,
  };
  await verificationsRepo.put(record);

  const open = (await conflictsRepo.allByEntity(args.entityId)).find(
    (c) => c.status === 'open' && c.field === args.field,
  );
  if (args.result === 'match') {
    if (open) {
      const resolved: DataConflict = {
        ...open,
        status: 'resolved',
        resolution: `Confirmed in Practice: ${args.observed ?? args.expected}`,
      };
      await conflictsRepo.put(resolved);
      return { record, conflict: resolved };
    }
    return { record, conflict: null };
  }
  // Mismatch: keep the conflict open and append the observation.
  if (open) {
    const observed = args.observed ?? 'differs in Practice';
    const already = open.values.some((v) => v.source === 'practice' && v.value === observed);
    const updated: DataConflict = already
      ? open
      : { ...open, values: [...open.values, { source: 'practice', value: observed }] };
    await conflictsRepo.put(updated);
    return { record, conflict: updated };
  }
  const created: DataConflict = {
    id: `conflict-${Date.parse(args.nowIso)}`,
    entityId: args.entityId,
    field: args.field,
    values: [
      { source: 'pack', value: args.expected },
      { source: 'practice', value: args.observed ?? 'differs in Practice' },
    ],
    status: 'open',
  };
  await conflictsRepo.put(created);
  return { record, conflict: created };
}

/** Advance a session to its next block, starting the block's timer. Returns null when the session is finished. */
export async function advanceSession(session: Session, nowIso: string): Promise<Session | null> {
  const next = session.currentBlock + 1;
  if (next >= session.blocks.length) {
    const done: Session = { ...session, status: 'done', endedAt: nowIso };
    await sessionsRepo.put(done);
    return null;
  }
  const blocks = session.blocks.map((block, i) => (i === next ? startBlock(block, nowIso) : block));
  const updated: Session = { ...session, blocks, currentBlock: next };
  await sessionsRepo.put(updated);
  return updated;
}

export function sessionSets(sessionId: string): Promise<DrillSet[]> {
  return setsRepo.all().then((sets) => sets.filter((s) => s.sessionId === sessionId));
}
