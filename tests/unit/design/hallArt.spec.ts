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

describe('hall photos (2.0 M6)', () => {
  it('has one credited photo per hub, each with its files on disk', async () => {
    const { existsSync } = await import('node:fs');
    const { HALL_PHOTOS } = await import('../../../src/components/layout/HallArt');
    const hubs = HALL_PHOTOS.map((p) => p.hub).sort();
    expect(hubs).toEqual(['coach', 'study', 'today', 'train', 'you']);
    for (const photo of HALL_PHOTOS) {
      expect(photo.photographer.length).toBeGreaterThan(0);
      expect(photo.page).toMatch(/^https:\/\/unsplash\.com\/photos\//);
      expect(photo.position).toMatch(/^\d+% \d+%$/);
      for (const w of [800, 1600]) {
        for (const f of photo.formats) expect(existsSync(`public/art/${photo.hub}-${w}.${f}`)).toBe(true);
      }
    }
  });

  it('builds image-set() best format first, and a plain WebP fallback', async () => {
    const { hallPhotoImage, hallPhotoFallback } = await import('../../../src/components/layout/HallArt');
    const credit = { hub: 'today', id: 'x', photographer: 'p', handle: '@p', page: 'https://unsplash.com/photos/x', position: '50% 50%', formats: ['webp', 'avif'], license: 'Unsplash License' };
    expect(hallPhotoImage(credit, 800)).toBe('image-set(url("/art/today-800.avif") type("image/avif"), url("/art/today-800.webp") type("image/webp"))');
    expect(hallPhotoFallback(credit, 1600)).toBe('url("/art/today-1600.webp")');
  });
});
