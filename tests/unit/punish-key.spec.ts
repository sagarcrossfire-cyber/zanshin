// AC-PUN-1 — the answer key matches §10.7 / §5.10 for every block value
// -6..-20, standing and crouching, Heat on and off (60 cells). The
// ordering is re-derived independently in this test from the §5.10 text
// (effective damage, then on-hit frames, then Heat Engager); it does not
// import comparePunishers, which is private to the engine.
//
// PINNED ANCHORS — note on the brief's "-13 standing -> b+2,2" anchor:
// it cannot hold. b+2,2 has enemy -14, so isEligible(-13) is false for
// it, and the §5.10 rule makes NSS.1+4 (combo 67) the best answer at
// -13 standing. The existing engine test pins the same (cell(-13) =
// NSS.1+4) and documents the rule/table tension. This file pins NSS.1+4
// at -13 and flags the brief anchor as wrong in the build report.
import { describe, expect, it } from 'vitest';
import {
  bestPunisher, isEligible, type PunisherRow,
} from '../../src/domain/engine/punish';
import {
  buildCharacterQuestions, buildLadderQuestions, characterQuestionText,
  ladderModel, postureForMove, punishDrillId, punishLabRoutine,
  rowsFromPack,
} from '../../src/services/punish';
import { loadCurriculum, loadMovesYoshimitsu, loadPunishers } from '../../src/data/packs';
import { seedProvenance, type Move, type ProblemMove } from '../../src/data/schemas';

const ROWS = rowsFromPack(loadPunishers());

// --- Independent re-derivation of the §5.10 ordering (from the spec text) ---
function effectiveDamage(row: PunisherRow): number {
  return row.comboDamage ?? row.damage;
}

function onHitFrames(row: PunisherRow): number {
  if (/launch/i.test(row.onHit)) return 1000;
  const match = /[+-]?\d+/.exec(row.onHit);
  return match === null ? Number.NEGATIVE_INFINITY : Number(match[0]);
}

function isHeatEngager(row: PunisherRow): boolean {
  return row.heatEngager === true || /heat engager/i.test(row.notes ?? '');
}

/** True when `a` strictly beats `b` under the §5.10 rule. */
function beats(a: PunisherRow, b: PunisherRow): boolean {
  if (effectiveDamage(a) !== effectiveDamage(b)) return effectiveDamage(a) > effectiveDamage(b);
  if (onHitFrames(a) !== onHitFrames(b)) return onHitFrames(a) > onHitFrames(b);
  return (isHeatEngager(a) ? 1 : 0) > (isHeatEngager(b) ? 1 : 0);
}

describe('AC-PUN-1 answer key — all 60 cells', () => {
  const cells: Array<{ b: number; posture: 'standing' | 'crouching'; heat: boolean }> = [];
  for (let b = -6; b >= -20; b -= 1) {
    for (const posture of ['standing', 'crouching'] as const) {
      for (const heat of [false, true]) cells.push({ b, posture, heat });
    }
  }
  expect(cells).toHaveLength(60);

  it.each(cells)('b=$b $posture Heat $heat: best is eligible and unbeaten', ({ b, posture, heat }) => {
    const best = bestPunisher(b, posture, heat, ROWS);
    expect(best).not.toBeNull();
    if (best === null) return;
    expect(isEligible(best, b, posture, heat)).toBe(true);
    for (const row of ROWS) {
      if (!isEligible(row, b, posture, heat)) continue;
      expect(beats(row, best)).toBe(false);
    }
  });

  it('pinned anchors', () => {
    expect(bestPunisher(-6, 'standing', false, ROWS)?.input).toBe('1+4');
    expect(bestPunisher(-8, 'standing', false, ROWS)?.input).toBe('NSS.1+4');
    // D-014: the NSS-gated row wins by combo damage, here and at -13.
    expect(bestPunisher(-13, 'standing', false, ROWS)?.input).toBe('NSS.1+4');
    expect(bestPunisher(-14, 'standing', false, ROWS)?.input).toBe('NSS.1+4');
    // -20 standing: the highest-damage launcher row (df+2, combo 72).
    expect(bestPunisher(-20, 'standing', false, ROWS)?.input).toBe('df+2');
    expect(bestPunisher(-20, 'standing', true, ROWS)?.input).toBe('df+2');
    // Heat Smash stays best only where df+2 is not eligible: never in the
    // bundled pack at -18..-20, since df+2 (enemy -15) is always eligible.
    expect(bestPunisher(-18, 'crouching', false, ROWS)?.input).toBe('ws1,2');
  });
});

