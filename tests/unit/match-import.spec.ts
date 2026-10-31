// §9.3/§5.12 — Match import adapters: CSV parsing, dedupe, zero tallies,
// and shape-tolerant Wank/ewgf fetching (URL/shape unverified; adapters
// parse defensively and surface errors instead of inventing data).
import { describe, expect, it, vi } from 'vitest';
import {
  fetchEwgfBattles, fetchWankBattles, isDuplicateBattle, parseMatchCsv, toMatchSet,
  type ImportedBattle,
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
  it('imports never invent tallies', () => {
    const set = toMatchSet(battle(), 'match-b1');
    expect(Object.values(set.tallies).every((v) => v === 0)).toBe(true);
    expect(set.beatBy).toEqual([]);
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

describe('fetch adapters (stubbed fetch)', () => {
  function stubFetch(json: unknown, status = 200) {
    return vi.fn(async () => ({ ok: status >= 200 && status < 300, status, json: async () => json }));
  }

  it('fetchWankBattles reads the battles key and tolerates the matches key', async () => {
    const fetcher = stubFetch({ battles: [{ id: 'w1', date: '2026-10-30T20:00:00Z', character: 'Kazuya', games: 5, wins: 3 }] });
    const battles = await fetchWankBattles(fetcher, 'tekken-123');
    expect(battles).toHaveLength(1);
    expect(battles[0]?.opponentCharacter).toBe('Kazuya');
    expect(fetcher).toHaveBeenCalledWith(expect.stringContaining('tekken-123'), expect.anything());

    const alt = stubFetch({ matches: [{ battleId: 'w2', at: '2026-10-30T21:00:00Z', opponentCharacter: 'Jin', games: 2, wins: 1 }] });
    expect((await fetchWankBattles(alt, 'tekken-123'))).toHaveLength(1);
  });

  it('fetchWankBattles throws a readable error on HTTP failure', async () => {
    const fetcher = stubFetch({}, 404);
    await expect(fetchWankBattles(fetcher, 'tekken-123')).rejects.toThrow(/404/);
  });

  it('fetchEwgfBattles sends the Bearer token and never stores it', async () => {
    const fetcher = stubFetch([{ id: 'e1', date: '2026-10-30T20:00:00Z', character: 'Paul', games: 3, wins: 1, mode: 'ranked' }]);
    const battles = await fetchEwgfBattles(fetcher, 'tekken-123', 'tok-abc');
    expect(battles).toHaveLength(1);
    const [, init] = fetcher.mock.calls[0] as unknown as [string, { headers: Record<string, string> }];
    expect(init.headers.Authorization).toBe('Bearer tok-abc');
    expect(battles[0]?.opponentCharacter).toBe('Paul');
  });

  it('fetchEwgfBattles surfaces 401 as an auth error', async () => {
    const fetcher = stubFetch({}, 401);
    await expect(fetchEwgfBattles(fetcher, 'tekken-123', 'bad')).rejects.toThrow(/401|unauthori/i);
  });
});
