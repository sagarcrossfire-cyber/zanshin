// §6.4 — Schema round-trip tests: a record survives JSON serialization unchanged,
// and invalid records are rejected instead of silently accepted.
import { describe, expect, it } from 'vitest';
import {
  drillSchema, masterySchema, moveSchema, punisherSchema, seedProvenance,
} from '../../../src/data/schemas';
import { loadMovesYoshimitsu, loadPunishers } from '../../../src/data/packs/index';

describe('schema round-trips', () => {
  it('a seed move survives a JSON round-trip unchanged', () => {
    const moves = loadMovesYoshimitsu();
    expect(moves.length).toBeGreaterThan(0);
    for (const move of moves) {
      const reparsed = moveSchema.parse(JSON.parse(JSON.stringify(move)) as unknown);
      expect(reparsed).toEqual(move);
    }
  });

  it('a punisher survives a JSON round-trip unchanged', () => {
    for (const punisher of loadPunishers()) {
      expect(punisherSchema.parse(JSON.parse(JSON.stringify(punisher)) as unknown)).toEqual(punisher);
    }
  });

  it('a drill survives a JSON round-trip unchanged', () => {
    const drill = {
      id: 'd-test',
      nodeId: 'n1-punish',
      title: 'Test drill',
      type: 'punish',
      recipe: ['Record a move.'],
      steps: ['Block it.', 'Punish it.'],
      repsPerSet: 10,
      sets: 3,
      target: { successRate: 0.8, sets: 3, days: 1 },
      progressions: ['Add the P2 side.'],
      regressions: ['Use a fixed dummy.'],
      minutes: 10,
      codexRefs: [],
    };
    expect(drillSchema.parse(JSON.parse(JSON.stringify(drill)) as unknown)).toEqual(drill);
  });
});

describe('schema rejection', () => {
  it('rejects a move without an id', () => {
    expect(() =>
      moveSchema.parse({
        character: 'Yoshimitsu',
        aliases: [],
        altInputs: [],
        hitLevel: 'm',
        damage: '10',
        startup: 'i10',
        tags: [],
        provenance: seedProvenance,
      }),
    ).toThrow();
  });

  it('rejects an unknown provenance status', () => {
    expect(() =>
      moveSchema.parse({
        id: 'Yoshimitsu-x',
        character: 'Yoshimitsu',
        aliases: [],
        altInputs: [],
        hitLevel: 'm',
        damage: '10',
        startup: 'i10',
        tags: [],
        provenance: { source: 'seed', patch: '3.02.02', status: 'maybe' },
      }),
    ).toThrow();
  });

  it('rejects an unknown move tag', () => {
    expect(() =>
      moveSchema.parse({
        id: 'Yoshimitsu-x',
        character: 'Yoshimitsu',
        aliases: [],
        altInputs: [],
        hitLevel: 'm',
        damage: '10',
        startup: 'i10',
        tags: ['not-a-tag'],
        provenance: seedProvenance,
      }),
    ).toThrow();
  });

  it('rejects a mastery score outside 0-100', () => {
    expect(() =>
      masterySchema.parse({
        nodeId: 'n1-punish',
        K: null,
        E: null,
        A: null,
        score: 101,
        state: 'learning',
        placed: false,
        evidenceDays: [],
        updatedAt: '2026-10-29T00:00:00Z',
      }),
    ).toThrow();
  });
});
