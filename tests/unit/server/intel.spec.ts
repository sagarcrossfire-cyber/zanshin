// Release 1.3.0 — the intel function: routing, validation, the daily cap,
// Perplexity response parsing, caching of primers and patch briefs, and the
// shape every client call relies on. Perplexity is a mocked fetch.
// 2.0 M1 — the per-call spend ledger (no lost increments under parallel
// calls, the old single key still counted), the 45 s provider timeout, and
// one ZT1 breadcrumb per request that never carries prompt or answer text.
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  INTEL_PROVIDER_TIMEOUT_MS, capStateOf, createIntelHandler as createHandler, transcript, PRIMER_TTL_MS, type IntelDeps,
} from '../../../src/server/intel/handler';
import { AGENT_TIMEOUT_MS, callAgent, parseAgentResponse, AGENT_API_URL } from '../../../src/server/intel/perplexity';
import {
  addUsage, ledgerKey, memoryStore, parseLedgerKey, readUsage, recentUsage, type IntelStore,
} from '../../../src/server/intel/store';

/** Handlers in this file stay quiet unless a test collects the breadcrumbs. */
const createIntelHandler = (deps: IntelDeps) => createHandler({ log: () => undefined, ...deps });

afterEach(() => {
  vi.useRealTimers();
});

const NOW = '2026-10-31T18:00:00.000Z';
const BASE = 'https://zanshin.test/.netlify/functions/intel';

function agentReply(text: string, extra: { results?: Array<{ id: string; title: string; url: string; date?: string | null }>; cost?: number } = {}) {
  return {
    model: 'perplexity/sonar',
    output: [
      ...(extra.results ? [{ results: extra.results, type: 'search_results' }] : []),
      { content: [{ text, type: 'output_text' }], type: 'message' },
    ],
    status: 'completed',
    usage: { cost: { currency: 'USD', total_cost: extra.cost ?? 0.0123 }, input_tokens: 800, output_tokens: 200, total_tokens: 1000 },
  };
}

function mockFetch(responder: (body: Record<string, unknown>, init: RequestInit) => Response | Promise<Response>) {
  const calls: Array<Record<string, unknown>> = [];
  const fetchFn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    expect(String(input)).toBe(AGENT_API_URL);
    expect((init?.headers as Record<string, string>)['Authorization']).toBe('Bearer test-key');
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    calls.push(body);
    return responder(body, init ?? {});
  }) as unknown as typeof fetch;
  return { calls, fetchFn };
}

function okJson(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' }, status });
}

