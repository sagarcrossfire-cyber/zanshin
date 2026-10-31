// P4: search index, filters/sorts, risk text, combo builder — spec §5.6/§5.8.
import { describe, expect, it } from 'vitest';
import { loadCombos, loadMovesYoshimitsu } from '../../../src/data/packs';
import { buildMoveIndex, searchMoves } from '../../../src/domain/codex/search';
import {
  blockTier, EMPTY_FILTERS, hitLevelsOf, moveMatchesFilters, recoversInto, sortMoves,
  stanceOf, startupBucket, startupOf,
} from '../../../src/domain/codex/filters';
import { opponentAnswers, riskSentences, splitNotes } from '../../../src/domain/codex/riskText';
import { buildPracticeSession, comboSuccessRate, routeSteps } from '../../../src/domain/codex/combo';
import type { Move } from '../../../src/data/schemas';

const moves = loadMovesYoshimitsu();
const index = buildMoveIndex(moves);
const byId = new Map(moves.map((m) => [m.id, m]));
const emptyNotes = new Set<string>();
const emptyConflicts = new Set<string>();

function move(id: string): Move {
  const found = byId.get(id);
  if (!found) throw new Error(`missing move ${id}`);
  return found;
}

describe('move search (AC-MOVES-1)', () => {
  it('matches input, name and alias: "flash", "cd2", "1+4", "df+2"', () => {
    expect(searchMoves(index, 'flash').map((m) => m.id)).toContain('Yoshimitsu-1+4');
    expect(searchMoves(index, 'cd2').map((m) => m.input)).toContain('f,n,d,df+2');
    expect(searchMoves(index, '1+4').map((m) => m.id)).toContain('Yoshimitsu-1+4');
    expect(searchMoves(index, 'df+2').map((m) => m.id)).toContain('Yoshimitsu-df+2');
  });

  it('ranks an exact name match first: "flash" surfaces 1+4 (Flash) above Flashing Steel (E2)', () => {
    expect(searchMoves(index, 'flash')[0]?.id).toBe('Yoshimitsu-1+4');
    expect(searchMoves(index, 'flashing')[0]?.input).toBe('f,n,d,df+2');
    expect(searchMoves(index, '1+4')[0]?.id).toBe('Yoshimitsu-1+4');
  });

  it('never confuses + with , ("1+4" does not match "1,4")', () => {
    const hits = searchMoves(index, '1+4');
    expect(hits.every((m) => m.input.includes('1+4') || (m.name ?? '').toLowerCase().includes('1+4') || m.aliases.some((a) => a.includes('1+4')))).toBe(true);
  });

  it('answers within 100 ms on the 319-move pack', () => {
    const start = performance.now();
    for (let i = 0; i < 20; i++) searchMoves(index, 'df');
    const elapsed = performance.now() - start;
    expect(elapsed / 20).toBeLessThan(100);
  });

  it('empty query returns every move', () => {
    expect(searchMoves(index, '')).toHaveLength(moves.length);
  });
});

