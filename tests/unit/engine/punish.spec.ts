// Spec §5.10 — punish answer rule. Fixture rows mirror §10.7 where the spec
// states damage/combo damage; rows without a stated value use a synthetic
// test value, marked SYNTHETIC below. The implementation is data-driven and
// holds no §10.7 rows of its own.
//
// KNOWN RULE/TABLE TENSION (spec wins): §5.10 makes every row whose enemy
// value is b or less negative eligible, so the NSS.1+4 row (enemy -8,
// combo 67, §10.7 notes "In NSS") is the §5.10 best answer at -8..-14
// standing, ahead of the per-rung rows §10.7 lists (df+1,4 at -13 etc.).
// Likewise df+2 (combo 72) beats Heat Smash (51) at -18 with Heat on.
// The §10.7 note at -17 ("df+2 stays the best answer at -17") shows the
// table itself anticipates rule-over-rung outcomes. No stance filter is
// invented here; stance requirements live in the row notes.
import {
  answerKeyTable, bestPunisher, isEligible, scoreAnswer, type PunisherRow,
} from '../../../src/domain/engine/punish';

function row(overrides: Partial<PunisherRow> & { input: string }): PunisherRow {
  return {
    posture: 'standing', enemy: -10, moveId: `Yoshimitsu-${overrides.input}`,
    damage: 10, onHit: '+0', onBlock: '-10', heatOnly: false, ...overrides,
  };
}

const PUNISHERS: PunisherRow[] = [
  row({ posture: 'standing', enemy: -6, input: '1+4', damage: 20, comboDamage: 42, onHit: '+14c', onBlock: '-20' }),
  row({ posture: 'standing', enemy: -8, input: 'NSS.1+4', damage: 20, comboDamage: 67, onHit: '+14 +64a', onBlock: '-7', notes: 'In NSS' }),
  row({ posture: 'standing', enemy: -10, input: '1,1', damage: 24, onHit: '+4c', onBlock: '-9' }),
  row({ posture: 'standing', enemy: -10, input: '1,NSS.1', damage: 27, onHit: '+22a (+17)', onBlock: '-9' }),
  row({ posture: 'standing', enemy: -11, input: '2,2', damage: 28, onHit: '+15g', onBlock: '-1' }),
  row({ posture: 'standing', enemy: -11, input: '2,NSS.1', damage: 30, comboDamage: 53, onHit: '+19a', onBlock: '-1' }),
  row({ posture: 'standing', enemy: -13, input: 'df+1,4', damage: 31, onHit: '+4', onBlock: '-12' }),
  row({ posture: 'standing', enemy: -14, input: 'b+2,2', damage: 33, onHit: '+2a', onBlock: '-9', heatEngager: true, notes: 'Heat Engager' }),
  row({ posture: 'standing', enemy: -15, input: 'df+2', damage: 13, comboDamage: 72, onHit: '+34a (+24)', onBlock: '-7' }),
  row({ posture: 'standing', enemy: -15, input: 'uf+3', damage: 15, comboDamage: 69, onHit: '+32a (+22)', onBlock: '-13' }),
  row({ posture: 'standing', enemy: -17, input: 'f,n,d,df+1', damage: 22, onHit: '+35a (+25a)', onBlock: '-17' }),
  row({ posture: 'standing', enemy: -18, input: 'H.2+3', damage: 51, onHit: '+0d', onBlock: '+1', heatOnly: true, notes: 'Heat Smash; SYNTHETIC onHit' }),
  row({ posture: 'crouching', enemy: -18, input: 'H.2+3', damage: 51, onHit: '+0d', onBlock: '+1', heatOnly: true, notes: 'Heat Smash; SYNTHETIC onHit' }),
  // SYNTHETIC damage/onHit: §10.7 gives no values for the crouching Flash rows.
  row({ posture: 'crouching', enemy: -6, input: 'FC.D+1+4', damage: 20, onHit: '+14c', onBlock: '-20' }),
  row({ posture: 'crouching', enemy: -8, input: 'FC NSS.d+1+4', damage: 20, onHit: '+19a', onBlock: '-7' }),
  row({ posture: 'crouching', enemy: -10, input: 'hFC.1', damage: 5, onHit: '+8', onBlock: '+1' }),
  row({ posture: 'crouching', enemy: -11, input: 'ws4', damage: 14, onHit: '+5', onBlock: '-6' }),
  row({ posture: 'crouching', enemy: -13, input: 'ws1,2', damage: 30, onHit: '+14g', onBlock: '-4' }),
  row({ posture: 'crouching', enemy: -15, input: 'ws2,1', damage: 27, onHit: '+36a (+26)', onBlock: '-3a' }),
];