function post(path: string, body: unknown): Request {
  return new Request(`${BASE}/${path}`, { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' }, method: 'POST' });
}

describe('parseAgentResponse', () => {
  it('reads text, search results and cost from the Agent API shape', () => {
    const parsed = parseAgentResponse(agentReply('Hello [1]', { cost: 0.5, results: [{ date: '2026-01-02', id: '1', title: 'T', url: 'https://wavu.wiki/x' }] }));
    expect(parsed).toEqual({
      model: 'perplexity/sonar',
      results: [{ date: '2026-01-02', id: '1', last_updated: null, snippet: undefined, title: 'T', url: 'https://wavu.wiki/x' }],
      text: 'Hello [1]',
      usage: { costUsd: 0.5, inputTokens: 800, outputTokens: 200, totalTokens: 1000 },
    });
  });

  it('tolerates missing pieces', () => {
    expect(parseAgentResponse({ output_text: 'plain' }).text).toBe('plain');
    expect(parseAgentResponse(null).usage.costUsd).toBe(0);
  });
});

describe('transcript', () => {
  it('passes one message through and flattens a conversation', () => {
    expect(transcript([{ content: 'Q', role: 'user' }])).toBe('Q');
    expect(transcript([{ content: 'Q1', role: 'user' }, { content: 'A1', role: 'assistant' }, { content: 'Q2', role: 'user' }]))
      .toBe('Sagar: Q1\n\nCoach: A1\n\nSagar: Q2\n\nCoach:');
  });
});

describe('intel handler', () => {
  it('health and usage work without a key and say the key is missing', async () => {
    const store = memoryStore();
    const handler = createIntelHandler({ apiKey: undefined, capUsd: 3, nowIso: () => NOW, store });
    const health = await (await handler(new Request(`${BASE}/health`))).json() as { ok: boolean; keyConfigured: boolean; capUsd: number };
    expect(health).toMatchObject({ capUsd: 3, keyConfigured: false, ok: true });
    const usage = await (await handler(new Request(`${BASE}/usage`))).json() as { days: unknown[] };
    expect(usage.days).toHaveLength(7);
    const coach = await handler(post('coach', { messages: [{ content: 'hi', role: 'user' }], system: 'sys' }));
    expect(coach.status).toBe(503);
    expect(((await coach.json()) as { error: string }).error).toMatch(/PERPLEXITY_API_KEY/);
  });

  it('coach: sends instructions + transcript, returns text and records the spend', async () => {
    const { calls, fetchFn } = mockFetch(() => okJson(agentReply('Do the drill.\n\nNext action: Lab.', { cost: 0.02 })));
    const store = memoryStore();
    const handler = createIntelHandler({ apiKey: 'test-key', capUsd: 3, fetchFn, nowIso: () => NOW, store });
    const response = await handler(post('coach', {
      messages: [{ content: 'What next?', role: 'user' }],
      model: 'anthropic/claude-sonnet-5-5',
      system: 'You are the coach.',
    }));
    expect(response.status).toBe(200);
    const body = await response.json() as { text: string; model: string; usage: { costUsd: number; todayUsd: number; capUsd: number } };
    expect(body.text).toBe('Do the drill.\n\nNext action: Lab.');
    expect(body.model).toBe('anthropic/claude-sonnet-5-5');
    expect(body.usage).toMatchObject({ capUsd: 3, costUsd: 0.02, todayUsd: 0.02 });
    expect(calls[0]).toMatchObject({ input: 'What next?', instructions: 'You are the coach.', max_output_tokens: 600, model: 'anthropic/claude-sonnet-5-5' });
    expect(calls[0]).not.toHaveProperty('tools');
    const days = await recentUsage(store, NOW, 1);
    expect(days[0]).toMatchObject({ costUsd: 0.02, inputTokens: 800, outputTokens: 200, requests: 1 });
  });

  it('refuses unknown models and bad bodies before spending anything', async () => {
    const { calls, fetchFn } = mockFetch(() => okJson(agentReply('x')));
    const handler = createIntelHandler({ apiKey: 'test-key', capUsd: 3, fetchFn, nowIso: () => NOW, store: memoryStore() });
    expect((await handler(post('coach', { messages: [{ content: 'hi', role: 'user' }], model: 'openai/gpt-99', system: 'sys' }))).status).toBe(400);
    expect((await handler(post('coach', { messages: [], system: 'sys' }))).status).toBe(400);
    expect((await handler(new Request(`${BASE}/coach`, { body: '{nope', method: 'POST' }))).status).toBe(400);
    expect((await handler(new Request(`${BASE}/nothing`))).status).toBe(404);
    expect(calls).toHaveLength(0);
  });

  it('stops at the daily cap and keeps answering health', async () => {
    const { calls, fetchFn } = mockFetch(() => okJson(agentReply('x', { cost: 2 })));
    const store = memoryStore();
    const handler = createIntelHandler({ apiKey: 'test-key', capUsd: 3, fetchFn, nowIso: () => NOW, store });
    expect((await handler(post('coach', { messages: [{ content: 'a', role: 'user' }], system: 's' }))).status).toBe(200);
    expect((await handler(post('coach', { messages: [{ content: 'b', role: 'user' }], system: 's' }))).status).toBe(200);
    const third = await handler(post('coach', { messages: [{ content: 'c', role: 'user' }], system: 's' }));
    expect(third.status).toBe(429);
    expect(await third.json()).toMatchObject({ capUsd: 3, todayUsd: 4 });
    expect(calls).toHaveLength(2);
    const health = await (await handler(new Request(`${BASE}/health`))).json() as { today: { costUsd: number } };
    expect(health.today.costUsd).toBe(4);
  });

  it('research: searches trusted sites only and returns citations', async () => {
    const { calls, fetchFn } = mockFetch(() => okJson(agentReply('Duck the second hit [1].', {
      results: [{ date: '2026-09-01', id: '1', title: 'Yoshimitsu guide', url: 'https://wavu.wiki/t/Yoshimitsu' }],
    })));
    const handler = createIntelHandler({ apiKey: 'test-key', capUsd: 3, fetchFn, nowIso: () => NOW, store: memoryStore() });
    const response = await handler(post('research', { context: 'Record vs Jin: 2-8.', question: 'How do I deal with Jin f,f+2?', recency: 'year' }));
    expect(response.status).toBe(200);
    const body = await response.json() as { text: string; citations: Array<{ id: string; url: string }>; model: string };
    expect(body.text).toBe('Duck the second hit [1].');
    expect(body.citations).toEqual([{ date: '2026-09-01', id: '1', title: 'Yoshimitsu guide', url: 'https://wavu.wiki/t/Yoshimitsu' }]);
    expect(body.model).toBe('perplexity/sonar');
    const sent = calls[0] as { tools: Array<{ type: string; search_type: string; filters: { search_domain_filter: string[]; search_recency_filter: string } }>; input: string };
    expect(sent.tools[0]).toMatchObject({ search_type: 'fast', type: 'web_search' });
    expect(sent.tools[0]?.filters.search_domain_filter).toContain('wavu.wiki');
    expect(sent.tools[0]?.filters.search_recency_filter).toBe('year');
    expect(sent.input).toContain('Record vs Jin');
  });

  it('primer: generated once, cached for 30 days, refreshable, stale copy kept on failure', async () => {
    let fail = false;
    const { calls, fetchFn } = mockFetch(() => (fail ? okJson({ error: { message: 'down' } }, 503) : okJson(agentReply('**Their plan**\n- Pressure [1]', {
      results: [{ id: '1', title: 'Kazuya', url: 'https://tekkendocs.com/t8/kazuya' }],
    }))));
    const store = memoryStore();
    let now = NOW;
    const handler = createIntelHandler({ apiKey: 'test-key', capUsd: 3, fetchFn, nowIso: () => now, store });
    const first = await (await handler(new Request(`${BASE}/primer/Kazuya`))).json() as { cached: boolean; character: string; generatedAt: string; citations: unknown[] };
    expect(first).toMatchObject({ cached: false, character: 'Kazuya', generatedAt: NOW });
    expect(first.citations).toHaveLength(1);
    const second = await (await handler(new Request(`${BASE}/primer/kazuya`))).json() as { cached: boolean };
    expect(second.cached).toBe(true);
    expect(calls).toHaveLength(1);
    now = new Date(Date.parse(NOW) + PRIMER_TTL_MS + 1000).toISOString();
    fail = true;
    const stale = await handler(new Request(`${BASE}/primer/Kazuya`));
    expect(stale.status).toBe(200);
    expect(await stale.json()).toMatchObject({ cached: true, stale: true });
    fail = false;
    const refreshed = await (await handler(new Request(`${BASE}/primer/Kazuya?refresh=1`))).json() as { cached: boolean; generatedAt: string };
    expect(refreshed.cached).toBe(false);
    expect(refreshed.generatedAt).toBe(now);
    expect((await handler(new Request(`${BASE}/primer/%3Cscript%3E`))).status).toBe(400);
  });

  it('patch brief: lists the changes for the model and caches by revision', async () => {
    const { calls, fetchFn } = mockFetch(() => okJson(agentReply('- 1+4: reported +2 more recovery [1]\nRe-verify 1+4.', {
      results: [{ id: '1', title: 'Patch notes', url: 'https://tekken.com/news/patch' }],
    })));
    const store = memoryStore();
    const handler = createIntelHandler({ apiKey: 'test-key', capUsd: 3, fetchFn, nowIso: () => NOW, store });
    const body = { changes: [{ after: '-21', before: '-20', field: 'block', input: '1+4', moveId: 'Yoshimitsu-1+4', name: 'Soul Stealer' }], patch: '3.03', revision: '99999' };
    const first = await (await handler(post('patch-brief', body))).json() as { cached: boolean; revision: string; text: string };
    expect(first).toMatchObject({ cached: false, revision: '99999' });
    expect((calls[0] as { input: string }).input).toContain('1+4 (Soul Stealer): block -20 → -21');
    const again = await (await handler(post('patch-brief', body))).json() as { cached: boolean };
    expect(again.cached).toBe(true);
    expect(calls).toHaveLength(1);
  });

  it('reports a rejected key and a timeout in plain words', async () => {
    const bad = createIntelHandler({ apiKey: 'test-key', capUsd: 3, fetchFn: mockFetch(() => okJson({ error: 'unauthorized' }, 401)).fetchFn, nowIso: () => NOW, store: memoryStore() });
    const rejected = await bad.call(null, post('coach', { messages: [{ content: 'a', role: 'user' }], system: 's' }));
    expect(rejected.status).toBe(502);
    expect(((await rejected.json()) as { error: string }).error).toMatch(/rejected the server key/);

    const slow = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    })) as unknown as typeof fetch;
    const timing = createIntelHandler({ apiKey: 'test-key', capUsd: 3, fetchFn: slow, nowIso: () => NOW, store: memoryStore(), timeoutMs: 20 });
    const late = await timing(post('coach', { messages: [{ content: 'a', role: 'user' }], system: 's' }));
    expect(late.status).toBe(504);
    expect(((await late.json()) as { error: string }).error).toMatch(/too long/);
  });
});

