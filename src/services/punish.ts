// Punish Trainer services — spec §5.10 / §10.7. All frame data comes from the
// bundled punisher pack; nothing here invents a row. The answer rule lives in
// src/domain/engine/punish.ts (bestPunisher / isEligible / scoreAnswer) and is
// never re-implemented here.
//
// RULE/TABLE TENSION (see also tests/unit/engine/punish.spec.ts header): §5.10
// makes every row whose enemy value is b or less negative eligible, so e.g.
// NSS.1+4 (enemy -8, combo 67) is the §5.10 best answer at -8..-14 standing,
// ahead of the per-rung rows §10.7 lists (df+1,4 at -13, b+2,2 at -14).
// This service follows the §5.10 rule everywhere, as the engine does.
import {
  bestPunisher, isEligible, scoreAnswer,
  type PunishPosture, type PunisherRow,
} from '../domain/engine/punish';
import { hashSeed, mulberry32 } from '../domain/engine/prng';
import { loadPunishers } from '../data/packs';
import type { Move, ProblemMove, Punisher } from '../data/schemas';

export type { PunishPosture };

/** Display a block value with a typographic minus, e.g. -13 -> "−13". */
export function blockLabel(blockValue: number): string {
  return String(blockValue).replace(/-/g, '−');
}

/** Map the bundled punisher pack onto engine rows. heatEngager is derived
 * from the row notes by the engine; the pack carries no separate field. */
export function rowsFromPack(punishers: Punisher[]): PunisherRow[] {
  return punishers.map((row) => ({
    posture: row.posture,
    enemy: row.enemy,
    moveId: row.moveId,
    input: row.input,
    damage: row.damage,
    ...(row.comboDamage !== undefined ? { comboDamage: row.comboDamage } : {}),
    onHit: row.onHit,
    onBlock: row.onBlock,
    heatOnly: row.heatOnly,
    ...(row.notes !== undefined ? { notes: row.notes } : {}),
  }));
}

/** Effective damage under the §5.10 rule: combo damage where present. */
function effectiveDamage(row: PunisherRow): number {
  return row.comboDamage ?? row.damage;
}

/** "Better frames on hit": the first signed number in the on-hit value;
 * a launcher counts as +1000. Mirrors the engine's ordering for distractor
 * ranking (comparePunishers is private to the engine). */
function onHitFrames(row: PunisherRow): number {
  if (/launch/i.test(row.onHit)) return 1000;
  const match = /[+-]?\d+/.exec(row.onHit);
  return match === null ? Number.NEGATIVE_INFINITY : Number(match[0]);
}

/** The best punisher for one block value / posture / Heat state, from pack
 * rows. Thin wrapper over the engine so screens never import engine code. */
export function bestPunisherFor(
  blockValue: number,
  posture: PunishPosture,
  heatActive: boolean,
  punishers: Punisher[],
): PunisherRow | null {
  return bestPunisher(blockValue, posture, heatActive, rowsFromPack(punishers));
}

/** The best row for one ladder rung (an enemy value present in the pack),
 * evaluated by the §5.10 rule at that value with Heat off. Centralised so
 * the ladder, the cards and the quiz all share one selection rule. */
export function bestRowForEnemyValue(
  rows: PunisherRow[],
  enemy: number,
  posture: PunishPosture,
): PunisherRow | null {
  return bestPunisher(enemy, posture, false, rows);
}

// ---------- PunishLadder model ----------

/** One PunishLadder cell: structurally identical to the component's
 * Punisher prop ({notation, damage?, result?}). */
export interface LadderCell {
  notation: string;
  damage?: number;
  result?: string;
}

export type LadderModel = Partial<
  Record<number, { standing?: LadderCell; crouching?: LadderCell }>
>;

function toCell(row: PunisherRow | null): LadderCell | undefined {
  if (row === null) return undefined;
  return {
    notation: row.input,
    damage: effectiveDamage(row),
    result: row.onHit,
  };
}