describe('ladderModel', () => {
  it('covers every enemy value present in the pack, Heat off, via bestPunisher', () => {
    const model = ladderModel(loadPunishers());
    for (const enemy of [-6, -8, -10, -11, -13, -14, -15, -17, -18]) {
      const cell = model[enemy];
      expect(cell).toBeDefined();
      expect(cell?.standing?.notation).toBe(bestPunisher(enemy, 'standing', false, ROWS)?.input);
      expect(cell?.crouching?.notation).toBe(bestPunisher(enemy, 'crouching', false, ROWS)?.input);
      if (cell?.standing !== undefined) {
        const row = ROWS.find((r) => r.input === cell.standing?.notation && r.posture === 'standing');
        expect(cell.standing.damage).toBe(row !== undefined ? effectiveDamage(row) : undefined);
      }
    }
  });

  it('covers -19/-20 with the best eligible row so every quiz question has a rung to highlight (E7)', () => {
    const model = ladderModel(loadPunishers());
    for (const enemy of [-19, -20]) {
      const cell = model[enemy];
      expect(cell).toBeDefined();
      expect(cell?.standing?.notation).toBe(bestPunisher(enemy, 'standing', false, ROWS)?.input);
      expect(cell?.crouching?.notation).toBe(bestPunisher(enemy, 'crouching', false, ROWS)?.input);
    }
  });
});

describe('buildLadderQuestions', () => {
  it('covers -6..-20 x both postures Heat off, plus Heat-on variants at -18..-20', () => {
    const questions = buildLadderQuestions(loadPunishers(), 42);
    // 15 values x 2 postures Heat off = 30, plus 3 values x 2 postures Heat on = 6.
    expect(questions).toHaveLength(36);
    const ids = new Set(questions.map((q) => q.id));
    expect(ids.size).toBe(36);
    for (const q of questions) {
      expect(q.options).toHaveLength(4);
      expect(new Set(q.options).size).toBe(4);
      expect(q.options).toContain(q.correctInput);
      expect(q.correctInput).toBe(bestPunisher(q.blockValue, q.posture, q.heatActive, ROWS)?.input);
    }
    const heatOn = questions.filter((q) => q.heatActive);
    expect(heatOn).toHaveLength(6);
    expect(heatOn.map((q) => q.blockValue).sort((a, b) => a - b)).toEqual([-20, -20, -19, -19, -18, -18]);
  });

  it('is deterministic for a seed', () => {
    const a = buildLadderQuestions(loadPunishers(), 7);
    const b = buildLadderQuestions(loadPunishers(), 7);
    expect(a).toEqual(b);
  });

  it('prefers eligible lower-damage rows as distractors, then ineligible near-misses', () => {
    const questions = buildLadderQuestions(loadPunishers(), 1);
    const q13 = questions.find((x) => x.blockValue === -13 && x.posture === 'standing' && !x.heatActive);
    expect(q13).toBeDefined();
    if (q13 === undefined) return;
    // df+1,4 (enemy -13) is eligible at -13 and lower-damage than NSS.1+4,
    // so it appears; the three eligible distractors fill the option slots
    // before any ineligible near-miss (b+2,2, enemy -14) is reached.
    expect(q13.options).toContain('df+1,4');
    expect(q13.options).toEqual(expect.arrayContaining(['1+4', '2,2', 'df+1,4', 'NSS.1+4']));
    // At -6 standing there are no other eligible rows, so the options are
    // the best answer plus ineligible near-misses (closest enemy first).
    const q6 = questions.find((x) => x.blockValue === -6 && x.posture === 'standing' && !x.heatActive);
    expect(q6).toBeDefined();
    if (q6 === undefined) return;
    expect(q6.options).toEqual(expect.arrayContaining(['1+4', 'NSS.1+4', '1,1', '2,2']));
  });
});

function move(overrides: Partial<Move> & { input: string }): Move {
  const { input, ...rest } = overrides;
  return {
    id: `Yoshimitsu-${input}`,
    character: 'Yoshimitsu',
    input,
    aliases: [],
    altInputs: [],
    hitLevel: 'm',
    damage: '10',
    startup: 'i10',
    tags: [],
    provenance: seedProvenance,
    ...rest,
  };
}

