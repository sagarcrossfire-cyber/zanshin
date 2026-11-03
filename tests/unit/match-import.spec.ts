// §9.3/§5.12 — Match import: CSV parsing, dedupe, zero tallies, and the
// 2.0 M2 `tallied: false` marker (CSV never invents tallies, so per-game
// KPIs must ignore an imported set until Sagar fills them in).
import { describe, expect, it } from 'vitest';
import {
  isDuplicateBattle, parseMatchCsv, toMatchSet, type ImportedBattle,
} from '../../src/data/import/matches';
import type { MatchSet } from '../../src/data/schemas';

function battle(overrides: Partial<ImportedBattle> = {}): ImportedBattle {
  return {
    battleId: 'b1', at: '2026-10-30T20:00:00.000Z', day: '2026-10-30',
    opponentCharacter: 'Kazuya', games: 5, wins: 3, mode: 'ranked', ...overrides,
  };
}

describe('parseMatchCsv', () => {
  it('parses the standard header plus optional games/wins', () => {
    const rows = parseMatchCsv('date,opponent,character,result,games,wins\n2026-10-30,SagarFan,Kazuya,W,5,3\n');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ opponentCharacter: 'Kazuya', games: 5, wins: 3 });
  });

  it('treats W/win/1 as a win and other results as a loss', () => {
    const rows = parseMatchCsv(
      'date,opponent,character,result\n2026-10-30,a,Kazuya,W\n2026-10-30,b,Heihachi,win\n2026-10-30,c,Jin,1\n2026-10-30,d,Paul,L\n',
    );
    expect(rows.map((r) => r.wins)).toEqual([1, 1, 1, 0]);
    expect(rows.map((r) => r.games)).toEqual([1, 1, 1, 1]);
  });

  it('handles quoted fields and CRLF, and skips malformed rows', () => {
    const rows = parseMatchCsv(
      'date,opponent,character,result\r\n"2026-10-30","Doom, Jr.",Kazuya,W\r\nnot-a-date,x,Kazuya,W\r\n2026-10-30,y,,W\r\n',
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.opponentCharacter).toBe('Kazuya');
  });

  it('returns [] when required headers are missing', () => {
    expect(parseMatchCsv('foo,bar\n1,2\n')).toEqual([]);
  });
});

describe('toMatchSet / isDuplicateBattle', () => {
  it('imports never invent tallies, and the set is marked tallied: false', () => {
    const set = toMatchSet(battle(), 'match-b1');
    expect(Object.values(set.tallies).every((v) => v === 0)).toBe(true);
    expect(set.beatBy).toEqual([]);
    expect(set.tallied).toBe(false);
  });

  it('dedupes on importRef', () => {
    const existing: MatchSet[] = [toMatchSet(battle(), 'match-b1')];
    expect(isDuplicateBattle(existing, battle())).toBe(true);
    // A different ref with different results is not a duplicate; an identical
    // day/character/games/wins is, via the AC-LOG-3 fallback rule.
    expect(isDuplicateBattle(existing, battle({ battleId: 'b2', wins: 4 }))).toBe(false);
    expect(isDuplicateBattle(existing, battle({ battleId: 'b2' }))).toBe(true);
  });

  it('dedupes on day + character + games + wins without a ref', () => {
    const existing: MatchSet[] = [{ ...toMatchSet(battle(), 'match-x'), importRef: undefined }];
    expect(isDuplicateBattle(existing, battle({ battleId: 'other' }))).toBe(true);
    expect(isDuplicateBattle(existing, battle({ battleId: 'other', wins: 4 }))).toBe(false);
  });
});