/**
 * The PunishLadder props map: for every enemy value from -6 to -18 present
 * in the pack, the best (§5.10) row per posture, Heat off. Rungs with no
 * eligible row are omitted; the component renders its "No punisher listed"
 * cell for them. The quiz also asks -19/-20, which have no pack row: those
 * rungs carry the best eligible row at that block value (the same §5.10
 * rule the quiz explanation uses), so every quiz question has a rung to
 * highlight.
 */
export function ladderModel(punishers: Punisher[]): LadderModel {
  const rows = rowsFromPack(punishers);
  const enemies = [...new Set(rows.map((row) => row.enemy))]
    .filter((enemy) => enemy >= -18 && enemy <= -6)
    .sort((a, b) => a - b);
  const model: LadderModel = {};
  for (const enemy of enemies) {
    const standing = toCell(bestRowForEnemyValue(rows, enemy, 'standing'));
    const crouching = toCell(bestRowForEnemyValue(rows, enemy, 'crouching'));
    model[enemy] = {
      ...(standing !== undefined ? { standing } : {}),
      ...(crouching !== undefined ? { crouching } : {}),
    };
  }
  for (const enemy of [-19, -20]) {
    const standing = toCell(bestPunisher(enemy, 'standing', false, rows));
    const crouching = toCell(bestPunisher(enemy, 'crouching', false, rows));
    if (standing !== undefined || crouching !== undefined) {
      model[enemy] = {
        ...(standing !== undefined ? { standing } : {}),
        ...(crouching !== undefined ? { crouching } : {}),
      };
    }
  }
  return model;
}

// ---------- Quiz option building ----------

/**
 * Four options for a question: the best punisher first in source order,
 * then distractors — eligible lower-damage rows first (closest damage
 * first), then ineligible near-misses (closest enemy value first).
 * Heat-only rows never appear as options when Heat is off: they can never
 * be the answer there, so they would be a trap, not a near-miss.
 * Options are distinct inputs, shuffled deterministically with `rng`.
 */
export function buildOptions(
  rows: PunisherRow[],
  blockValue: number,
  posture: PunishPosture,
  heatActive: boolean,
  rng: () => number,
): string[] {
  const best = bestPunisher(blockValue, posture, heatActive, rows);
  if (best === null) return [];
  const seen = new Set<string>([best.input]);
  const eligible: PunisherRow[] = [];
  const nearMisses: PunisherRow[] = [];
  for (const row of rows) {
    if (row.posture !== posture) continue;
    if (row.heatOnly && !heatActive) continue;
    if (row === best) continue;
    if (isEligible(row, blockValue, posture, heatActive)) {
      eligible.push(row);
    } else {
      nearMisses.push(row);
    }
  }
  eligible.sort(
    (a, b) =>
      effectiveDamage(b) - effectiveDamage(a) || onHitFrames(b) - onHitFrames(a),
  );
  nearMisses.sort(
    (a, b) =>
      Math.abs(a.enemy - blockValue) - Math.abs(b.enemy - blockValue) ||
      effectiveDamage(b) - effectiveDamage(a),
  );
  const options: string[] = [best.input];
  const take = (pool: PunisherRow[]): void => {
    for (const row of pool) {
      if (options.length >= 4) return;
      if (seen.has(row.input)) continue;
      seen.add(row.input);
      options.push(row.input);
    }
  };
  take(eligible);
  take(nearMisses);
  if (options.length < 4) {
    // Defensive fallback (the bundled pack always yields 4): any remaining
    // distinct input, so the question still has four options.
    for (const row of rows) {
      if (options.length >= 4) break;
      if (seen.has(row.input)) continue;
      seen.add(row.input);
      options.push(row.input);
    }
  }
  // Fisher-Yates shuffle with the caller's seeded RNG.
  for (let i = options.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = options[i] as string;
    options[i] = options[j] as string;
    options[j] = tmp;
  }
  return options;
}

/** Deterministic in-place shuffle driven by a seeded RNG. */
function shuffleInPlace<T>(items: T[], rng: () => number): T[] {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = items[i] as T;
    items[i] = items[j] as T;
    items[j] = tmp;
  }
  return items;
}

// ---------- Ladder quiz ----------

