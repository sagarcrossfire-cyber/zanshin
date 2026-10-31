// P11 — R2: a deleted moves pack is reseeded from the bundled seed, and
// the recovery is reported; a fresh install reports no reseed.
// §13.8: ensureIdentity writes profile/settings only (packs stay empty),
// so first paint does not wait on the 319-move bulkPut.
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ensureIdentity, seedIfEmpty, seedPacks } from '../../src/data/bootstrap';
import { packsRepo, resetDbForTests } from '../../src/data/repos';

beforeEach(async () => {
  await resetDbForTests();
});

afterEach(async () => {
  await resetDbForTests();
});

describe('seedIfEmpty pack recovery (R2)', () => {
  it('reseeds only the deleted moves pack and reports it', async () => {
    const first = await seedIfEmpty();
    expect(first.reseeded).toEqual([]);
    const before = await packsRepo.all();
    expect(before.some((p) => p.kind === 'moves')).toBe(true);

    const moves = await packsRepo.getByKind('moves');
    expect(moves).toBeDefined();
    await packsRepo.remove(moves?.id as string);
    expect(await packsRepo.getByKind('moves')).toBeUndefined();

    const second = await seedIfEmpty();
    expect(second.reseeded).toEqual(['moves']);
    const restored = await packsRepo.getByKind('moves');
    expect(restored).toBeDefined();
    expect(Array.isArray(restored?.data)).toBe(true);
    expect((restored?.data as unknown[]).length).toBe(319);
    // Nothing else was touched: same record count as the first seed.
    expect((await packsRepo.all()).length).toBe(before.length);
  });

  it('a fresh install seeds everything and reports no reseed', async () => {
    const seeded = await seedIfEmpty();
    expect(seeded.reseeded).toEqual([]);
    const kinds = (await packsRepo.all()).map((p) => p.kind).sort();
    expect(kinds).toEqual(['card-templates', 'combos', 'conflicts', 'curriculum', 'moves', 'punishers', 'roster', 'stances']);
  });

  it('ensureIdentity creates profile/settings without touching packs', async () => {
    const { profile, settings } = await ensureIdentity();
    expect(profile.id).toBeTruthy();
    expect(settings.id).toBeTruthy();
    expect(await packsRepo.all()).toEqual([]);
    const { reseeded } = await seedPacks();
    expect(reseeded).toEqual([]);
    expect((await packsRepo.all()).length).toBe(8);
  });
});
