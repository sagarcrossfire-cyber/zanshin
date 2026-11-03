// 2.0 M2 — pure rank-ladder helpers over the rank pack
// (src/data/packs/ranks.json): raw-number normalisation (Wank/ewgf both send
// alternate encodings for God of Destruction ranks), name lookups in both
// directions, band membership and the rank-vs-Path journey note.
import { describe, expect, it } from 'vitest';
import { loadRankPack } from '../../../src/data/packs/ranks';
import {
  bandForIndex, normalizeRankIndex, rankIndexByName, rankJourney, rankNameAt,
} from '../../../src/domain/ranked/ranks';

const pack = loadRankPack();

describe('normalizeRankIndex', () => {
  it('passes through a plain ladder index', () => {
    expect(normalizeRankIndex(0, pack)).toBe(0);
    expect(normalizeRankIndex(15, pack)).toBe(15);
    expect(normalizeRankIndex(37, pack)).toBe(37);
  });

  it('maps the alternate 100..107 encoding back to 29..36', () => {
    expect(normalizeRankIndex(100, pack)).toBe(29);
    expect(normalizeRankIndex(107, pack)).toBe(36);
  });

  it('maps the alternate 765 value to 37 (God of Destruction infinity)', () => {
    expect(normalizeRankIndex(765, pack)).toBe(37);
  });

  it('rejects null, undefined, non-integers and numbers outside every encoding', () => {
    expect(normalizeRankIndex(null, pack)).toBeNull();
    expect(normalizeRankIndex(undefined, pack)).toBeNull();
    expect(normalizeRankIndex(1.5, pack)).toBeNull();
    expect(normalizeRankIndex(9999, pack)).toBeNull();
    expect(normalizeRankIndex(-1, pack)).toBeNull();
  });
});

describe('rankNameAt / rankIndexByName', () => {
  it('names a ladder index, and resolves null/undefined to undefined', () => {
    expect(rankNameAt(15, pack)).toBe('Garyu');
    expect(rankNameAt(37, pack)).toBe('God of Destruction ∞');
    expect(rankNameAt(null, pack)).toBeUndefined();
    expect(rankNameAt(undefined, pack)).toBeUndefined();
  });

  it('finds a rank by name case- and whitespace-insensitively, and by alias', () => {
    expect(rankIndexByName('garyu', pack)).toBe(15);
    expect(rankIndexByName('  Garyu  ', pack)).toBe(15);
    expect(rankIndexByName('GOD OF DESTRUCTION INFINITY', pack)).toBe(37);
  });

  it('returns null for an unknown or empty name', () => {
    expect(rankIndexByName('Not A Rank', pack)).toBeNull();
    expect(rankIndexByName('', pack)).toBeNull();
    expect(rankIndexByName(null, pack)).toBeNull();
    expect(rankIndexByName(undefined, pack)).toBeNull();
  });
});

describe('bandForIndex', () => {
  it('finds the band a rank index sits in', () => {
    expect(bandForIndex(0, pack)?.id).toBe('foundations');
    expect(bandForIndex(15, pack)?.id).toBe('dragons');
    expect(bandForIndex(37, pack)?.id).toBe('destruction');
  });

  it('returns undefined for null/undefined', () => {
    expect(bandForIndex(null, pack)).toBeUndefined();
    expect(bandForIndex(undefined, pack)).toBeUndefined();
  });
});

describe('rankJourney', () => {
  it('prompts a sync when the rank is unknown', () => {
    const journey = rankJourney(null, null, pack);
    expect(journey.rankIndex).toBeNull();
    expect(journey.note).toMatch(/Sync your ranked matches/);
    expect(journey.bands.every((b) => b.state === 'above')).toBe(true);
  });

  it('describes the band\'s usual work when the Path stage is unknown', () => {
    const journey = rankJourney(15, null, pack);
    expect(journey.rankName).toBe('Garyu');
    expect(journey.band?.id).toBe('dragons');
    expect(journey.note).toMatch(/Garyu sits in Garyu → Tenryu/);
  });

  it('notes when the rank is ahead of the Path', () => {
    const journey = rankJourney(21, 2, pack); // Fujin (stage 7) vs Path stage 2
    expect(journey.note).toMatch(/ahead of your Path/);
  });

  it('notes when the Path is ahead of the rank', () => {
    const journey = rankJourney(0, 8, pack); // Beginner (stage 0-3) vs Path stage 8
    expect(journey.note).toMatch(/ahead of your rank/);
  });

  it('notes a match between the rank band and the Path stage', () => {
    const journey = rankJourney(15, 4, pack); // Garyu, stage 4 (within dragons [4,5])
    expect(journey.note).toMatch(/matches your rank band/);
  });

  it('marks bands below, at, and above the current one', () => {
    const journey = rankJourney(16, null, pack); // Shinryu, dragons band [15,17]
    const states = Object.fromEntries(journey.bands.map((b) => [b.band.id, b.state]));
    expect(states.foundations).toBe('below');
    expect(states.dragons).toBe('current');
    expect(states.rulers).toBe('above');
  });
});