/** A memory store whose reads answer a macrotask later with what was there
 * when they were sent, the way Blobs reads travel the network: parallel
 * callers all read before any of them writes. The 1.3 ledger kept 1 of 5
 * calls against this store (docs/ops/RCA_LOG.md 2026-11-01). */
function slowStore(): IntelStore & { data: Map<string, unknown> } {
  const inner = memoryStore();
  const later = <T>(read: () => Promise<T>) => {
    const value = read();
    return new Promise<T>((resolve) => setTimeout(() => resolve(value), 0));
  };
  return {
    data: inner.data,
    get: (key) => later(() => inner.get(key)),
    list: (prefix) => later(() => inner.list(prefix)),
    set: (key, value) => inner.set(key, value),
    setIfNew: (key, value) => inner.setIfNew(key, value),
  };
}

describe('spend ledger (2.0 M1)', () => {
  it('ledger keys carry the call\'s numbers and parse back', () => {
    const key = ledgerKey('2026-11-01', 'abc/1~x', { costUsd: 0.0123, inputTokens: 800, outputTokens: 200 });
    expect(key).toBe('usage/2026-11-01/abc-1-x~c12300~i800~o200');
    expect(parseLedgerKey(key)).toEqual({ costUsd: 0.0123, inputTokens: 800, outputTokens: 200 });
    expect(parseLedgerKey('usage/2026-11-01/garbage')).toBeNull();
  });

  it('parallel paid calls are all counted (the 1.3 read-modify-write lost them)', async () => {
    const { calls, fetchFn } = mockFetch(() => okJson(agentReply('x', { cost: 0.01 })));
    const store = slowStore();
    let n = 0;
    const handler = createIntelHandler({ apiKey: 'test-key', capUsd: 3, fetchFn, nowIso: () => NOW, requestId: () => `r${(n += 1)}`, store });
    const responses = await Promise.all([1, 2, 3, 4, 5].map((i) => handler(post('coach', { messages: [{ content: `q${i}`, role: 'user' }], system: 's' }))));
    expect(responses.map((r) => r.status)).toEqual([200, 200, 200, 200, 200]);
    expect(calls).toHaveLength(5);
    const today = await readUsage(store, '2026-10-31');
    expect(today).toEqual({ costUsd: 0.05, day: '2026-10-31', inputTokens: 4000, outputTokens: 1000, requests: 5 });
    expect([...store.data.keys()].filter((key) => key.startsWith('usage/2026-10-31/'))).toHaveLength(5);
    expect(store.data.has('usage/2026-10-31')).toBe(false);
  });

  it('still counts the old single usage/<day> key, so the cap holds on rollout day', async () => {
    const store = memoryStore({ 'usage/2026-10-31': { costUsd: 2.5, day: '2026-10-31', inputTokens: 100, outputTokens: 50, requests: 3 } });
    const { calls, fetchFn } = mockFetch(() => okJson(agentReply('x', { cost: 0.6 })));
    const handler = createIntelHandler({ apiKey: 'test-key', capUsd: 3, fetchFn, nowIso: () => NOW, store });
    const first = await handler(post('coach', { messages: [{ content: 'a', role: 'user' }], system: 's' }));
    expect(first.status).toBe(200);
    expect(((await first.json()) as { usage: { todayUsd: number } }).usage.todayUsd).toBe(3.1);
    expect((await handler(post('coach', { messages: [{ content: 'b', role: 'user' }], system: 's' }))).status).toBe(429);
    expect(calls).toHaveLength(1);
    const health = await (await handler(new Request(`${BASE}/health`))).json() as { today: { requests: number; costUsd: number } };
    expect(health.today).toMatchObject({ costUsd: 3.1, requests: 4 });
  });

  it('a reused request id still records every call', async () => {
    const store = memoryStore();
    await addUsage(store, '2026-11-01', 'same', { costUsd: 0.1, inputTokens: 1, outputTokens: 1 }, NOW);
    const total = await addUsage(store, '2026-11-01', 'same', { costUsd: 0.1, inputTokens: 1, outputTokens: 1 }, NOW);
    expect(total).toMatchObject({ costUsd: 0.2, requests: 2 });
  });

  it('the usage report sums each of the last seven days', async () => {
    const store = memoryStore({ 'usage/2026-10-30': { costUsd: 1, inputTokens: 10, outputTokens: 5, requests: 2 } });
    await addUsage(store, '2026-10-30', 'a', { costUsd: 0.25, inputTokens: 1, outputTokens: 1 }, NOW);
    await addUsage(store, '2026-10-31', 'b', { costUsd: 0.5, inputTokens: 1, outputTokens: 1 }, NOW);
    const days = await recentUsage(store, NOW, 7);
    expect(days.map((d) => d.day)).toEqual(['2026-10-31', '2026-10-30', '2026-10-29', '2026-10-28', '2026-10-27', '2026-10-26', '2026-10-25']);
    expect(days[0]).toMatchObject({ costUsd: 0.5, requests: 1 });
    expect(days[1]).toMatchObject({ costUsd: 1.25, requests: 3 });
    expect(days[2]).toMatchObject({ costUsd: 0, requests: 0 });
  });
});

