// Baseline assessment protocol — spec §11.5. The protocol as data plus
// the baseline Session builder and the pack-derived quiz builders.
//
// No frame data is invented here: punish questions come from the §10.7
// punisher pack via the engine answer rule, notation questions from the
// Yoshimitsu move pack via spoken labels, and throw prompts from the
// two generic throws the d1-throw-breaks drill names (1+3, 2+4).
// The parallel P8 agent owns src/services/punish.ts question
// generation; it did not exist when this module was written, so the
// builders below are local to the baseline (see the report note).
import { format } from 'date-fns/format';
import { loadCurriculum, loadMovesYoshimitsu, loadPunishers } from '../data/packs';
import { assessmentsRepo, matchSetsRepo, sessionsRepo } from '../data/repos';
import type { Assessment, Move, Punisher, Session, SessionBlock } from '../data/schemas';
import { evaluateGate, placementGate, type GateDefinition, type GateEvidence } from '../domain/engine/gates';
import { bestPunisher, type PunishPosture } from '../domain/engine/punish';
import { hashSeed, mulberry32 } from '../domain/engine/prng';
import { spokenLabel } from '../domain/notation/speak';
import { QUIZ_RESULT_KEYS } from './placement';
import { gateEvidenceForStage } from './stages';

export type BaselineStepKind =
  | 'info' | 'drills' | 'punish-quiz' | 'throw-quiz' | 'notation-quiz' | 'matches' | 'extensions';

export interface BaselineDrillTask {
  id: string;
  label: string;
  input: string;
  attempts: number;
  drillId: string;
  nodeId: string;
  side?: 'p1' | 'p2';
}

export interface BaselineStep {
  id: string;
  title: string;
  minutes: number;
  kind: BaselineStepKind;
  detail: string;
  /** First drill for the step, when the step logs drill sets. */
  drillId?: string;
  nodeId?: string;
  tasks?: BaselineDrillTask[];
  /** Extension steps are offered only when the Stage 1 gate passes (§11.5). */
  extension?: boolean;
  stageId?: string;
}

export interface PunishQuizQuestion {
  kind: 'punish';
  id: string;
  blockValue: number;
  posture: PunishPosture;
  heatActive: boolean;
  /** Four punisher inputs, including the best answer, in fixed order. */
  options: string[];
  correctInput: string;
}

export interface NotationQuizQuestion {
  kind: 'notation';
  id: string;
  input: string;
  /** Four spoken labels, including the correct one, in fixed order. */
  options: string[];
  correctLabel: string;
}

export interface ThrowPrompt {
  throwInput: '1+3' | '2+4';
  breakInput: '1' | '2';
}

// --- Stance-entry mapping (§11.5 Execution) ---------------------------------
// DGF, KIN and NSS map to their Stage 6 stance nodes' drills, which exist
// in the curriculum. FLE, IND and MED have no drilled node of their own
// (n7-stances2, the Stances II tour, lists no drills), so those three
// entries log against n0-baseline — the Baseline assessment node — with
// the DGF-entries drill id, keeping stance-entry measurement out of
// unrelated skill nodes. See the DECISIONS.md row for this mapping.
const STANCE_TASKS: BaselineDrillTask[] = [
  { id: 'exec-dgf', label: 'Enter Dragonfly (DGF)', input: 'u+1+2', attempts: 5, drillId: 'd6-dgf-entries', nodeId: 'n6-dgf-entries' },
  { id: 'exec-kin', label: 'Enter Kincho (KIN)', input: '1+2', attempts: 5, drillId: 'd6-kincho', nodeId: 'n6-kincho' },
  { id: 'exec-fle', label: 'Enter Flea (FLE)', input: 'd+1+2', attempts: 5, drillId: 'd6-dgf-entries', nodeId: 'n0-baseline' },
  { id: 'exec-ind', label: 'Enter Indian Stance (IND)', input: 'd+3+4', attempts: 5, drillId: 'd6-dgf-entries', nodeId: 'n0-baseline' },
  { id: 'exec-nss', label: 'Enter No Sword Stance (NSS)', input: 'b+1+2', attempts: 5, drillId: 'd6-nss', nodeId: 'n6-nss' },
  { id: 'exec-med', label: 'Enter Meditation (MED)', input: '3+4', attempts: 5, drillId: 'd6-dgf-entries', nodeId: 'n0-baseline' },
];

