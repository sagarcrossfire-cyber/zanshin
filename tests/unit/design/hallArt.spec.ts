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
    const hubs = HALL_PHOTOS.filter((p) => !p.section).map((p) => p.hub).sort();
    expect(hubs).toEqual(['coach', 'study', 'today', 'train', 'you']);
    for (const photo of HALL_PHOTOS) {
      expect(photo.photographer.length).toBeGreaterThan(0);
      expect(photo.page).toMatch(/^https:\/\/unsplash\.com\/photos\//);
      expect(photo.position).toMatch(/^\d+% \d+%$/);
      for (const w of [800, 1600]) {
        for (const f of photo.formats) expect(existsSync(`public/art/${photo.section ?? photo.hub}-${w}.${f}`)).toBe(true);
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

describe('section halls (2.0 M6)', () => {
  it('Heat and Punish Trainer have their own photos; other sections use the hub photo', async () => {
    const { hallPhotoFor, hallLabel } = await import('../../../src/components/layout/HallArt');
    expect(hallPhotoFor('study', 'heat')?.section).toBe('heat');
    expect(hallPhotoFor('train', 'punish')?.section).toBe('punish');
    expect(hallPhotoFor('study', 'matchups')?.section).toBeUndefined();
    expect(hallPhotoFor('study', 'matchups')?.hub).toBe('study');
    expect(hallLabel(hallPhotoFor('study', 'heat')!)).toBe('Study · Heat');
    expect(hallLabel(hallPhotoFor('train', null)!)).toBe('Train');
  });

  it('section photos are named after the section', async () => {
    const { hallPhotoImage } = await import('../../../src/components/layout/HallArt');
    const credit = { hub: 'study', section: 'heat', id: 'x', photographer: 'p', handle: '@p', page: 'https://unsplash.com/photos/x', position: '50% 50%', formats: ['avif'], license: 'Unsplash License' };
    expect(hallPhotoImage(credit, 800)).toBe('image-set(url("/art/heat-800.avif") type("image/avif"))');
  });
});
