// 2.0 M2 — RANKS now reads the 38-rung rank pack (adds plain "God of
// Destruction" at index 29). Stored 1.4.1 profiles only ever held one of the
// 37 names below, so every one of them must still resolve in RANKS.
import { describe, expect, it } from 'vitest';
import { RANKS } from '../../../src/config/ranks';

const RANKS_1_4_1 = [
  'Beginner', '1st Dan', '2nd Dan', 'Fighter', 'Strategist', 'Combatant', 'Brawler', 'Ranger',
  'Cavalry', 'Warrior', 'Assailant', 'Dominator', 'Vanquisher', 'Destroyer', 'Eliminator', 'Garyu',
  'Shinryu', 'Tenryu', 'Mighty Ruler', 'Flame Ruler', 'Battle Ruler', 'Fujin', 'Raijin', 'Kishin',
  'Bushin', 'Tekken King', 'Tekken Emperor', 'Tekken God', 'Tekken God Supreme',
  'God of Destruction I', 'God of Destruction II', 'God of Destruction III', 'God of Destruction IV',
  'God of Destruction V', 'God of Destruction VI', 'God of Destruction VII', 'God of Destruction ∞',
];

describe('RANKS (2.0 M2 rank pack)', () => {
  it('has 38 rungs, in ladder order', () => {
    expect(RANKS).toHaveLength(38);
    expect(RANKS[0]).toBe('Beginner');
    expect(RANKS.at(-1)).toBe('God of Destruction ∞');
  });

  it('every rank name from the 1.4.1 37-entry list is still present (stored profiles keep working)', () => {
    expect(RANKS_1_4_1).toHaveLength(37);
    for (const name of RANKS_1_4_1) {
      expect(RANKS).toContain(name);
    }
  });

  it('adds the plain "God of Destruction" rung 1.4.1 lacked', () => {
    expect(RANKS).toContain('God of Destruction');
  });
});
