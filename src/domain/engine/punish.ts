// Spec §5.10 — punish answer rule. Fully data-driven: punisher rows are passed
// in, never hard-coded here. The §10.7 table is the caller's data.

export type PunishPosture = 'standing' | 'crouching';

export interface PunisherRow {
  posture: PunishPosture;
  /** Enemy threshold: usable when the opponent is at this value or worse (§6.4). */
  enemy: number;
  moveId: string;
  input: string;
  damage: number;
  comboDamage?: number;
  onHit: string;
  onBlock: string;
  heatOnly: boolean;
  heatEngager?: boolean;
  notes?: string;
}

function isHeatEngager(row: PunisherRow): boolean {
  return row.heatEngager === true || /heat engager/i.test(row.notes ?? '');
}

function effectiveDamage(row: PunisherRow): number {
  return row.comboDamage ?? row.damage;
}

/** "Better frames on hit": the first signed number in the on-hit value. */
function onHitFrames(row: PunisherRow): number {
  if (/launch/i.test(row.onHit)) return 1000;
  const match = /[+-]?\d+/.exec(row.onHit);
  return match === null ? Number.NEGATIVE_INFINITY : Number(match[0]);
}

/**
 * A row is eligible when its posture matches, it is not Heat-only (or Heat
 * is active), and its enemy value is `b` or less negative — enemy >= b
 * numerically, e.g. b = -13 admits enemy -13, -11 and -10, but not -14.
 */
export function isEligible(
  row: PunisherRow,
  b: number,
  posture: PunishPosture,
  heatActive: boolean,
): boolean {
  if (row.posture !== posture) return false;
  if (row.heatOnly && !heatActive) return false;
  return row.enemy >= b;
}

function comparePunishers(a: PunisherRow, b: PunisherRow): number {
  const damageDiff = effectiveDamage(b) - effectiveDamage(a);
  if (damageDiff !== 0) return damageDiff;
  const framesDiff = onHitFrames(b) - onHitFrames(a);
  if (framesDiff !== 0) return framesDiff;
  const aEngager = isHeatEngager(a) ? 1 : 0;
  const bEngager = isHeatEngager(b) ? 1 : 0;
  return bEngager - aEngager;
}

/** The best eligible punisher, or null when nothing is eligible. */
export function bestPunisher(
  b: number,
  posture: PunishPosture,
  heatActive: boolean,
  punishers: PunisherRow[],
): PunisherRow | null {
  const eligible = punishers.filter((row) => isEligible(row, b, posture, heatActive));
  if (eligible.length === 0) return null;
  // Array.sort is stable: exact ties keep input order, so results are deterministic.
  return [...eligible].sort(comparePunishers)[0] ?? null;
}

function normaliseInput(input: string): string {
  return input.replace(/\s+/g, '').toLowerCase();
}

export interface AnswerScore {
  /** 1 = best answer, 0.5 = valid but lower-damage punisher, 0 = anything else. */
  score: 0 | 0.5 | 1;
  best: PunisherRow | null;
  /** The row the answer matched, when it matched any row at all. */
  matched: PunisherRow | null;
  reason: string;
}

/**
 * Score a quiz answer. A valid but lower-damage punisher earns half credit.
 * The answer matches a row by its input (whitespace-insensitive) or move id.
 */
export function scoreAnswer(
  b: number,
  posture: PunishPosture,
  heatActive: boolean,
  punishers: PunisherRow[],
  answerInput: string,
): AnswerScore {
  const best = bestPunisher(b, posture, heatActive, punishers);
  const wanted = normaliseInput(answerInput);
  const candidates = punishers.filter(
    (row) => normaliseInput(row.input) === wanted || normaliseInput(row.moveId) === wanted,
  );
  // When several rows share an input (e.g. a standing/crouching Heat Smash
  // pair), prefer the one eligible for this question.
  const matched =
    candidates.find((row) => isEligible(row, b, posture, heatActive)) ?? candidates[0] ?? null;
  if (matched !== null && best !== null && matched === best) {
    return { score: 1, best, matched, reason: 'Best punisher.' };
  }
  if (matched !== null && isEligible(matched, b, posture, heatActive)) {
    const bestInput = best !== null ? best.input : 'none';
    return {
      score: 0.5,
      best,
      matched,
      reason: `Valid punisher, but ${bestInput} deals more damage.`,
    };
  }
  return {
    score: 0,
    best,
    matched,
    reason: `Not a punisher for ${b} ${posture}${heatActive ? ' with Heat active' : ''}.`,
  };
}

export interface AnswerKeyRow {
  blockValue: number;
  posture: PunishPosture;
  heatActive: boolean;
  best: PunisherRow | null;
  bestInput: string | null;
}

/**
 * The full answer key: block values -6 to -20, both postures, Heat on and off.
 * Ordered by block value (-6 first), then posture (standing, crouching),
 * then Heat off, Heat on.
 */
export function answerKeyTable(punishers: PunisherRow[]): AnswerKeyRow[] {
  const rows: AnswerKeyRow[] = [];
  for (let b = -6; b >= -20; b -= 1) {
    for (const posture of ['standing', 'crouching'] as const) {
      for (const heatActive of [false, true]) {
        const best = bestPunisher(b, posture, heatActive, punishers);
        rows.push({
          blockValue: b,
          posture,
          heatActive,
          best,
          bestInput: best !== null ? best.input : null,
        });
      }
    }
  }
  return rows;
}
