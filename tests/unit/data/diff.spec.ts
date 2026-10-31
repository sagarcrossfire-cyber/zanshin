// §7.7 — Patch-diff golden test: changed fields with old/new values, added, removed, sorted by num then id.
import { describe, expect, it } from 'vitest';
import { diffPacks } from '../../../src/data/import/diff';
import { seedProvenance, type Move } from '../../../src/data/schemas';

function move(overrides: Partial<Move> & { id: string; input: string }): Move {
  return {
    character: 'Yoshimitsu',
    aliases: [],
    altInputs: [],
    hitLevel: 'm',
    damage: '10',
    startup: 'i10',
    tags: [],
    provenance: seedProvenance,
    ...overrides,
  };
}

const oldMoves: Move[] = [
  move({ id: 'Yoshimitsu-b+2,2', input: 'b+2,2', num: 30, block: '-13', blockMin: -13, hit: '+2a', damage: '12,21', hitLevel: 'm,h', tags: ['heat-engager'] }),
  move({ id: 'Yoshimitsu-1+4', input: '1+4', num: 10, block: '-20', hit: '+14c', damage: '20', tags: ['panic'] }),
  move({ id: 'Yoshimitsu-old', input: 'old', num: 99, damage: '5' }),
  move({ id: 'Yoshimitsu-zeta', input: 'zeta', damage: '5' }),
];

const newMoves: Move[] = [
  move({ id: 'Yoshimitsu-b+2,2', input: 'b+2,2', num: 30, block: '-9', blockMin: -9, hit: '+2a', damage: '12,21', hitLevel: 'm,h', tags: ['heat-engager', 'whiff-punisher'] }),
  move({ id: 'Yoshimitsu-1+4', input: '1+4', num: 10, block: '-20', hit: '+14c', damage: '20', tags: ['panic'] }),
  move({ id: 'Yoshimitsu-new', input: 'new', num: 5, damage: '7' }),
  move({ id: 'Yoshimitsu-alpha', input: 'alpha', damage: '7' }),
];

describe('diffPacks', () => {
  it('matches the golden diff', () => {
    expect(diffPacks(oldMoves, newMoves)).toEqual({
      changed: [
        {
          id: 'Yoshimitsu-b+2,2',
          num: 30,
          fields: [
            { field: 'block', oldValue: '-13', newValue: '-9' },
            { field: 'tags', oldValue: 'heat-engager', newValue: 'heat-engager,whiff-punisher' },
          ],
        },
      ],
      added: [
        move({ id: 'Yoshimitsu-new', input: 'new', num: 5, damage: '7' }),
        move({ id: 'Yoshimitsu-alpha', input: 'alpha', damage: '7' }),
      ],
      removed: [
        move({ id: 'Yoshimitsu-old', input: 'old', num: 99, damage: '5' }),
        move({ id: 'Yoshimitsu-zeta', input: 'zeta', damage: '5' }),
      ],
    });
  });

  it('ignores unchanged moves and compares tags order-insensitively', () => {
    const a = move({ id: 'Yoshimitsu-x', input: 'x', tags: ['panic', 'keepout'] });
    const b = move({ id: 'Yoshimitsu-x', input: 'x', tags: ['keepout', 'panic'] });
    expect(diffPacks([a], [b])).toEqual({ changed: [], added: [], removed: [] });
  });

  it('returns empty diffs for identical packs', () => {
    expect(diffPacks(oldMoves, oldMoves)).toEqual({ changed: [], added: [], removed: [] });
  });
});
