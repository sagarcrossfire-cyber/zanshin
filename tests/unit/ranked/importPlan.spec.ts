// 2.0 M2 — planRankedImport: grouping consecutive rematches into match sets,
// the setGapMinutes edge, draws, day boundaries, idempotent re-planning, and
// mid-set-then-later-sync equalling one sync at the end. Imported sets carry
// zero tallies and tallied:false.
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SET_GAP_MINUTES, RANKED_SYNC_TAG, ZERO_TALLIES,
  planRankedImport, rankedBattlesOf, rankedSetId, storedRefs, latestRankedAt,
  type ImportableSet, type IncomingBattle,
} from '../../../src/domain/ranked/importPlan';

const T0 = '2026-11-02T20:00:00.000Z';
function plusMin(iso: string, minutes: number): string {
  return new Date(Date.parse(iso) + minutes * 60_000).toISOString();
}

let seq = 0;
function battle(overrides: Partial<IncomingBattle> = {}): IncomingBattle {
  seq += 1;
  return {
    battleAt: T0,
    myCharacter: 'Yoshimitsu',
    opponentCharacter: 'Kazuya',
    opponentId: 'opp000000001',
    result: 'win',
    source: 'wank',
    importRef: `${1793000000 + seq}:me00000000:opp000000001`,
    ...overrides,
  };
}

function emptySet(): ImportableSet[] {
  return [];
}

describe('planRankedImport — grouping', () => {
  it('groups consecutive rematches vs the same opponent/characters into one set', () => {
    const battles = [
      battle({ battleAt: T0 }),
      battle({ battleAt: plusMin(T0, 5), result: 'loss' }),
      battle({ battleAt: plusMin(T0, 12), result: 'win' }),
    ];
    const plan = planRankedImport(emptySet(), battles);
    expect(plan.creates).toHaveLength(1);
    expect(plan.updates).toHaveLength(0);
    expect(plan.creates[0]?.games).toBe(3);
    expect(plan.creates[0]?.wins).toBe(2);
    expect(plan.creates[0]?.mode).toBe('ranked');
    expect(plan.creates[0]?.tags).toEqual([RANKED_SYNC_TAG]);
  });

  it('starts a new set for a different opponent, even with no time gap', () => {
    const battles = [battle({ battleAt: T0 }), battle({ battleAt: T0, opponentId: 'opp000000002' })];
    const plan = planRankedImport(emptySet(), battles);
    expect(plan.creates).toHaveLength(2);
  });

  it('starts a new set when either character changes', () => {
    const battles = [
      battle({ battleAt: T0, myCharacter: 'Yoshimitsu' }),
      battle({ battleAt: plusMin(T0, 1), myCharacter: 'Kazuya' }),
    ];
    expect(planRankedImport(emptySet(), battles).creates).toHaveLength(2);
  });

  it('gap edge: exactly setGapMinutes (20) still groups; 21 starts a new set', () => {
    const at20 = [battle({ battleAt: T0 }), battle({ battleAt: plusMin(T0, DEFAULT_SET_GAP_MINUTES) })];
    expect(planRankedImport(emptySet(), at20).creates).toHaveLength(1);

    const at21 = [battle({ battleAt: T0 }), battle({ battleAt: plusMin(T0, DEFAULT_SET_GAP_MINUTES + 1) })];
    expect(planRankedImport(emptySet(), at21).creates).toHaveLength(2);
  });

  it('respects a custom setGapMinutes option', () => {
    const battles = [battle({ battleAt: T0 }), battle({ battleAt: plusMin(T0, 45) })];
    expect(planRankedImport(emptySet(), battles, { setGapMinutes: 60 }).creates).toHaveLength(1);
    expect(planRankedImport(emptySet(), battles, { setGapMinutes: 30 }).creates).toHaveLength(2);
  });

  it('a draw counts as a game but not a win', () => {
    const battles = [battle({ result: 'win' }), battle({ battleAt: plusMin(T0, 1), result: 'draw' })];
    const plan = planRankedImport(emptySet(), battles);
    expect(plan.creates[0]?.games).toBe(2);
    expect(plan.creates[0]?.wins).toBe(1);
  });

  it('falls back to opponentName when opponentId is absent, and never groups mixed keys', () => {
    const named = battle({ opponentId: undefined, opponentName: 'SagarFan' });
    const other = battle({ battleAt: plusMin(T0, 1), opponentId: undefined, opponentName: 'OtherName' });
    const plan = planRankedImport(emptySet(), [named, other]);
    expect(plan.creates).toHaveLength(2);

    const sameName = battle({ battleAt: plusMin(T0, 1), opponentId: undefined, opponentName: 'SagarFan' });
    expect(planRankedImport(emptySet(), [named, sameName]).creates).toHaveLength(1);
  });

  it('new day (beyond the gap) starts a separate set, each day computed by the day boundary', () => {
    const first = battle({ battleAt: '2026-11-02T03:30:00.000Z' }); // before 04:00 boundary -> prior day
    const second = battle({ battleAt: '2026-11-03T05:00:00.000Z' }); // well past the gap
    const plan = planRankedImport(emptySet(), [first, second]);
    expect(plan.creates).toHaveLength(2);
    expect(plan.creates[0]?.day).toBe('2026-11-01');
    expect(plan.creates[1]?.day).toBe('2026-11-03');
  });
});

