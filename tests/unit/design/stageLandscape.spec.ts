import { describe, expect, it } from 'vitest';
import { stageRidges, stageScene } from '../../../src/components/decor/StageLandscape';

describe('Path stage landscapes (2.0 M6)', () => {
  it('climbs from foothills to the moon over water across ten stages', () => {
    const scenes = Array.from({ length: 10 }, (_, i) => stageScene(i, 10));
    expect(scenes[0]).toBe('foothills');
    expect(scenes[9]).toBe('moon');
    expect(new Set(scenes)).toEqual(new Set(['foothills', 'mist', 'shrine', 'peaks', 'moon']));
    // Never steps back down the mountain.
    const order = ['foothills', 'mist', 'shrine', 'peaks', 'moon'];
    for (let i = 1; i < scenes.length; i += 1) expect(order.indexOf(scenes[i]!)).toBeGreaterThanOrEqual(order.indexOf(scenes[i - 1]!));
  });

  it('copes with a curriculum of one stage', () => {
    expect(stageScene(0, 1)).toBe('foothills');
  });

  it('raises the ridges as the stages go up', () => {
    const topOf = (d: string) => Math.min(...[...d.matchAll(/ (\d+)(?= |$)/g)].map((m) => Number(m[1])).filter((y) => y < 220));
    const low = topOf(stageRidges(0)[0]!.d);
    const high = topOf(stageRidges(9)[0]!.d);
    expect(high).toBeLessThan(low);
    expect(stageRidges(3)).toHaveLength(3);
  });
});