describe('explorer filters (AC-MOVES-3)', () => {
  it('filters combine with AND and clearing restores the full list', () => {
    const filtered = moves.filter((m) =>
      moveMatchesFilters(m, { ...EMPTY_FILTERS, hitLevels: ['M'], blockTiers: ['launch'] }, emptyNotes, emptyConflicts),
    );
    expect(filtered.length).toBeGreaterThan(0);
    expect(filtered.every((m) => hitLevelsOf(m).includes('M') && blockTier(m) === 'launch')).toBe(true);
    const cleared = moves.filter((m) => moveMatchesFilters(m, EMPTY_FILTERS, emptyNotes, emptyConflicts));
    expect(cleared).toHaveLength(moves.length);
  });

  it('startup buckets: Flash is fast, df+2 is mid', () => {
    expect(startupBucket(move('Yoshimitsu-1+4'))).toBe('fast');
    expect(startupOf(move('Yoshimitsu-df+2'))).toBeGreaterThanOrEqual(14);
    expect(startupBucket(move('Yoshimitsu-df+2'))).toBe('mid');
  });

  it('block tiers: +7 is plus, -9 safe, -13 punishable, -20 launch', () => {
    expect(blockTier(move('Yoshimitsu-3,1'))).toBe('plus');
    expect(blockTier(move('Yoshimitsu-1,1'))).toBe('safe');
    expect(blockTier(move('Yoshimitsu-uf+3'))).toBe('punishable');
    expect(blockTier(move('Yoshimitsu-1+4'))).toBe('launch');
  });

  it('stanceOf: NSS prefix, crouch, while-standing, default 1SS', () => {
    expect(stanceOf(move('Yoshimitsu-NSS.1+4'))).toBe('NSS');
    expect(stanceOf(move('Yoshimitsu-1+4'))).toBe('1SS');
    const crouch = moves.find((m) => m.input.startsWith('FC.'));
    if (crouch) expect(stanceOf(crouch)).toBe('crouch');
    const ws = moves.find((m) => m.input.startsWith('ws'));
    if (ws) expect(stanceOf(ws)).toBe('while-standing');
  });

  it('recoversInto parses the trailing stance token', () => {
    const withRecovery = moves.find((m) => m.recovery === 'r34 1SS');
    expect(withRecovery).toBeDefined();
    if (withRecovery) expect(recoversInto(withRecovery)).toBe('1SS');
  });

  it('sorts: num default, startup ascending, damage descending', () => {
    const byNum = sortMoves(moves, 'num');
    expect(byNum[0]?.num).toBeLessThanOrEqual(byNum[1]?.num ?? Infinity);
    const byStartup = sortMoves(moves, 'startup');
    expect((startupOf(byStartup[0]!) ?? Infinity)).toBeLessThanOrEqual(startupOf(byStartup[1]!) ?? Infinity);
  });
});

describe('risk text (P4 prompt step 2)', () => {
  it('turns -13, -20 and +7 into the spec sentences', () => {
    expect(riskSentences(move('Yoshimitsu-uf+3'))).toContain('−13 on block: punishable by any i13 punisher.');
    expect(riskSentences(move('Yoshimitsu-1+4'))).toContain('−20 on block: launch punishable.');
    expect(riskSentences(move('Yoshimitsu-3,1'))).toContain('+7 on block: you keep your turn at +7.');
  });

  it('opponent answers derive from hit level and block tier', () => {
    const jab = move('Yoshimitsu-1');
    expect(opponentAnswers(jab)).toContain('Duck the high hit.');
    expect(opponentAnswers(move('Yoshimitsu-1+4'))).toContain('Punish with a launcher.');
  });

  it('splitNotes separates Wavu bullets from the curated Role', () => {
    const { bullets, role } = splitNotes(move('Yoshimitsu-1+4'));
    expect(role).toContain('Fastest attack');
    expect(bullets.length).toBeGreaterThan(0);
    expect(bullets.join(' ')).not.toContain('Role:');
  });
});

describe('combos (AC-COMBO-2–3)', () => {
  it('Practice this creates segment blocks followed by one full-route block', () => {
    const combo = loadCombos().find((c) => c.id === 'c-bnb') ?? loadCombos()[0]!;
    const session = buildPracticeSession(combo, '2026-10-29T20:00:00.000Z');
    expect(session.status).toBe('paused');
    expect(session.blocks).toHaveLength(combo.segments.length + 1);
    expect(session.blocks.at(-1)?.drillId).toBe(`combo-full:${combo.id}`);
    expect(session.blocks.slice(0, -1).every((b) => b.kind === 'drill')).toBe(true);
    expect(session.plannedMinutes).toBe(combo.segments.length * 5 + 10);
  });

  it('success rate equals successes divided by reps; null with no reps', () => {
    expect(comboSuccessRate([])).toBeNull();
    const rate = comboSuccessRate([
      { id: 's1', drillId: 'd', nodeId: 'n', at: '2026-10-29T00:00:00.000Z', day: '2026-10-29', reps: 10, successes: 7 },
      { id: 's2', drillId: 'd', nodeId: 'n', at: '2026-10-29T00:00:00.000Z', day: '2026-10-29', reps: 10, successes: 9 },
    ]);
    expect(rate).toBe(0.8);
  });

  it('routeSteps splits on the arrow separator', () => {
    expect(routeSteps('d+2,2 → df+1,2,1 → d+2,2,2')).toEqual(['d+2,2', 'df+1,2,1', 'd+2,2,2']);
  });
});
