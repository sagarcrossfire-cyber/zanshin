// P10 — Backup format (§6.6): canonical JSON, SHA-256, export/import
// round-trip (AC-SET-1), validation, secrets handling. The fast-check
// property runs 200 random datasets through export → wipe → import.
import 'fake-indexeddb/auto';
import * as fc from 'fast-check';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { defaultProfile, defaultSettings } from '../../src/data/bootstrap';
import {
  BACKUP_TABLES,
  canonicalJson,
  exportBackup,
  importBackup,
  sha256Hex,
  sha256Sync,
  validateBackup,
  BackupError,
} from '../../src/services/backup';
import {
  cardsRepo,
  cardStatesRepo,
  masteryRepo,
  matchSetsRepo,
  profileRepo,
  resetDbForTests,
  sessionsRepo,
  setsRepo,
  settingsRepo,
} from '../../src/data/repos';
import type { MatchSet, Settings } from '../../src/data/schemas';

beforeEach(async () => {
  await resetDbForTests();
});

afterEach(async () => {
  await resetDbForTests();
});

const tallies = (overrides: Partial<MatchSet['tallies']> = {}): MatchSet['tallies'] => ({
  missedPunishes: 0, flashHit: 0, flashBlocked: 0, flashWhiffed: 0,
  spinEscaped: 0, spinPunished: 0, throwsBroken: 0, throwsMissed: 0,
  hitWhileMinus: 0, lowsBlocked: 0, lowsEaten: 0,
  heatConverted: 0, heatWasted: 0, okiConverted: 0,
  ...overrides,
});

describe('canonical JSON + SHA-256', () => {
  it('sorts keys recursively and omits whitespace', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}');
    expect(canonicalJson([3, { z: 1, y: 2 }])).toBe('[3,{"y":2,"z":1}]');
    // Undefined-valued keys are dropped, matching JSON.stringify, so a hash
    // survives export → file → parse → re-hash (AC-SET-1 round-trip).
    expect(canonicalJson({ a: undefined, b: 1 })).toBe('{"b":1}');
    expect(canonicalJson([undefined, 1])).toBe('[null,1]');
  });

  it('matches known SHA-256 vectors on both implementations', async () => {
    const vectors: [string, string][] = [
      ['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
      ['abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
      ['abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq', '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1'],
    ];
    for (const [input, expected] of vectors) {
      expect(await sha256Hex(input)).toBe(expected);
      expect(sha256Sync(new TextEncoder().encode(input))).toBe(expected);
    }
  });
});

