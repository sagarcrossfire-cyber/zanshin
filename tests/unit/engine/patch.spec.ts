// Spec §7.7 — patch impact.
import { applyPatchImpact, type PackDiff, type PatchState } from '../../../src/domain/engine/patch';

const DIFF: PackDiff = {
  patch: '3.02.03',
  previousPatch: '3.02.02',
  changed: [
    {
      moveId: 'Yoshimitsu-b+2,2', num: 12, input: 'b+2,2', importance: 3,
      changes: [{ field: 'block', oldValue: '-13', newValue: '-9' }],
    },
    {
      moveId: 'Yoshimitsu-3,1', num: 13, input: '3,1', importance: 2,
      changes: [
        { field: 'damage', oldValue: '12,20', newValue: '12,18' },
        { field: 'block', oldValue: '+7', newValue: '+6' },
      ],
    },
  ],
  added: [{ moveId: 'Yoshimitsu-new', num: 99, input: 'db+1+2' }],
  removed: [{ moveId: 'Yoshimitsu-old', num: 98, input: 'd+9' }],
};

const STATE: PatchState = {
  cardsByMove: {
    'Yoshimitsu-b+2,2': ['card-a', 'card-b'],
    'Yoshimitsu-3,1': ['card-b', 'card-c'],
  },
  provenanceByMove: { 'Yoshimitsu-b+2,2': 'verified', 'Yoshimitsu-3,1': 'sourced' },
};

describe('applyPatchImpact', () => {
  it('makes all linked cards due today, deduplicated, in move order', () => {
    expect(applyPatchImpact(DIFF, STATE).cardsDueToday).toEqual(['card-a', 'card-b', 'card-c']);
  });

  it('resets provenance verified -> sourced only for verified moves', () => {
    expect(applyPatchImpact(DIFF, STATE).provenanceResets).toEqual([
      { moveId: 'Yoshimitsu-b+2,2', from: 'verified', to: 'sourced' },
    ]);
  });

  it('queues one verify task per changed move, most important first, capped at 5', () => {
    const many: PackDiff = {
      ...DIFF,
      changed: Array.from({ length: 7 }, (_, i) => ({
        moveId: `Yoshimitsu-m${i}`, num: i + 1, input: `m${i}`, importance: i + 1,
        changes: [{ field: 'block', oldValue: '-10', newValue: '-9' }],
      })),
    };
    const result = applyPatchImpact(many, { cardsByMove: {}, provenanceByMove: {} });
    expect(result.verifyTasks).toHaveLength(5);
    expect(result.verifyTasks[0]?.moveId).toBe('Yoshimitsu-m6');
    expect(result.verifyTasks[4]?.moveId).toBe('Yoshimitsu-m2');
  });

  it('builds the banner from the first (block) change, with added/removed counts', () => {
    const result = applyPatchImpact(DIFF, STATE);
    expect(result.bannerText).toBe(
      '2 Yoshimitsu moves changed. 1 added. 1 removed. b+2,2 on block: -13 → -9.',
    );
  });

  it('prefers the block change in the banner when a move has several changes', () => {
    const single: PackDiff = { ...DIFF, changed: [DIFF.changed[1] as PackDiff['changed'][number]], added: [], removed: [] };
    expect(applyPatchImpact(single, STATE).bannerText).toBe(
      '1 Yoshimitsu move changed. 3,1 on block: +7 → +6.',
    );
  });

  it('reports no changes cleanly', () => {
    const result = applyPatchImpact(
      { patch: '3.02.03', changed: [], added: [], removed: [] },
      { cardsByMove: {}, provenanceByMove: {} },
    );
    expect(result).toEqual({
      cardsDueToday: [], verifyTasks: [], provenanceResets: [],
      bannerText: 'No Yoshimitsu moves changed.',
    });
  });

  it('sorts verify tasks by move number then id when importance ties', () => {
    const tied: PackDiff = {
      patch: '3.02.03',
      changed: [
        { moveId: 'Yoshimitsu-z', num: 5, input: 'z', changes: [{ field: 'block', oldValue: '0', newValue: '-1' }] },
        { moveId: 'Yoshimitsu-a', num: 5, input: 'a', changes: [{ field: 'block', oldValue: '0', newValue: '-1' }] },
        { moveId: 'Yoshimitsu-b', num: 2, input: 'b', changes: [{ field: 'block', oldValue: '0', newValue: '-1' }] },
      ],
      added: [], removed: [],
    };
    const result = applyPatchImpact(tied, { cardsByMove: {}, provenanceByMove: {} });
    expect(result.verifyTasks.map((t) => t.moveId)).toEqual(['Yoshimitsu-b', 'Yoshimitsu-a', 'Yoshimitsu-z']);
  });
});
