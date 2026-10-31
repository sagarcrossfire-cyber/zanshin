// P9 — AC-COACH-3: the API key never appears in logs, error reports,
// coach messages, the context bundle, or thrown errors.
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { defaultProfile, defaultSettings } from '../../src/data/bootstrap';
import {
  coachMessagesRepo,
  errorsRepo,
  profileRepo,
  resetDbForTests,
  settingsRepo,
} from '../../src/data/repos';
import { askCoach, buildCoachContext, testConnection } from '../../src/services/coach';

const SENTINEL = 'sk-TEST-SENTINEL-7f3a9c';
const NOW = '2026-10-29T21:00:00.000Z';

function memoryStorage(): Pick<Storage, 'getItem' | 'setItem'> {
  const store = new Map<string, string>();
  return {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => {
      store.set(k, v);
    },
  };
}

beforeEach(async () => {
  await resetDbForTests();
});

afterEach(async () => {
  await resetDbForTests();
});

async function seedWithKey() {
  const profile = await profileRepo.put(defaultProfile(NOW));
  const settings = await settingsRepo.put({
    ...defaultSettings(),
    aiProvider: 'openai-compatible',
    aiApiKey: SENTINEL,
    aiBaseUrl: 'https://example.invalid/v1',
    aiModel: 'test-model',
  });
  return { profile, settings };
}

describe('AC-COACH-3 secrets', () => {
  it('a failing provider request leaks the key nowhere', async () => {
    const { profile, settings } = await seedWithKey();
    const failingFetch = async (): Promise<Response> => {
      throw new Error('Failed to fetch');
    };
    let thrown: unknown;
    try {
      await askCoach('help?', {
        profile, settings, nowIso: NOW,
        fetchImpl: failingFetch as unknown as typeof fetch,
        storage: memoryStorage(),
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeUndefined();
    const errors = await errorsRepo.all();
    const messages = await coachMessagesRepo.all();
    const context = await buildCoachContext('help?', { profile, settings, nowIso: NOW });
    for (const record of [...errors.map((e) => e.message), ...messages.map((m) => m.content), context]) {
      expect(record).not.toContain(SENTINEL);
    }
  });

  it('a 500 response leaks the key nowhere, including the thrown error text', async () => {
    const { profile, settings } = await seedWithKey();
    const errorFetch = async (): Promise<Response> => new Response('boom', { status: 500 });
    const result = await askCoach('help?', {
      profile, settings, nowIso: NOW,
      fetchImpl: errorFetch as unknown as typeof fetch,
      storage: memoryStorage(),
    });
    expect(result.source).toBe('fallback');
    expect(result.fallbackNotice).toContain('HTTP 500');
    expect(result.fallbackNotice).not.toContain(SENTINEL);
    const errors = await errorsRepo.all();
    for (const error of errors) expect(error.message).not.toContain(SENTINEL);
  });

  it('testConnection failure messages never contain the key', async () => {
    const { profile, settings } = await seedWithKey();
    const failingFetch = async (): Promise<Response> => {
      throw new Error('Failed to fetch');
    };
    const result = await testConnection({
      profile, settings, fetchImpl: failingFetch as unknown as typeof fetch,
    });
    expect(result.ok).toBe(false);
    expect(result.message).not.toContain(SENTINEL);
    expect(result.message).toContain('browser requests');
  });

  it('the key travels only in the request headers, never in a stored record', async () => {
    const { profile, settings } = await seedWithKey();
    const seenHeaders: Record<string, string>[] = [];
    const captureFetch = async (_url: string, init: RequestInit): Promise<Response> => {
      seenHeaders.push({ ...(init.headers as Record<string, string>) });
      return new Response(JSON.stringify({ choices: [{ message: { content: 'Fine.\nNext action: Drill.' } }] }), { status: 200 });
    };
    await askCoach('help?', {
      profile, settings, nowIso: NOW,
      fetchImpl: captureFetch as unknown as typeof fetch,
      storage: memoryStorage(),
    });
    expect(seenHeaders).toHaveLength(1);
    expect(seenHeaders[0]?.Authorization).toBe(`Bearer ${SENTINEL}`);
    // Nothing stored anywhere contains the key.
    const messages = await coachMessagesRepo.all();
    const errors = await errorsRepo.all();
    for (const record of [...messages.map((m) => m.content), ...errors.map((e) => e.message)]) {
      expect(record).not.toContain(SENTINEL);
    }
  });
});

describe('AC-COACH-3 secrets, export side (P10)', () => {
  it('a secrets-excluded backup export never contains the key', async () => {
    await seedWithKey();
    const { exportBackup, canonicalJson } = await import('../../src/services/backup');
    const excluded = await exportBackup({ includePacks: false, includeSecrets: false });
    expect(canonicalJson(excluded)).not.toContain(SENTINEL);
    expect(JSON.stringify(excluded)).not.toContain(SENTINEL);
    // The scan is meaningful: a secrets-included export does contain it.
    const included = await exportBackup({ includePacks: false, includeSecrets: true });
    expect(canonicalJson(included)).toContain(SENTINEL);
  });
});