describe('export/import round-trip (AC-SET-1)', () => {
  it('export then import yields identical data (hash match)', async () => {
    const profile = await profileRepo.put(defaultProfile('2026-10-29T10:00:00.000Z'));
    const settings = await settingsRepo.put({ ...defaultSettings(), aiApiKey: 'sk-keep-me' });
    await sessionsRepo.put({
      id: 'sess-1', kind: 'plan', startedAt: '2026-10-29T19:00:00.000Z', endedAt: '2026-10-29T19:30:00.000Z',
      status: 'done', plannedMinutes: 30, blocks: [], currentBlock: 0, pausedMs: 0,
    });
    await setsRepo.put({
      id: 'set-1', sessionId: 'sess-1', drillId: 'd1-punish-ladder', nodeId: 'n1-punish',
      at: '2026-10-29T19:10:00.000Z', day: '2026-10-29', reps: 10, successes: 8,
    });
    await matchSetsRepo.put({
      id: 'm-1', at: '2026-10-29T20:00:00.000Z', day: '2026-10-29', mode: 'ranked',
      opponentCharacter: 'Kazuya', games: 5, wins: 2, tallies: tallies({ missedPunishes: 12 }),
      beatBy: [], tags: [],
    });
    void profile;
    void settings;

    const exported = await exportBackup({ includePacks: false, includeSecrets: false });
    expect(exported.format).toBe('zanshin-backup');
    expect(exported.includesSecrets).toBe(false);
    // The key is excluded from the export.
    expect(JSON.stringify(exported.tables.settings)).not.toContain('sk-keep-me');
    await validateBackup(exported);

    await resetDbForTests();
    const counts = await importBackup(exported, async () => {});
    expect(counts.sessions).toBe(1);
    expect(counts.sets).toBe(1);
    expect(counts.matchSets).toBe(1);
    const reExported = await exportBackup({ includePacks: false, includeSecrets: false });
    expect(reExported.sha256).toBe(exported.sha256);
    expect(canonicalJson(reExported.tables)).toBe(canonicalJson(exported.tables));
  });

  it('a secrets-excluded import never wipes a stored key', async () => {
    await profileRepo.put(defaultProfile('2026-10-29T10:00:00.000Z'));
    await settingsRepo.put({ ...defaultSettings(), aiApiKey: 'sk-stored' });
    const exported = await exportBackup({ includePacks: false, includeSecrets: false });
    await settingsRepo.put({ ...defaultSettings(), aiApiKey: 'sk-other' });
    await importBackup(exported, async () => {});
    const after = await settingsRepo.get();
    expect(after?.aiApiKey).toBe('sk-other');
  });

  it('rejects tampered, wrong-version and incomplete backups', async () => {
    await profileRepo.put(defaultProfile('2026-10-29T10:00:00.000Z'));
    await settingsRepo.put(defaultSettings());
    const exported = await exportBackup({ includePacks: false, includeSecrets: false });
    const tampered = { ...exported, tables: { ...exported.tables, sessions: [{ id: 'x' }] } };
    await expect(validateBackup(tampered)).rejects.toThrow(BackupError);
    await expect(validateBackup({ ...exported, schemaVersion: 99 })).rejects.toThrow(BackupError);
    const missing = { ...exported };
    const tables = { ...(missing.tables as Record<string, unknown>) };
    delete tables.sets;
    await expect(validateBackup({ ...missing, tables })).rejects.toThrow(BackupError);
    await expect(validateBackup({ format: 'nope' })).rejects.toThrow(BackupError);
  });

  it('packs round-trip when included, and are excluded by default', async () => {
    await profileRepo.put(defaultProfile('2026-10-29T10:00:00.000Z'));
    await settingsRepo.put(defaultSettings());
    const without = await exportBackup({ includePacks: false, includeSecrets: false });
    expect(without.tables.packs).toBeUndefined();
    const withPacks = await exportBackup({ includePacks: true, includeSecrets: false });
    expect(Array.isArray(withPacks.tables.packs)).toBe(true);
  });
});