describe('buildCharacterQuestions', () => {
  const moves = loadMovesYoshimitsu();
  const qualifying = moves.filter((m) => m.blockMin !== undefined && m.blockMin <= -6);
  expect(qualifying.length).toBeGreaterThan(20);

  it('asks the best punisher for each punishable move, capped at 20 + bonus round', () => {
    const questions = buildCharacterQuestions(moves, [], 99, 'Kazuya');
    const moveQuestions = questions.filter((q) => q.kind === 'move');
    const bonus = questions.filter((q) => q.kind === 'bonus');
    expect(moveQuestions).toHaveLength(20);
    expect(bonus).toHaveLength(8);
    for (const q of moveQuestions) {
      expect(q.blockValue).not.toBeNull();
      expect((q.blockValue as number) <= -6).toBe(true);
      const source = moves.find((m) => m.input === q.moveInput);
      expect(source).toBeDefined();
      if (source === undefined || q.blockValue === null) continue;
      expect(q.blockValue).toBe(source.blockMin);
      expect(q.posture).toBe(postureForMove(source));
      expect(q.correctInput).toBe(bestPunisher(q.blockValue, q.posture, false, ROWS)?.input);
      expect(q.options).toHaveLength(4);
      expect(q.options).toContain(q.correctInput);
    }
    for (const q of bonus) {
      expect(q.correctInput).toBe('1+4');
      expect(q.options).toContain('1+4');
      expect(q.blockValue !== null && q.blockValue >= -9 && q.blockValue <= -6).toBe(true);
      expect(q.explanation).toContain('Most characters cannot punish');
    }
    expect(questions.map((q) => q.id).length).toBe(new Set(questions.map((q) => q.id)).size);
  });

  it('derives crouching posture from a trailing low hit level', () => {
    expect(postureForMove(move({ input: 'x1', hitLevel: 'm,l' }))).toBe('crouching');
    expect(postureForMove(move({ input: 'x2', hitLevel: 'h,m' }))).toBe('standing');
    expect(postureForMove(move({ input: 'x3', hitLevel: ',L' }))).toBe('crouching');
  });

  it('falls back to problem moves when no pack moves exist', () => {
    const problemMoves: ProblemMove[] = [
      {
        id: 'pm-1', character: 'Kazuya', input: 'df+2', description: 'Hell sweep mixup',
        answer: { kind: 'punish', detail: 'Block and launch with df+2.' },
        verified: false, createdFrom: 'manual',
      },
      {
        id: 'pm-2', character: 'Kazuya', input: 'f+4', description: 'Keepout kick',
        answer: { kind: 'sidestep-left', detail: 'Sidestep left, then punish.' },
        verified: false, createdFrom: 'manual',
      },
    ];
    const questions = buildCharacterQuestions([], problemMoves, 5, 'Kazuya');
    expect(questions).toHaveLength(2);
    expect(questions.every((q) => q.kind === 'problem')).toBe(true);
    const first = questions.find((q) => q.moveInput === 'df+2');
    expect(first?.correctInput).toBe('Block and launch with df+2.');
    expect(first?.options).toContain('Block and launch with df+2.');
    expect(characterQuestionText(first as (typeof questions)[number])).toContain("Kazuya's df+2");
  });
});

describe('punishLabRoutine', () => {
  it('computes the best punisher from the pack and names the verified drill', () => {
    const routine = punishLabRoutine('df+2', -13, 'standing');
    expect(routine.bestInput).toBe(bestPunisher(-13, 'standing', false, ROWS)?.input);
    expect(routine.recipe.join(' ')).toContain('df+2');
    expect(routine.recipe.join(' ')).toContain(routine.bestInput as string);
    expect(routine.steps.length).toBeGreaterThan(0);
    const curriculum = loadCurriculum();
    expect(punishDrillId('standing')).toBe('d1-punish-ladder');
    expect(curriculum.drills.some((d) => d.id === 'd1-punish-ladder')).toBe(true);
    expect(punishDrillId('crouching')).toBe('d1-punish-crouch');
    expect(curriculum.drills.some((d) => d.id === 'd1-punish-crouch')).toBe(true);
  });
});
