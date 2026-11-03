import { describe, expect, it } from 'vitest';
import { ridgePath } from '../../../src/components/layout/HallArt';

describe('hall ridges (2.0 M6)', () => {
  it('are deterministic per seed, so a hub keeps its skyline', () => {
    expect(ridgePath(37, 205, 72, 7)).toBe(ridgePath(37, 205, 72, 7));
    expect(ridgePath(37, 205, 72, 7)).not.toBe(ridgePath(41, 205, 72, 7));
  });

  it('are closed shapes along the bottom edge that stay inside the frame', () => {
    const d = ridgePath(11, 205, 72, 7);
    expect(d.startsWith('M0 220 ')).toBe(true);
    expect(d.endsWith('L1200 220 Z')).toBe(true);
    const ys = [...d.matchAll(/(-?\d+) (-?\d+)/g)].map((m) => Number(m[2]));
    expect(Math.min(...ys)).toBeGreaterThan(80); // peaks stay in the lower part (text sits above)
  });
});
