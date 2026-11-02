// 2.0 M1 — the diag function: one ZT1 line per accepted event, a Blobs copy
// under <day>/<ts>-<rand> until the day's cap, a store name per deploy
// context, and 400/405/413 for anything that is not a valid event. Blobs is
// the memory store (as in intel.spec.ts); the Netlify wrapper is exercised
// with @netlify/blobs mocked, to check the store name and the route config.
import { describe, expect, it, vi } from 'vitest';
import { DIAG_DAILY_CAP, createDiagHandler, diagStoreName, memoryDiagStore } from '../../../src/server/diag/handler';
import { DIAG_TEXT_MAX, diagEventSchema, type DiagEvent } from '../../../src/server/diag/schema';

const NOW = Date.parse('2026-11-01T18:30:00.000Z');
const URL_DIAG = 'https://zanshin.test/api/diag';

function event(overrides: Partial<DiagEvent> = {}): DiagEvent {
  return {
    at: '2026-11-01T18:29:59.000Z',
    fingerprint: '0123456789abcdef',
    kind: 'error',
    message: '[window.error] TypeError: x is undefined',
    online: true,
    release: '2.0.0-beta.1',
    route: '/today',
    schema: 5,
    sessionId: '3f2a9c1e-1b2c-4d5e-8f90-123456789abc',
    stack: 'TypeError: x is undefined\n    at a (https://zanshin.test/assets/index-abc.js:1:200)',
    uaClass: 'phone-chrome',
    ...overrides,
  };
}

function post(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(URL_DIAG, {
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: { 'Content-Type': 'application/json', ...headers },
    method: 'POST',
  });
}

function setup(overrides: Partial<Parameters<typeof createDiagHandler>[0]> = {}) {
  const lines: string[] = [];
  const store = memoryDiagStore();
  let n = 0;
  const handler = createDiagHandler({
    log: (line) => { lines.push(line); },
    nowMs: () => NOW,
    randomId: () => `r${(n += 1)}`,
    store,
    ...overrides,
  });
  return { handler, lines, store };
}

describe('diag event schema', () => {
  it('accepts a full event and caps text at 2 KB', () => {
    expect(diagEventSchema.safeParse(event({ checks: { idbOpenMs: 42, intel: 'ok' }, deviceLabel: 'phone', kind: 'boot-selftest' })).success).toBe(true);
    expect(diagEventSchema.safeParse(event({ message: 'x'.repeat(DIAG_TEXT_MAX) })).success).toBe(true);
    expect(diagEventSchema.safeParse(event({ message: 'x'.repeat(DIAG_TEXT_MAX + 1) })).success).toBe(false);
    expect(diagEventSchema.safeParse(event({ stack: 'x'.repeat(DIAG_TEXT_MAX + 1) })).success).toBe(false);
  });

  it('refuses routes with a query string, raw user agents and odd ids', () => {
    expect(diagEventSchema.safeParse(event({ route: '/today?note=secret' })).success).toBe(false);
    expect(diagEventSchema.safeParse(event({ route: 'today' })).success).toBe(false);
    expect(diagEventSchema.safeParse(event({ uaClass: 'Mozilla/5.0 (Linux; Android 14)' })).success).toBe(false);
    expect(diagEventSchema.safeParse(event({ sessionId: 'short' })).success).toBe(false);
    expect(diagEventSchema.safeParse(event({ fingerprint: 'NOT-HEX' })).success).toBe(false);
    expect(diagEventSchema.safeParse({ ...event(), kind: 'notes' }).success).toBe(false);
  });
});

