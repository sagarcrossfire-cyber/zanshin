// §5.11 — Matchups service: problem moves create one Lab drill + one
// flashcard (AC-MU-1); character pack imports cache and do not refetch.
import { describe, expect, it, vi } from 'vitest';

const specifier: string = 'fake-indexeddb';
const fakeModule = await import(specifier).catch(() => null) as Record<string, unknown> | null;
const fakeAvailable = fakeModule !== null && typeof fakeModule['indexedDB'] === 'object';
if (fakeAvailable) {
  const globals = globalThis as Record<string, unknown>;
  globals['indexedDB'] = fakeModule?.['indexedDB'];
  globals['IDBKeyRange'] = fakeModule?.['IDBKeyRange'];
}

const dbModule = fakeAvailable ? await import('../../src/data/db') : null;
const matchups = fakeAvailable ? await import('../../src/services/matchups') : null;
const repos = fakeAvailable ? await import('../../src/data/repos/index') : null;

describe.skipIf(!fakeAvailable)('matchups service', () => {
  it('createProblemMove links one drill and one flashcard (AC-MU-1)', async () => {
    if (dbModule === null || matchups === null || repos === null) return;
    await dbModule.resetDbForTests();
    const problemMove = await matchups.createProblemMove({
      character: 'Kazuya',
      input: 'df+2',
      description: 'Launch punishes my whiffs.',
      answerKind: 'punish',
      answerDetail: 'Block and launch with df+2.',
      createdFrom: 'log',
      nowIso: '2026-10-30T20:00:00.000Z',
    });
    expect(problemMove.drillId).toBe(`problem:${problemMove.id}`);
    expect(problemMove.cardId).toBeDefined();
    const card = await repos.cardsRepo.get(problemMove.cardId as string);
    expect(card).toBeDefined();
    expect(card?.deck).toBe('Kazuya');
    const stored = await repos.problemMovesRepo.get(problemMove.id);
    expect(stored?.answer.kind).toBe('punish');
  });

  it('importCharacterPack caches: the second call does not fetch', async () => {
    if (dbModule === null || matchups === null) return;
    await dbModule.resetDbForTests();
    const payload = {
      cargoquery: {
        title: [{
          'Move.alias': '', 'Move.alt': '', 'Move.block': '-13', 'Move.ch': '', 'Move.crush': '',
          'Move.damage': '20', 'Move.hit': '+5', 'Move.id': 'Kazuya-df+2', 'Move.input': 'df+2',
          'Move.name': 'Twin Pistons', 'Move.notes': '', 'Move.num': 1, 'Move.parent': '',
          'Move.recv': '', 'Move.startup': 'i15', 'Move.target': 'm', 'Move.tot': '',
        }],
      },
    };
    const fetcher = vi.fn(async () => ({
      ok: true, status: 200,
      json: async () => payload,
      text: async () => JSON.stringify(payload),
    }));
    const first = await matchups.importCharacterPack(fetcher as never, 'Kazuya', '3.02.02');
    const second = await matchups.importCharacterPack(fetcher as never, 'Kazuya', '3.02.02');
    expect(first).toBeGreaterThan(0);
    expect(second).toBe(first);
    // One Cargo page + one revision lookup on the first import; the cached
    // second import fetches nothing.
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
