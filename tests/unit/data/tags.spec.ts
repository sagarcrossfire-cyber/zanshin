// §6.7 — Derived-tag rules, one fixture per rule, plus curated-list and notes-word merging.
import { describe, expect, it } from 'vitest';
import { deriveTags, mergeTags, type TagInput } from '../../../src/data/import/tags';

function tagInput(overrides: Partial<TagInput>): TagInput {
  return {
    id: 'Yoshimitsu-test',
    input: 'test',
    hitLevel: 'm',
    ...overrides,
  };
}

describe('deriveTags field rules', () => {
  it('unblockable when the hit level contains !', () => {
    expect(deriveTags(tagInput({ hitLevel: 'l!' }))).toContain('unblockable');
  });

  it('throw when the hit level contains t', () => {
    expect(deriveTags(tagInput({ hitLevel: 't' }))).toContain('throw');
    expect(deriveTags(tagInput({ hitLevel: 'm,t' }))).toContain('throw');
  });

  it('power-crush from pc and parry from ps in the crush field', () => {
    expect(deriveTags(tagInput({ crush: 'pc7~17' }))).toContain('power-crush');
    expect(deriveTags(tagInput({ crush: 'ps3~9' }))).toContain('parry');
  });

  it('low-crush from js and high-crush from cs in the crush field', () => {
    expect(deriveTags(tagInput({ crush: 'js9~33' }))).toContain('low-crush');
    expect(deriveTags(tagInput({ crush: 'cs6~14' }))).toContain('high-crush');
  });

  it('plus-on-block when the worst-case block value is +1 or better', () => {
    expect(deriveTags(tagInput({ blockMin: 1 }))).toContain('plus-on-block');
    expect(deriveTags(tagInput({ blockMin: 7 }))).toContain('plus-on-block');
    expect(deriveTags(tagInput({ blockMin: 0 }))).not.toContain('plus-on-block');
    expect(deriveTags(tagInput({ blockMin: -9 }))).not.toContain('plus-on-block');
  });

  it('launcher when the hit value is +20 or more with the a suffix', () => {
    expect(deriveTags(tagInput({ hit: '+34a (+24)' }))).toContain('launcher');
    expect(deriveTags(tagInput({ hit: '+15g' }))).not.toContain('launcher');
  });

  it('ch-launcher only when the counter hit launches and the normal hit does not', () => {
    expect(deriveTags(tagInput({ hit: '+6g', counterHit: '+58a (+38)' }))).toContain('ch-launcher');
    expect(deriveTags(tagInput({ hit: '+6g', counterHit: '+58a (+38)' }))).not.toContain('launcher');
    expect(deriveTags(tagInput({ hit: '+35a (+25a)', counterHit: '+35a (+25a)' }))).not.toContain('ch-launcher');
  });

  it('heat-only for ids starting with Yoshimitsu-H.', () => {
    expect(deriveTags(tagInput({ id: 'Yoshimitsu-H.2+3', input: 'H.2+3' }))).toContain('heat-only');
    expect(deriveTags(tagInput({ id: 'Yoshimitsu-2+3', input: '2+3' }))).not.toContain('heat-only');
  });

  it('heat-smash, heat-burst and rage-art from the input prefix', () => {
    expect(deriveTags(tagInput({ input: 'H.2+3' }))).toContain('heat-smash');
    expect(deriveTags(tagInput({ input: '2+3' }))).toContain('heat-burst');
    expect(deriveTags(tagInput({ input: 'R.df+1+2' }))).toContain('rage-art');
  });

  it('stance-entry for direct stance-entry inputs', () => {
    expect(deriveTags(tagInput({ input: 'b+1+2' }))).toContain('stance-entry');
    expect(deriveTags(tagInput({ input: '3+4' }))).toContain('stance-entry');
  });
});

describe('deriveTags curated lists and notes wording', () => {
  it('adds heat-engager, homing, tornado, wall/floor/balcony-break and hp-cost from the curated lists', () => {
    expect(deriveTags(tagInput({ input: 'b+2,2' }))).toContain('heat-engager');
    expect(deriveTags(tagInput({ input: 'f+3' }))).toContain('homing');
    expect(deriveTags(tagInput({ input: 'd+2,2,2' }))).toContain('tornado');
    expect(deriveTags(tagInput({ input: '3,2,1+2' }))).toContain('wall-break');
    expect(deriveTags(tagInput({ input: 'd+1' }))).toContain('floor-break');
    expect(deriveTags(tagInput({ input: 'H.2+3' }))).toContain('balcony-break');
    expect(deriveTags(tagInput({ input: 'f,F+1+4' }))).toContain('hp-cost');
  });

  it('adds curated tags from words in the notes', () => {
    expect(deriveTags(tagInput({ input: 'x', notes: 'A Heat Engager on hit' }))).toContain('heat-engager');
    expect(deriveTags(tagInput({ input: 'x', notes: 'Tornado combo filler' }))).toContain('tornado');
    expect(deriveTags(tagInput({ input: 'x', notes: 'Costs his own health' }))).toContain('hp-cost');
    expect(deriveTags(tagInput({ input: 'x', notes: 'Wall break ender' }))).toContain('wall-break');
  });

  it('adds punisher tags from the punisher context', () => {
    const context = {
      standingInputs: new Set(['df+1,4']),
      crouchingInputs: new Set(['ws4']),
    };
    expect(deriveTags(tagInput({ input: 'df+1,4' }), context)).toContain('punisher-standing');
    expect(deriveTags(tagInput({ input: 'ws4' }), context)).toContain('punisher-crouching');
    expect(deriveTags(tagInput({ input: 'df+1,4' }), context)).not.toContain('punisher-crouching');
    expect(deriveTags(tagInput({ input: 'df+1,4' }))).not.toContain('punisher-standing');
  });

  it('never duplicates a tag', () => {
    const tags = deriveTags(tagInput({ input: 'H.2+3', hitLevel: 'm', blockMin: 4, notes: 'Wall break and balcony break' }));
    expect(new Set(tags).size).toBe(tags.length);
    expect(tags).toContain('wall-break');
    expect(tags).toContain('balcony-break');
  });
});

describe('mergeTags', () => {
  it('keeps derived order first and deduplicates curated tags', () => {
    expect(mergeTags(['launcher', 'keepout'], ['keepout', 'panic'])).toEqual(['launcher', 'keepout', 'panic']);
  });
});