describe('planRankedImport — idempotence and resync', () => {
  it('importRef is used exactly as sent, never recomputed', () => {
    const b = battle({ importRef: 'exact-ref-123' });
    const plan = planRankedImport(emptySet(), [b]);
    expect(plan.creates[0]?.importRef).toBe('exact-ref-123');
    expect(plan.creates[0]?.ranked?.battles[0]?.ref).toBe('exact-ref-123');
  });

  it('a battle whose importRef is already stored is skipped', () => {
    const b = battle();
    const first = planRankedImport(emptySet(), [b]);
    const stored = [...first.creates];
    const second = planRankedImport(stored, [b]);
    expect(second.added).toBe(0);
    expect(second.skipped).toBe(1);
    expect(second.creates).toHaveLength(0);
    expect(second.updates).toHaveLength(0);
  });

  it('planning twice with the same input yields no changes the second time', () => {
    const battles = [battle({ battleAt: T0 }), battle({ battleAt: plusMin(T0, 5), result: 'loss' })];
    const first = planRankedImport(emptySet(), battles);
    const stored = [...first.creates];
    const second = planRankedImport(stored, battles);
    expect(second.added).toBe(0);
    expect(second.creates).toHaveLength(0);
    expect(second.updates).toHaveLength(0);
  });

  it('a rematch arriving in a later sync extends the set it continues', () => {
    const b1 = battle({ battleAt: T0 });
    const first = planRankedImport(emptySet(), [b1]);
    const stored = [...first.creates];
    const b2 = battle({ battleAt: plusMin(T0, 10), result: 'loss' });
    const second = planRankedImport(stored, [b2]);
    expect(second.creates).toHaveLength(0);
    expect(second.updates).toHaveLength(1);
    expect(second.updates[0]?.games).toBe(2);
    expect(second.updates[0]?.wins).toBe(1);
    expect(second.updates[0]?.id).toBe(stored[0]?.id);
  });

  it('syncing mid-set then again later equals syncing once at the end', () => {
    const b1 = battle({ battleAt: T0 });
    const b2 = battle({ battleAt: plusMin(T0, 5), result: 'loss' });
    const b3 = battle({ battleAt: plusMin(T0, 10), result: 'win' });

    // Mid-set sync, then a later sync with the remaining battle.
    const midPlan = planRankedImport(emptySet(), [b1, b2]);
    let state = [...midPlan.creates];
    const laterPlan = planRankedImport(state, [b3]);
    state = state.map((s) => laterPlan.updates.find((u) => u.id === s.id) ?? s);

    // One sync at the end with everything.
    const onceState = planRankedImport(emptySet(), [b1, b2, b3]).creates;

    expect(state).toHaveLength(1);
    expect(onceState).toHaveLength(1);
    expect(state[0]?.games).toBe(onceState[0]?.games);
    expect(state[0]?.wins).toBe(onceState[0]?.wins);
    expect(state[0]?.id).toBe(onceState[0]?.id);
    expect(state[0]?.ranked?.battles.map((b) => b.ref).sort())
      .toEqual(onceState[0]?.ranked?.battles.map((b) => b.ref).sort());
  });

  it('a rematch outside the gap from an existing set starts a new set, not an update', () => {
    const b1 = battle({ battleAt: T0 });
    const stored = [...planRankedImport(emptySet(), [b1]).creates];
    const b2 = battle({ battleAt: plusMin(T0, DEFAULT_SET_GAP_MINUTES + 1) });
    const plan = planRankedImport(stored, [b2]);
    expect(plan.creates).toHaveLength(1);
    expect(plan.updates).toHaveLength(0);
  });
});

describe('planRankedImport — zero tallies', () => {
  it('imported sets carry zero tallies and tallied:false', () => {
    const plan = planRankedImport(emptySet(), [battle()]);
    const set = plan.creates[0];
    expect(set?.tallied).toBe(false);
    expect(set?.tallies).toEqual(ZERO_TALLIES);
    expect(set?.beatBy).toEqual([]);
  });

  it('extending a set never touches its tallies', () => {
    const stored = [...planRankedImport(emptySet(), [battle({ battleAt: T0 })]).creates];
    stored[0] = { ...(stored[0] as ImportableSet), tallies: { ...ZERO_TALLIES, missedPunishes: 3 }, tallied: false };
    const plan = planRankedImport(stored, [battle({ battleAt: plusMin(T0, 1) })]);
    expect(plan.updates[0]?.tallies.missedPunishes).toBe(3);
    expect(plan.updates[0]?.tallied).toBe(false);
  });
});

describe('storedRefs / rankedBattlesOf / latestRankedAt / rankedSetId', () => {
  it('storedRefs collects importRef and every battle ref', () => {
    const plan = planRankedImport(emptySet(), [battle({ battleAt: T0 }), battle({ battleAt: plusMin(T0, 1) })]);
    const refs = storedRefs(plan.creates);
    expect(refs.size).toBe(2);
  });

  it('rankedBattlesOf flattens battles across sets, oldest first', () => {
    const b1 = battle({ battleAt: T0 });
    const b2 = battle({ battleAt: plusMin(T0, 1000), opponentId: 'other' });
    const sets = [...planRankedImport(emptySet(), [b1, b2]).creates];
    const flat = rankedBattlesOf(sets);
    expect(flat).toHaveLength(2);
    expect((flat[0]?.at ?? '') <= (flat[1]?.at ?? '')).toBe(true);
  });

  it('latestRankedAt finds the newest battle time, or null with none', () => {
    expect(latestRankedAt([])).toBeNull();
    const b1 = battle({ battleAt: T0 });
    const b2 = battle({ battleAt: plusMin(T0, 1000), opponentId: 'other' });
    const sets = [...planRankedImport(emptySet(), [b1, b2]).creates];
    expect(latestRankedAt(sets)).toBe(b2.battleAt);
  });

  it('rankedSetId is stable for the same first ref', () => {
    expect(rankedSetId('123:a:b')).toBe(rankedSetId('123:a:b'));
    expect(rankedSetId('123:a:b')).not.toBe(rankedSetId('456:a:b'));
  });
});