export function baselineSteps(): BaselineStep[] {
  return [
    {
      id: 'setup',
      title: 'Setup',
      minutes: 3,
      kind: 'info',
      detail: 'Yoshimitsu against a dummy in Practice mode, frame display on. Set the dummy to block and record as each step asks.',
    },
    {
      id: 'execution',
      title: 'Execution',
      minutes: 12,
      kind: 'drills',
      detail: 'Stance entries (5 attempts each), the beginner combo after df+2 (10 attempts), the bread-and-butter combo (10 attempts), then clean 1+4 and b+3 (10 each). Log successes after each set.',
      tasks: [
        ...STANCE_TASKS,
        { id: 'exec-beginner', label: 'Beginner combo after df+2', input: 'df+2', attempts: 10, drillId: 'd3-beginner-combo', nodeId: 'n3-combos', side: 'p1' },
        { id: 'exec-bnb', label: 'Bread-and-butter combo', input: 'df+2', attempts: 10, drillId: 'd3-bnb', nodeId: 'n3-combos', side: 'p1' },
        { id: 'exec-flash', label: 'Clean 1+4 (Flash)', input: '1+4', attempts: 10, drillId: 'd3-core', nodeId: 'n3-core' },
        { id: 'exec-spin', label: 'Clean b+3 (Manji Spin)', input: 'b+3', attempts: 10, drillId: 'd3-core', nodeId: 'n3-core' },
      ],
    },
    {
      id: 'punish-quiz',
      title: 'Punish sense',
      minutes: 10,
      kind: 'punish-quiz',
      detail: 'A 20-question punish quiz from −6 to −18 in both postures, then 10 reps of Punishment Training. Answer with Yoshimitsu’s best punisher for each blocked value.',
      drillId: 'd1-punish-ladder',
      nodeId: 'n1-punish',
    },
    {
      id: 'throw-quiz',
      title: 'Throw breaks',
      minutes: 5,
      kind: 'throw-quiz',
      detail: '20 throws in a fixed random order. Break each with 1 or 2: left hand forward breaks with 1, right with 2. Never break with 1+2 against a generic throw.',
    },
    {
      id: 'notation-quiz',
      title: 'Notation',
      minutes: 3,
      kind: 'notation-quiz',
      detail: 'A 10-question quiz: read each input in Wavu notation and choose what it means.',
    },
    {
      id: 'matches',
      title: 'Matches',
      minutes: 15,
      kind: 'matches',
      detail: 'Play 10 games and log them with tallies. Replay review of 3 games is optional.',
    },
    {
      id: 'ext-stage2',
      title: 'Extension: Stage 2 test',
      minutes: 15,
      kind: 'extensions',
      detail: 'Whiff punish and sidestep, 10 reps each. Offered only when the Stage 1 gate passes on the data so far.',
      extension: true,
      stageId: 'stage-2',
      tasks: [
        { id: 'ext-whiff', label: 'Whiff punish', input: 'df+2', attempts: 10, drillId: 'd2-whiff', nodeId: 'n2-whiff' },
        { id: 'ext-sidestep', label: 'Sidestep a linear move', input: 'SS', attempts: 10, drillId: 'd2-sidestep', nodeId: 'n2-sidestep' },
      ],
    },
    {
      id: 'ext-stage3',
      title: 'Extension: Stage 3 test',
      minutes: 15,
      kind: 'extensions',
      detail: 'Bread-and-butter combo on both sides and the Yoshimitsu punish ladder. Offered only after the Stage 2 extension.',
      extension: true,
      stageId: 'stage-3',
      tasks: [
        { id: 'ext-bnb-p1', label: 'Bread-and-butter combo, P1 side', input: 'df+2', attempts: 10, drillId: 'd3-bnb', nodeId: 'n3-combos', side: 'p1' },
        { id: 'ext-bnb-p2', label: 'Bread-and-butter combo, P2 side', input: 'df+2', attempts: 10, drillId: 'd3-bnb', nodeId: 'n3-combos', side: 'p2' },
        { id: 'ext-ladder', label: 'Yoshimitsu punish ladder', input: '1,1', attempts: 10, drillId: 'd3-punish-yoshi', nodeId: 'n3-punish' },
      ],
    },
  ];
}

export function coreSteps(): BaselineStep[] {
  return baselineSteps().filter((step) => step.extension !== true);
}

export function extensionSteps(): BaselineStep[] {
  return baselineSteps().filter((step) => step.extension === true);
}

/** Core protocol minutes (setup 3 + execution 12 + punish 10 + throws 5 + notation 3 + matches 15 = 48). */
export function coreMinutes(): number {
  return coreSteps().reduce((sum, step) => sum + step.minutes, 0);
}

// --- Quiz builders (pack-derived; no invented frame data) -------------------

function rotateOptions(options: string[], index: number): string[] {
  if (options.length === 0) return options;
  const shift = index % options.length;
  return [...options.slice(shift), ...options.slice(0, shift)];
}