describe('provider timeout (2.0 M1)', () => {
  it('defaults to 45 s, inside Netlify\'s 60 s synchronous limit', async () => {
    expect(INTEL_PROVIDER_TIMEOUT_MS).toBe(45_000);
    expect(AGENT_TIMEOUT_MS).toBe(45_000);
    vi.useFakeTimers();
    const slow = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    })) as unknown as typeof fetch;
    let settled: unknown = 'pending';
    const call = callAgent('test-key', { input: 'q', instructions: 'i', max_output_tokens: 10, model: 'perplexity/sonar' }, { fetchFn: slow })
      .catch((error: unknown) => error);
    void call.then((value) => { settled = value; });
    await vi.advanceTimersByTimeAsync(44_000);
    expect(settled).toBe('pending');
    await vi.advanceTimersByTimeAsync(1_000);
    expect(settled).toMatchObject({ name: 'PerplexityError', status: 504 });
  });
});

describe('ZT1 breadcrumbs (2.0 M1)', () => {
  function collect() {
    const lines: string[] = [];
    return { lines, log: (line: string) => { lines.push(line); }, events: () => lines.map((line) => JSON.parse(line.slice(4)) as Record<string, unknown>) };
  }

  it('capStateOf: ok, near from 80 %, reached, off without a cap', () => {
    expect(capStateOf(0, 3)).toBe('ok');
    expect(capStateOf(2.4, 3)).toBe('near');
    expect(capStateOf(3, 3)).toBe('reached');
    expect(capStateOf(5, 0)).toBe('off');
  });

  it('one line per request with route, status, latency, model, cost, cache hit and cap state', async () => {
    const sink = collect();
    const { fetchFn } = mockFetch(() => okJson(agentReply('PRIVATE ANSWER TEXT', { cost: 0.02 })));
    let clock = 1000;
    const handler = createHandler({
      apiKey: 'test-key', capUsd: 3, clockMs: () => (clock += 250), fetchFn, log: sink.log, nowIso: () => NOW, requestId: () => 'req-1', store: memoryStore(),
    });
    await handler(post('coach', { messages: [{ content: 'MY PRIVATE QUESTION', role: 'user' }], model: 'anthropic/claude-sonnet-5-5', system: 'SECRET SYSTEM PROMPT' }));
    expect(sink.lines).toHaveLength(1);
    expect(sink.lines[0]?.startsWith('ZT1 {')).toBe(true);
    expect(sink.events()[0]).toEqual({
      cacheHit: false, capState: 'ok', costUsd: 0.02, latencyMs: 250, method: 'POST', model: 'anthropic/claude-sonnet-5-5',
      requestId: 'req-1', route: 'coach', src: 'intel', status: 200,
    });
    for (const secret of ['PRIVATE ANSWER', 'PRIVATE QUESTION', 'SECRET SYSTEM', 'test-key']) expect(sink.lines[0]).not.toContain(secret);
  });

  it('names cache hits, the reached cap, unknown routes and thrown errors', async () => {
    const sink = collect();
    const { fetchFn } = mockFetch(() => okJson(agentReply('primer', { cost: 3 })));
    const store = memoryStore();
    const handler = createHandler({ apiKey: 'test-key', capUsd: 3, fetchFn, log: sink.log, nowIso: () => NOW, store });
    await handler(new Request(`${BASE}/primer/Kazuya`));
    await handler(new Request(`${BASE}/primer/Kazuya`));
    await handler(post('coach', { messages: [{ content: 'a', role: 'user' }], system: 's' }));
    await handler(new Request(`${BASE}/%3Cscript%3E`));
    const [paid, cached, capped, unknown] = sink.events();
    expect(paid).toMatchObject({ cacheHit: false, capState: 'reached', costUsd: 3, route: 'primer', status: 200 });
    expect(cached).toMatchObject({ cacheHit: true, model: 'perplexity/sonar', route: 'primer', status: 200 });
    expect(capped).toMatchObject({ capState: 'reached', route: 'coach', status: 429 });
    expect(unknown).toMatchObject({ route: 'unknown', status: 404 });

    const broken = createHandler({
      apiKey: 'test-key', capUsd: 3, fetchFn, log: sink.log, nowIso: () => NOW,
      store: { ...memoryStore(), get: async () => { throw new Error('blobs down'); } },
    });
    await expect(broken(new Request(`${BASE}/health`))).rejects.toThrow('blobs down');
    expect(sink.events()[4]).toMatchObject({ route: 'health', status: 500 });
  });
});