describe('isEligible', () => {
  it('admits enemy values b or less negative (enemy >= b), posture-matched', () => {
    const flash = PUNISHERS[0] as PunisherRow;
    expect(isEligible(flash, -13, 'standing', false)).toBe(true);
    expect(isEligible(flash, -6, 'standing', false)).toBe(true);
    expect(isEligible(flash, -5, 'standing', false)).toBe(false);
    expect(isEligible(flash, -13, 'crouching', false)).toBe(false);
    const late = row({ enemy: -14, input: 'b+2,2' });
    expect(isEligible(late, -13, 'standing', false)).toBe(false);
    expect(isEligible(late, -14, 'standing', false)).toBe(true);
  });

  it('excludes Heat-only rows unless Heat is active', () => {
    const smash = PUNISHERS.find((r) => r.input === 'H.2+3' && r.posture === 'standing') as PunisherRow;
    expect(isEligible(smash, -18, 'standing', false)).toBe(false);
    expect(isEligible(smash, -18, 'standing', true)).toBe(true);
  });
});

describe('bestPunisher', () => {
  it('picks the highest combo damage, else raw damage', () => {
    expect(bestPunisher(-6, 'standing', false, PUNISHERS)?.input).toBe('1+4');
    expect(bestPunisher(-15, 'standing', false, PUNISHERS)?.input).toBe('df+2');
    expect(bestPunisher(-17, 'standing', false, PUNISHERS)?.input).toBe('df+2');
  });

  it('breaks damage ties by better on-hit frames, then Heat Engager status', () => {
    const rows = [
      row({ enemy: -10, input: 'a', damage: 20, onHit: '+4' }),
      row({ enemy: -10, input: 'b', damage: 20, onHit: '+8' }),
      row({ enemy: -10, input: 'c', damage: 20, onHit: '+8', heatEngager: true }),
    ];
    expect(bestPunisher(-10, 'standing', false, rows)?.input).toBe('c');
    const noEngager = rows.slice(0, 2);
    expect(bestPunisher(-10, 'standing', false, noEngager)?.input).toBe('b');
  });

  it('derives Heat Engager status from notes when the flag is absent', () => {
    const rows = [
      row({ enemy: -10, input: 'a', damage: 20, onHit: '+8' }),
      row({ enemy: -10, input: 'b', damage: 20, onHit: '+8', notes: 'Heat Engager on hit' }),
    ];
    expect(bestPunisher(-10, 'standing', false, rows)?.input).toBe('b');
  });

  it('returns null when nothing is eligible', () => {
    expect(bestPunisher(-20, 'standing', false, [])).toBeNull();
    expect(bestPunisher(-5, 'standing', false, PUNISHERS)).toBeNull();
  });

  it('never hard-codes rows: an empty pack yields no answer', () => {
    expect(bestPunisher(-13, 'standing', true, [])).toBeNull();
  });
});