/**
 * The 20-question punish quiz (§11.5): block values −6 to −18, both
 * postures, Heat off, plus the two Heat-active −18 questions (the only
 * Heat-only punisher row). Fixed order; the correct answer is always
 * bestPunisher for that question. Distractors are other real punisher
 * inputs from the pack.
 */
export function buildPunishQuestions(punishers: Punisher[] = loadPunishers()): PunishQuizQuestion[] {
  const combos: Array<{ blockValue: number; posture: PunishPosture; heatActive: boolean }> = [];
  for (const blockValue of [-6, -8, -10, -11, -13, -14, -15, -17, -18]) {
    for (const posture of ['standing', 'crouching'] as const) {
      combos.push({ blockValue, posture, heatActive: false });
    }
  }
  combos.push({ blockValue: -18, posture: 'standing', heatActive: true });
  combos.push({ blockValue: -18, posture: 'crouching', heatActive: true });

  const uniqueInputs = [...new Set(punishers.map((row) => row.input))];
  const questions: PunishQuizQuestion[] = [];
  combos.forEach((combo, index) => {
    const best = bestPunisher(combo.blockValue, combo.posture, combo.heatActive, punishers);
    if (best === null) return;
    const distractors = uniqueInputs.filter((input) => input !== best.input).slice(0, 3);
    const options = rotateOptions([best.input, ...distractors], index);
    questions.push({
      kind: 'punish',
      id: `punish-${combo.blockValue}-${combo.posture}-${combo.heatActive ? 'heat' : 'noheat'}`,
      blockValue: combo.blockValue,
      posture: combo.posture,
      heatActive: combo.heatActive,
      options,
      correctInput: best.input,
    });
  });
  return questions;
}

/**
 * The 10-question notation quiz (§11.5): "What does X mean?" with the
 * spoken label (src/domain/notation/speak.ts) as the answer and three
 * other moves' spoken labels as distractors. Deterministic for a given
 * seed: the same session always sees the same questions.
 */
export function buildNotationQuestions(
  moves: Move[] = loadMovesYoshimitsu(),
  seed: number = hashSeed('baseline-notation'),
): NotationQuizQuestion[] {
  const rng = mulberry32(seed);
  const shuffled = [...moves];
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = shuffled[i] as Move;
    shuffled[i] = shuffled[j] as Move;
    shuffled[j] = tmp;
  }
  const labeled = shuffled
    .map((move) => ({ input: move.input, label: spokenLabel(move.input) }))
    .filter((entry) => entry.label !== '' && entry.label.toLowerCase() !== entry.input.toLowerCase());
  const picked: Array<{ input: string; label: string }> = [];
  const seenLabels = new Set<string>();
  for (const entry of labeled) {
    if (picked.length >= 10) break;
    if (seenLabels.has(entry.label)) continue;
    seenLabels.add(entry.label);
    picked.push(entry);
  }
  const labelPool = labeled.map((entry) => entry.label);
  return picked.map((entry, index) => {
    const distractors: string[] = [];
    for (const label of labelPool) {
      if (distractors.length >= 3) break;
      if (label !== entry.label && !distractors.includes(label)) distractors.push(label);
    }
    return {
      kind: 'notation',
      id: `notation-${index}`,
      input: entry.input,
      options: rotateOptions([entry.label, ...distractors], index),
      correctLabel: entry.label,
    };
  });
}

/**
 * The 20-throw sequence (§11.5): deterministic for a given seed (the
 * session start time, via hashSeed). Throws are the two generic throws
 * from d1-throw-breaks; the break button matches the throwing hand.
 */
export function buildThrowSequence(seed: number, count = 20): ThrowPrompt[] {
  const rng = mulberry32(seed);
  return Array.from({ length: count }, () =>
    rng() < 0.5 ? { throwInput: '1+3', breakInput: '1' } : { throwInput: '2+4', breakInput: '2' },
  );
}

// --- Session builder / resume -----------------------------------------------

function blockKindFor(step: BaselineStep): SessionBlock['kind'] {
  switch (step.kind) {
    case 'info': return 'warmup';
    case 'drills': return 'drill';
    case 'extensions': return 'drill';
    case 'matches': return 'application';
    default: return 'review';
  }
}

function blockForStep(step: BaselineStep, index: number, nowIso: string): SessionBlock {
  return {
    id: `block-${step.id}`,
    kind: blockKindFor(step),
    ...(step.drillId !== undefined ? { drillId: step.drillId } : {}),
    minutes: step.minutes,
    reason: step.title,
    ...(index === 0 ? { startedAt: nowIso } : {}),
  };
}