describe('diag handler', () => {
  it('logs one ZT1 line and stores the event under the server day', async () => {
    const { handler, lines, store } = setup();
    const response = await handler(post(event()));
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ ok: true, stored: true });
    expect(lines).toHaveLength(1);
    expect(lines[0]?.startsWith('ZT1 {')).toBe(true);
    expect(JSON.parse(lines[0]?.slice(4) ?? '')).toEqual(event());
    expect([...store.data.keys()]).toEqual([`2026-11-01/${NOW}-r1`]);
    expect(store.data.get(`2026-11-01/${NOW}-r1`)).toEqual(event());
  });

  it('drops fields outside the schema before logging or storing them', async () => {
    const { handler, lines, store } = setup();
    await handler(post({ ...event(), apiKey: 'sk-secret-12345678', ip: '203.0.113.9', notes: 'my private note' }));
    expect(lines[0]).not.toMatch(/sk-secret|203\.0\.113|private note/);
    expect(JSON.stringify([...store.data.values()])).not.toMatch(/sk-secret|203\.0\.113|private note/);
  });

  it('answers 405 to anything but POST, 400 to bad JSON or a bad event, 413 to a huge body', async () => {
    const { handler, lines, store } = setup();
    const get = await handler(new Request(URL_DIAG));
    expect(get.status).toBe(405);
    expect(get.headers.get('Allow')).toBe('POST');
    expect((await handler(post('{nope'))).status).toBe(400);
    const bad = await handler(post({ ...event(), kind: '<script>alert(1)</script>' }));
    expect(bad.status).toBe(400);
    const body = (await bad.json()) as { error: string };
    expect(body.error).toBe('Invalid diag event: kind.');
    expect((await handler(post({ ...event(), message: 'x'.repeat(DIAG_TEXT_MAX + 1) }))).status).toBe(400);
    expect((await handler(post('x'.repeat(9000)))).status).toBe(413);
    expect((await handler(post(event(), { 'content-length': '100000' }))).status).toBe(413);
    expect(lines).toEqual([]);
    expect(store.data.size).toBe(0);
  });

  it('stops storing at the daily cap but keeps logging, and starts again the next day', async () => {
    let now = NOW;
    const { handler, lines, store } = setup({ dailyCap: 2, nowMs: () => now });
    const results = [];
    for (let i = 0; i < 3; i += 1) results.push(await (await handler(post(event()))).json());
    expect(results).toEqual([{ ok: true, stored: true }, { ok: true, stored: true }, { ok: true, stored: false }]);
    expect(lines).toHaveLength(3);
    now = NOW + 86_400_000;
    expect(await (await handler(post(event()))).json()).toEqual({ ok: true, stored: true });
    expect([...store.data.keys()].filter((key) => key.startsWith('2026-11-02/'))).toHaveLength(1);
    expect(DIAG_DAILY_CAP).toBe(500);
  });

  it('still logs when Blobs is missing or failing', async () => {
    const missing = setup({ store: null });
    expect(await (await missing.handler(post(event()))).json()).toEqual({ ok: true, stored: false });
    expect(missing.lines).toHaveLength(1);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const failing = setup({ store: { list: async () => { throw new Error('blobs down'); }, setIfNew: async () => true } });
    expect(await (await failing.handler(post(event()))).json()).toEqual({ ok: true, stored: false });
    expect(failing.lines).toHaveLength(1);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('blobs down'));
    warn.mockRestore();
  });
});

describe('diag store name', () => {
  it('keeps production in `diag` and every other context apart', () => {
    expect(diagStoreName('production')).toBe('diag');
    expect(diagStoreName('deploy-preview')).toBe('diag-deploy-preview');
    expect(diagStoreName('branch-deploy')).toBe('diag-branch-deploy');
    expect(diagStoreName('dev')).toBe('diag-dev');
    expect(diagStoreName(undefined)).toBe('diag-unknown');
    expect(diagStoreName('a/b:c')).toBe('diag-a-b-c');
  });
});

describe('netlify/functions/diag.mts', () => {
  it('routes /api/diag with a rate limit and writes to the context store', async () => {
    const stores: string[] = [];
    const written: Array<{ key: string; onlyIfNew: unknown }> = [];
    vi.resetModules();
    vi.doMock('@netlify/blobs', () => ({
      getStore: (options: { name: string }) => {
        stores.push(options.name);
        return {
          list: async () => ({ blobs: [], directories: [] }),
          setJSON: async (key: string, _value: unknown, opts: { onlyIfNew?: boolean }) => {
            written.push({ key, onlyIfNew: opts.onlyIfNew });
            return { modified: true };
          },
        };
      },
    }));
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const fn = await import('../../../netlify/functions/diag.mjs');
    expect(fn.config.path).toBe('/api/diag');
    expect(fn.config.rateLimit).toMatchObject({ windowLimit: 60, windowSize: 60 });
    const response = await fn.default(post(event()), { deploy: { context: 'deploy-preview' } } as never);
    expect(response.status).toBe(202);
    expect(stores).toEqual(['diag-deploy-preview']);
    expect(written[0]?.onlyIfNew).toBe(true);
    expect(written[0]?.key).toMatch(/^\d{4}-\d{2}-\d{2}\/\d+-[0-9a-f]{8}$/);
    expect(error).toHaveBeenCalledWith(expect.stringMatching(/^ZT1 \{/));
    await fn.default(post(event()), { deploy: { context: 'production' } } as never);
    expect(stores).toEqual(['diag-deploy-preview', 'diag']);
    error.mockRestore();
    vi.doUnmock('@netlify/blobs');
  });
});
