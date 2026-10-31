// Spec §7.3 — seeded randomness.
import { hashSeed, mulberry32 } from '../../../src/domain/engine/prng';

describe('mulberry32', () => {
  it('reproduces the same sequence for the same seed', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const seqA = [a(), a(), a(), a(), a()];
    const seqB = [b(), b(), b(), b(), b()];
    expect(seqA).toEqual(seqB);
  });

  it('stays in [0, 1)', () => {
    const rng = mulberry32(7);
    for (let i = 0; i < 1000; i += 1) {
      const value = rng();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it('differs across seeds', () => {
    const a = mulberry32(1)();
    const b = mulberry32(2)();
    expect(a).not.toBe(b);
  });
});

describe('hashSeed', () => {
  it('is deterministic and distinguishes strings', () => {
    expect(hashSeed('2026-10-30:me')).toBe(hashSeed('2026-10-30:me'));
    expect(hashSeed('a')).not.toBe(hashSeed('b'));
    expect(hashSeed('')).toBe(0x811c9dc5);
  });

  it('returns an unsigned 32-bit integer', () => {
    const value = hashSeed('zanshin');
    expect(Number.isInteger(value)).toBe(true);
    expect(value).toBeGreaterThanOrEqual(0);
    expect(value).toBeLessThanOrEqual(0xffffffff);
  });
});