export interface LadderQuestion {
  id: string;
  blockValue: number;
  posture: PunishPosture;
  heatActive: boolean;
  options: string[];
  correctInput: string;
}

function ladderQuestionId(
  blockValue: number,
  posture: PunishPosture,
  heatActive: boolean,
): string {
  return `ladder-${blockValue}-${posture}-${heatActive ? 'heat' : 'noheat'}`;
}

/**
 * Ladder quiz: block values -6..-20 x both postures, Heat off, plus Heat-on
 * variants for the values at which a Heat-only row is eligible (enemy -18,
 * so block values -18..-20). Question order and option order are
 * deterministic for a seed (mulberry32). Questions with no eligible
 * punisher are skipped (none in the bundled pack).
 */
export function buildLadderQuestions(
  punishers: Punisher[],
  seed: number,
): LadderQuestion[] {
  const rows = rowsFromPack(punishers);
  const rng = mulberry32(seed);
  const questions: LadderQuestion[] = [];
  const heatOnlyEnemies = rows.filter((row) => row.heatOnly).map((row) => row.enemy);
  for (let blockValue = -6; blockValue >= -20; blockValue -= 1) {
    for (const posture of ['standing', 'crouching'] as const) {
      const heatVariants = [false];
      if (heatOnlyEnemies.some((enemy) => enemy >= blockValue)) heatVariants.push(true);
      for (const heatActive of heatVariants) {
        const best = bestPunisher(blockValue, posture, heatActive, rows);
        if (best === null) continue;
        const options = buildOptions(rows, blockValue, posture, heatActive, rng);
        if (options.length === 0) continue;
        questions.push({
          id: ladderQuestionId(blockValue, posture, heatActive),
          blockValue,
          posture,
          heatActive,
          options,
          correctInput: best.input,
        });
      }
    }
  }
  return shuffleInPlace(questions, rng);
}

/** Score a ladder-quiz answer (1 / 0.5 / 0) with the engine's reason. */
export function scoreLadderAnswer(
  question: LadderQuestion,
  punishers: Punisher[],
  answerInput: string,
): { score: 0 | 0.5 | 1; best: PunisherRow | null; reason: string } {
  const result = scoreAnswer(
    question.blockValue,
    question.posture,
    question.heatActive,
    rowsFromPack(punishers),
    answerInput,
  );
  return { score: result.score, best: result.best, reason: result.reason };
}

/** The explanation shown after a ladder question, with the ladder rung
 * highlighted. The best row is re-derived from the pack, never hard-coded. */
export function ladderExplanation(
  question: LadderQuestion,
  punishers: Punisher[],
): { best: PunisherRow | null; text: string } {
  const best = bestPunisherFor(
    question.blockValue,
    question.posture,
    question.heatActive,
    punishers,
  );
  if (best === null) {
    return { best, text: 'No punisher in the pack for this block value and posture.' };
  }
  const damage = effectiveDamage(best);
  const heatNote = question.heatActive ? ' Heat is active, so Heat-only punishers count.' : '';
  return {
    best,
    text:
      `Best punisher: ${best.input} (${damage} damage, ${best.onHit} on hit).` +
      ` It is eligible at ${blockLabel(question.blockValue)} ${question.posture}.` +
      heatNote,
  };
}

/** Question text for a ladder question, as shown in the quiz. */
export function ladderQuestionText(question: LadderQuestion): string {
  const postureText = question.posture === 'standing' ? 'You are standing.' : 'You blocked a low and are crouching.';
  const heatText = question.heatActive ? ' Heat is active.' : '';
  return `The opponent's move is ${blockLabel(question.blockValue)} on block. ${postureText}${heatText} Best punisher?`;
}

// ---------- Character quiz ----------

export interface CharacterQuestion {
  id: string;
  kind: 'move' | 'problem' | 'bonus';
  character: string;
  /** The opponent's move input ('' for bonus questions). */
  moveInput: string;
  moveName?: string;
  /** Worst-case block value from the pack (null for problem-move questions). */
  blockValue: number | null;
  posture: PunishPosture;
  /** Option labels: notation inputs for move/bonus questions, answer text
   * for problem-move questions. */
  options: string[];
  correctInput: string;
  explanation: string;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Posture for a character-quiz question: crouching when the move's last
 * hit level is low (hitLevel split on ',', last token starting with 'l'),
 * else standing (§5.10 brief rule). */
export function postureForMove(move: Move): PunishPosture {
  const parts = move.hitLevel
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part !== '');
  const last = parts[parts.length - 1];
  return last !== undefined && last.toLowerCase().startsWith('l') ? 'crouching' : 'standing';
}