/** Create a 'baseline' Session with one block per core step (48 minutes). */
export async function buildBaselineSession(nowIso: string): Promise<Session> {
  const steps = coreSteps();
  const session: Session = {
    id: `session-baseline-${Date.parse(nowIso)}`,
    kind: 'baseline',
    startedAt: nowIso,
    status: 'active',
    plannedMinutes: coreMinutes(),
    blocks: steps.map((step, index) => blockForStep(step, index, nowIso)),
    currentBlock: 0,
    pausedMs: 0,
  };
  return sessionsRepo.put(session);
}

/** The resumable baseline session: the newest active/paused 'baseline' session, if any. */
export async function getLatestBaselineSession(): Promise<Session | undefined> {
  const sessions = await sessionsRepo.all();
  return sessions.find((session) => session.kind === 'baseline' && (session.status === 'active' || session.status === 'paused'));
}

export function isStepComplete(session: Session, stepId: string): boolean {
  return session.blocks.find((block) => block.id === `block-${stepId}`)?.endedAt !== undefined;
}

/** Mark one step's block complete (endedAt). Quiz/match steps complete when their results are written. */
export async function markStepComplete(session: Session, stepId: string, nowIso: string): Promise<Session> {
  const blocks = session.blocks.map((block) =>
    block.id === `block-${stepId}` ? { ...block, endedAt: nowIso } : block,
  );
  const updated: Session = { ...session, blocks };
  return sessionsRepo.put(updated);
}

/** Append extension blocks to a session that does not have them yet. */
export async function appendExtensionBlocks(session: Session, nowIso: string): Promise<Session> {
  const existing = new Set(session.blocks.map((block) => block.id));
  const additions = extensionSteps()
    .filter((step) => !existing.has(`block-${step.id}`))
    .map((step, index) => blockForStep(step, session.blocks.length + index, nowIso));
  if (additions.length === 0) return session;
  const updated: Session = { ...session, blocks: [...session.blocks, ...additions] };
  return sessionsRepo.put(updated);
}

// --- Quiz results ------------------------------------------------------------

/**
 * Write ONE Assessment row per completed quiz (spec §5.2: baseline
 * blocks write Assessment records). placementStage is 0: these rows
 * are quiz evidence, not placement results; they are recognised by
 * their QUIZ_RESULT_KEYS result keys. Half-credit punish answers
 * (valid but not best, §5.10) count as 0.5 correct.
 */
export async function writeQuizAssessment(
  kind: 'punish' | 'notation' | 'throw',
  correct: number,
  total: number,
  nowIso: string,
): Promise<Assessment> {
  const keys = kind === 'punish'
    ? { correctKey: QUIZ_RESULT_KEYS.punishCorrect, totalKey: QUIZ_RESULT_KEYS.punishTotal }
    : kind === 'notation'
      ? { correctKey: QUIZ_RESULT_KEYS.notationCorrect, totalKey: QUIZ_RESULT_KEYS.notationTotal }
      : { correctKey: QUIZ_RESULT_KEYS.throwCorrect, totalKey: QUIZ_RESULT_KEYS.throwTotal };
  const assessment: Assessment = {
    id: `assessment-quiz-${kind}-${Date.parse(nowIso)}-${Math.floor(Math.random() * 1_000_000)}`,
    at: nowIso,
    results: { [keys.correctKey]: correct, [keys.totalKey]: total },
    placementStage: 0,
  };
  return assessmentsRepo.put(assessment);
}

// --- Extension gating -------------------------------------------------------

/** Pure predicate: are extensions offered on this Stage 1 gate evidence? */
export function extensionsOfferedFor(evidence: GateEvidence, gate: GateDefinition): boolean {
  return evaluateGate(placementGate(gate), evidence).passed;
}

/** Extensions are offered only when the Stage 1 gate passes on the data so far (§11.5). */
export async function stage1GatePasses(): Promise<boolean> {
  const curriculum = loadCurriculum();
  const stage = curriculum.stages.find((s) => s.id === 'stage-1');
  if (stage === undefined) return false;
  const evidence = await gateEvidenceForStage(stage.id);
  return extensionsOfferedFor(evidence, stage.gate);
}

/** Games logged on a calendar day (the match-log form's day), for the matches step. */
export async function gamesLoggedOn(day: string): Promise<number> {
  const sets = await matchSetsRepo.allByDay(day);
  return sets.reduce((sum, set) => sum + set.games, 0);
}

export function todayDayString(now: Date = new Date()): string {
  return format(now, 'yyyy-MM-dd');
}