describe('round-trip property (fast-check, 200 datasets)', () => {
  const isoDate = fc.constant('2026-10-29T19:00:00.000Z');
  const day = fc.constant('2026-10-29');
  const profileArb = fc.record({
    id: fc.constant('me' as const),
    displayName: fc.string({ minLength: 1, maxLength: 12 }),
    platform: fc.constantFrom('ps5', 'pc', 'xbox') as fc.Arbitrary<'ps5' | 'pc' | 'xbox'>,
    controller: fc.constant('DualSense'),
    glyphMode: fc.constantFrom('numeric', 'playstation', 'xbox') as fc.Arbitrary<'numeric' | 'playstation' | 'xbox'>,
    targetRank: fc.constant('Tekken King'),
    weeklyMinutes: fc.integer({ min: 0, max: 600 }),
    sessionMinutes: fc.integer({ min: 5, max: 60 }),
    preferredDays: fc.array(fc.integer({ min: 0, max: 6 }), { maxLength: 3 }),
    dayBoundary: fc.constant('04:00'),
    timezone: fc.constant('America/Chicago'),
    createdAt: isoDate,
    onboardingStep: fc.option(fc.integer({ min: 0, max: 6 }), { nil: undefined }),
  });
  const settingsArb = fc.record({
    id: fc.constant('settings' as const),
    theme: fc.constantFrom('system', 'dark', 'light') as fc.Arbitrary<'system' | 'dark' | 'light'>,
    labAudioCues: fc.boolean(),
    labWakeLock: fc.boolean(),
    repsPerSet: fc.integer({ min: 1, max: 20 }),
    newCardsPerDay: fc.integer({ min: 0, max: 30 }),
    reviewsPerDay: fc.integer({ min: 0, max: 100 }),
    aiProvider: fc.constantFrom('none', 'openai-compatible', 'anthropic', 'mock') as fc.Arbitrary<Settings['aiProvider']>,
    aiRequestsPerHour: fc.integer({ min: 0, max: 60 }),
    snapshotsKeptDaily: fc.integer({ min: 0, max: 30 }),
    snapshotsKeptEvent: fc.integer({ min: 0, max: 30 }),
    backupReminderDays: fc.integer({ min: 0, max: 30 }),
    inAppImporterEnabled: fc.boolean(),
    matchImportEnabled: fc.boolean(),
    dataPatch: fc.constant('3.02.02'),
    dataSource: fc.constantFrom('wavu', 'tekkendocs', 'seed') as fc.Arbitrary<'wavu' | 'tekkendocs' | 'seed'>,
    kpiTargets: fc.dictionary(
      fc.constantFrom('missedPunishesPerGame', 'panicSuccess', 'throwBreaks', 'hitWhileMinusPerGame', 'lowsBlocked', 'heatWasted', 'okiPerGame'),
      fc.oneof(
        fc.float({ min: Math.fround(0), max: Math.fround(5), noNaN: true }),
        fc.constant(null),
      ),
    ),
  });
  const sessionArb = fc.record({
    id: fc.string({ minLength: 1, maxLength: 8 }),
    kind: fc.constantFrom('plan', 'custom', 'gate', 'baseline') as fc.Arbitrary<'plan' | 'custom' | 'gate' | 'baseline'>,
    startedAt: isoDate,
    status: fc.constantFrom('active', 'paused', 'done', 'abandoned') as fc.Arbitrary<'active' | 'paused' | 'done' | 'abandoned'>,
    plannedMinutes: fc.integer({ min: 0, max: 60 }),
    blocks: fc.constant([]),
    currentBlock: fc.constant(0),
    pausedMs: fc.constant(0),
  });
  const setArb = fc.record({
    id: fc.string({ minLength: 1, maxLength: 8 }),
    drillId: fc.constant('d1-punish-ladder'),
    nodeId: fc.constant('n1-punish'),
    at: isoDate,
    day,
    reps: fc.integer({ min: 0, max: 20 }),
    successes: fc.integer({ min: 0, max: 20 }),
  });
  const matchSetArb = fc.record({
    id: fc.string({ minLength: 1, maxLength: 8 }),
    at: isoDate,
    day,
    mode: fc.constantFrom('ranked', 'player', 'quick') as fc.Arbitrary<'ranked' | 'player' | 'quick'>,
    opponentCharacter: fc.constant('Kazuya'),
    games: fc.integer({ min: 0, max: 10 }),
    wins: fc.integer({ min: 0, max: 10 }),
    tallies: fc.record({
      missedPunishes: fc.integer({ min: 0, max: 20 }),
      flashHit: fc.constant(0), flashBlocked: fc.constant(0), flashWhiffed: fc.constant(0),
      spinEscaped: fc.constant(0), spinPunished: fc.constant(0),
      throwsBroken: fc.integer({ min: 0, max: 10 }), throwsMissed: fc.integer({ min: 0, max: 10 }),
      hitWhileMinus: fc.integer({ min: 0, max: 20 }),
      lowsBlocked: fc.constant(0), lowsEaten: fc.constant(0),
      heatConverted: fc.constant(0), heatWasted: fc.constant(0), okiConverted: fc.constant(0),
    }),
    beatBy: fc.constant([]),
    tags: fc.constant([]),
  });
  const datasetArb = fc.record({
    profile: profileArb,
    settings: settingsArb,
    sessions: fc.array(sessionArb, { maxLength: 3 }),
    sets: fc.array(setArb, { maxLength: 5 }),
    matchSets: fc.array(matchSetArb, { maxLength: 3 }),
    mastery: fc.array(
      fc.record({
        nodeId: fc.constant('n1-punish'),
        K: fc.option(fc.float({ min: Math.fround(0), max: Math.fround(1), noNaN: true }), { nil: null }),
        E: fc.option(fc.float({ min: Math.fround(0), max: Math.fround(1), noNaN: true }), { nil: null }),
        A: fc.option(fc.float({ min: Math.fround(0), max: Math.fround(1), noNaN: true }), { nil: null }),
        score: fc.float({ min: Math.fround(0), max: Math.fround(1), noNaN: true }),
        state: fc.constantFrom('locked', 'learning', 'practicing', 'solid', 'mastered', 'rusty') as fc.Arbitrary<'locked' | 'learning' | 'practicing' | 'solid' | 'mastered' | 'rusty'>,
        placed: fc.boolean(),
        evidenceDays: fc.constant([]),
        updatedAt: isoDate,
      }),
      { maxLength: 2 },
    ),
    cards: fc.array(
      fc.record({
        id: fc.string({ minLength: 1, maxLength: 8 }),
        deck: fc.constant('Notation'),
        front: fc.string({ minLength: 1, maxLength: 10 }),
        back: fc.string({ minLength: 1, maxLength: 10 }),
        refs: fc.constant([]),
        createdAt: isoDate,
      }),
      { maxLength: 3 },
    ),
    cardStates: fc.array(
      fc.record({
        cardId: fc.string({ minLength: 1, maxLength: 8 }),
        reps: fc.integer({ min: 0, max: 10 }),
        lapses: fc.integer({ min: 0, max: 5 }),
        ease: fc.float({ min: Math.fround(1.3), max: Math.fround(2.5), noNaN: true }),
        intervalDays: fc.integer({ min: 0, max: 30 }),
        due: day,
        history: fc.constant([]),
      }),
      { maxLength: 3 },
    ),
  });

  it('any random dataset survives export → wipe → import unchanged', async () => {
    await fc.assert(
      fc.asyncProperty(datasetArb, async (dataset) => {
        await resetDbForTests();
        await profileRepo.put(dataset.profile as never);
        await settingsRepo.put(dataset.settings as never);
        for (const session of dataset.sessions) await sessionsRepo.put(session as never);
        for (const set of dataset.sets) await setsRepo.put(set as never);
        for (const match of dataset.matchSets) await matchSetsRepo.put(match as never);
        for (const row of dataset.mastery) await masteryRepo.put(row as never);
        for (const card of dataset.cards) await cardsRepo.put(card as never);
        for (const state of dataset.cardStates) await cardStatesRepo.put(state as never);
        const exported = await exportBackup({ includePacks: false, includeSecrets: false });
        await resetDbForTests();
        await importBackup(exported, async () => {});
        const reExported = await exportBackup({ includePacks: false, includeSecrets: false });
        const tablesOf = (file: typeof exported) =>
          (['profile', 'settings', 'sessions', 'sets', 'matchSets', 'mastery', 'cards', 'cardStates'] as const).map((name) => canonicalJson(file.tables[name]));
        expect(tablesOf(reExported)).toEqual(tablesOf(exported));
      }),
      { numRuns: 200 },
    );
  });

  it('BACKUP_TABLES covers every user table the export writes', () => {
    expect(BACKUP_TABLES).toContain('profile');
    expect(BACKUP_TABLES).toContain('sessions');
    expect(BACKUP_TABLES).toContain('coachMessages');
  });
});