function moveExplanation(
  blockValue: number,
  posture: PunishPosture,
  best: PunisherRow | null,
): string {
  if (best === null) return 'No punisher in the pack for this block value and posture.';
  return (
    `Best punisher: ${best.input} (${effectiveDamage(best)} damage, ${best.onHit} on hit).` +
    ` It is eligible at ${blockLabel(blockValue)} ${posture}.`
  );
}

const BONUS_BLOCK_VALUES = [-6, -7, -8, -9] as const;
const FLASH_INPUT = '1+4';

/**
 * Bonus-round questions: moves at -6..-9, whose correct answer is Flash
 * (1+4). Most characters cannot punish these; Yoshimitsu can. Where the
 * §5.10 best row is the NSS Flash (NSS.1+4, -8/-9 standing), the
 * explanation names it as the higher-damage NSS variant from the pack.
 */
function bonusQuestions(
  punishers: Punisher[],
  character: string,
  rng: () => number,
): CharacterQuestion[] {
  const rows = rowsFromPack(punishers);
  const questions: CharacterQuestion[] = [];
  for (const blockValue of BONUS_BLOCK_VALUES) {
    for (const posture of ['standing', 'crouching'] as const) {
      const best = bestPunisher(blockValue, posture, false, rows);
      const options = buildOptions(rows, blockValue, posture, false, rng);
      if (!options.includes(FLASH_INPUT)) {
        // Flash must be an option: swap it in for the last option.
        if (options.length > 0) options[options.length - 1] = FLASH_INPUT;
        else continue;
      }
      const nssNote =
        best !== null && best.input === 'NSS.1+4'
          ? ' From No Sword Stance, NSS.1+4 deals even more damage.'
          : '';
      questions.push({
        id: `char-${slugify(character)}-bonus-${blockValue}-${posture}`,
        kind: 'bonus',
        character,
        moveInput: '',
        blockValue,
        posture,
        options,
        correctInput: FLASH_INPUT,
        explanation:
          `Most characters cannot punish ${blockLabel(blockValue)} on block, but Yoshimitsu can: ` +
          `Flash (${FLASH_INPUT}) is fast enough.${nssNote}`,
      });
    }
  }
  return questions;
}

function problemQuestions(
  problemMoves: ProblemMove[],
  character: string,
  rng: () => number,
): CharacterQuestion[] {
  const own = problemMoves.filter((pm) => pm.character === character);
  const allAnswers = [...new Set(own.map((pm) => pm.answer.detail))];
  const questions: CharacterQuestion[] = own.map((pm) => {
    const others = allAnswers.filter((answer) => answer !== pm.answer.detail);
    const options = shuffleInPlace(
      [pm.answer.detail, ...others.slice(0, 3)],
      rng,
    );
    return {
      id: `char-${slugify(character)}-problem-${slugify(pm.input)}-${slugify(pm.id)}`,
      kind: 'problem',
      character,
      moveInput: pm.input,
      blockValue: null,
      posture: 'standing',
      options,
      correctInput: pm.answer.detail,
      explanation: pm.answer.detail,
    };
  });
  return shuffleInPlace(questions, rng);
}

/**
 * Character quiz. From a cached pack: one question per punishable move
 * (blockMin <= -6, worst-case block value = blockMin), capped at 20
 * questions per session (the §11.5 baseline uses a 20-question punish
 * quiz) in deterministic seeded order, plus the Flash bonus round. With
 * no pack moves, questions come from the character's problem moves
 * (their input + answer), without a bonus round. Heat is always off.
 */