describe('scoreAnswer', () => {
  it('scores the best answer 1', () => {
    const result = scoreAnswer(-15, 'standing', false, PUNISHERS, 'df+2');
    expect(result.score).toBe(1);
    expect(result.best?.input).toBe('df+2');
  });

  it('scores a valid but lower-damage punisher 0.5', () => {
    const result = scoreAnswer(-10, 'standing', false, PUNISHERS, '1,1');
    expect(result.score).toBe(0.5);
    expect(result.best?.input).toBe('NSS.1+4');
    expect(result.reason).toContain('deals more damage');
  });

  it('scores ineligible, Heat-only-when-inactive and unknown answers 0', () => {
    expect(scoreAnswer(-10, 'standing', false, PUNISHERS, 'df+2').score).toBe(0);
    expect(scoreAnswer(-18, 'standing', false, PUNISHERS, 'H.2+3').score).toBe(0);
    expect(scoreAnswer(-13, 'standing', false, PUNISHERS, 'not a move').score).toBe(0);
  });

  it('matches by move id as well as input, ignoring whitespace', () => {
    const result = scoreAnswer(-15, 'standing', false, PUNISHERS, ' Yoshimitsu-df+2 ');
    expect(result.score).toBe(1);
  });

  it('scores the Heat Smash best answer 1 at -18 crouching with Heat on', () => {
    expect(scoreAnswer(-18, 'crouching', true, PUNISHERS, 'H.2+3').score).toBe(1);
  });
});

describe('answerKeyTable', () => {
  it('covers -6..-20, both postures, both Heat states: 60 rows in order', () => {
    const table = answerKeyTable(PUNISHERS);
    expect(table).toHaveLength(60);
    expect(table[0]).toMatchObject({ blockValue: -6, posture: 'standing', heatActive: false });
    expect(table[1]).toMatchObject({ blockValue: -6, posture: 'standing', heatActive: true });
    expect(table[2]).toMatchObject({ blockValue: -6, posture: 'crouching', heatActive: false });
    expect(table[3]).toMatchObject({ blockValue: -6, posture: 'crouching', heatActive: true });
    expect(table[59]).toMatchObject({ blockValue: -20, posture: 'crouching', heatActive: true });
  });

  it('matches the §5.10 rule at key rungs', () => {
    const table = answerKeyTable(PUNISHERS);
    const cell = (b: number, posture: 'standing' | 'crouching', heat: boolean): string | null =>
      table.find((r) => r.blockValue === b && r.posture === posture && r.heatActive === heat)?.bestInput ?? null;
    expect(cell(-6, 'standing', false)).toBe('1+4');
    expect(cell(-8, 'standing', false)).toBe('NSS.1+4');
    expect(cell(-13, 'standing', false)).toBe('NSS.1+4');
    expect(cell(-15, 'standing', false)).toBe('df+2');
    expect(cell(-17, 'standing', false)).toBe('df+2');
    expect(cell(-18, 'standing', false)).toBe('df+2');
    // §5.10 rule: df+2 combo 72 beats Heat Smash 51 even with Heat on.
    expect(cell(-18, 'standing', true)).toBe('df+2');
    expect(cell(-6, 'crouching', false)).toBe('FC.D+1+4');
    expect(cell(-11, 'crouching', false)).toBe('FC NSS.d+1+4');
    expect(cell(-13, 'crouching', false)).toBe('ws1,2');
    expect(cell(-15, 'crouching', false)).toBe('ws1,2');
    expect(cell(-18, 'crouching', false)).toBe('ws1,2');
    expect(cell(-18, 'crouching', true)).toBe('H.2+3');
    expect(cell(-20, 'crouching', true)).toBe('H.2+3');
  });

  it('makes a Heat-only row the best answer when it is the strongest eligible row', () => {
    const rows = [
      row({ enemy: -13, input: 'ws1,2', damage: 30, onHit: '+14g' }),
      row({ enemy: -18, input: 'H.2+3', damage: 51, onHit: '+0d', heatOnly: true }),
    ];
    expect(bestPunisher(-18, 'standing', false, rows)?.input).toBe('ws1,2');
    expect(bestPunisher(-18, 'standing', true, rows)?.input).toBe('H.2+3');
  });
});