export function buildCharacterQuestions(
  moves: Move[],
  problemMoves: ProblemMove[],
  seed: number,
  character: string,
): CharacterQuestion[] {
  const punishers = loadPunishers();
  const rows = rowsFromPack(punishers);
  const rng = mulberry32(seed);
  if (moves.length === 0) {
    return problemQuestions(problemMoves, character, rng);
  }
  const qualifying = moves.filter(
    (move) => move.blockMin !== undefined && move.blockMin <= -6,
  );
  const questions: CharacterQuestion[] = qualifying.map((move) => {
    const blockValue = move.blockMin as number;
    const posture = postureForMove(move);
    const best = bestPunisher(blockValue, posture, false, rows);
    const options = buildOptions(rows, blockValue, posture, false, rng);
    return {
      id: `char-${slugify(character)}-${slugify(move.id)}`,
      kind: 'move',
      character,
      moveInput: move.input,
      ...(move.name !== undefined ? { moveName: move.name } : {}),
      blockValue,
      posture,
      options,
      correctInput: best !== null ? best.input : '',
      explanation: moveExplanation(blockValue, posture, best),
    };
  });
  const shuffled = shuffleInPlace(
    questions.filter((q) => q.correctInput !== '' && q.options.length > 0),
    rng,
  );
  const capped = shuffled.slice(0, 20);
  return [...capped, ...bonusQuestions(punishers, character, rng)];
}

/** Question text for a character-quiz question, as shown in the quiz. */
export function characterQuestionText(question: CharacterQuestion): string {
  if (question.kind === 'bonus') {
    const postureText =
      question.posture === 'standing' ? 'You are standing.' : 'You blocked a low and are crouching.';
    return `Bonus round: the opponent's move is ${blockLabel(question.blockValue ?? -6)} on block. ${postureText} Best punisher?`;
  }
  if (question.kind === 'problem') {
    return `${question.character}'s ${question.moveInput}: what do you do?`;
  }
  const postureText =
    question.posture === 'standing' ? 'You are standing.' : 'You blocked a low and are crouching.';
  const nameText = question.moveName !== undefined ? ` (${question.moveName})` : '';
  return `${question.character}'s ${question.moveInput}${nameText} is ${blockLabel(question.blockValue ?? 0)} on block. ${postureText} Best punisher?`;
}

// ---------- Lab routine ----------

/** The curriculum drill for punish Lab routines: 'd1-punish-ladder'
 * (verified present in curriculum.json; node n1-punish's first drill).
 * Crouching routines use its sibling 'd1-punish-crouch'. */
export function punishDrillId(posture: PunishPosture): string {
  return posture === 'crouching' ? 'd1-punish-crouch' : 'd1-punish-ladder';
}

export interface LabRoutine {
  title: string;
  recipe: string[];
  steps: string[];
  best: PunisherRow | null;
  bestInput: string | null;
}

/**
 * A Practice-mode recipe for one block value / posture. The best punisher
 * is computed from the pack; the screen logs sets through the existing Lab
 * session flow (createCustomSession with punishDrillId(posture)).
 */
export function punishLabRoutine(
  moveInput: string,
  blockValue: number,
  posture: PunishPosture,
): LabRoutine {
  const best = bestPunisherFor(blockValue, posture, false, loadPunishers());
  const title = `Punish ${moveInput} (${blockLabel(blockValue)} on block)`;
  if (best === null) {
    return {
      title,
      recipe: [`Record the dummy doing ${moveInput}, block it, and check the pack for a punisher.`],
      steps: ['No punisher in the pack for this block value and posture.'],
      best,
      bestInput: null,
    };
  }
  return {
    title,
    recipe: [`Record the dummy doing ${moveInput}, block it, punish with ${best.input}`],
    steps: [
      `In Practice mode, record the dummy doing ${moveInput}.`,
      `Block the move, then punish with ${best.input} (${effectiveDamage(best)} damage, ${best.onHit} on hit).`,
      'Repeat: block, then punish. Log each set in the Lab runner.',
    ],
    best,
    bestInput: best.input,
  };
}

/** Seed helper for screens: a stable seed for one day's quiz ordering. */
export function quizSeed(label: string, day: string): number {
  return hashSeed(`${label}-${day}`);
}
