// Spec §8.7 — providers: mock determinism, request shapes, retry rules, and
// the secrets rule (an API key never appears in output or errors).
import { AnthropicProvider } from '../../../src/domain/coach/providers/anthropic';
import { CoachUnavailable } from '../../../src/domain/coach/providers/index';
import { MockProvider } from '../../../src/domain/coach/providers/mock';
import { OpenAICompatibleProvider } from '../../../src/domain/coach/providers/openai';
import type { CoachRequest } from '../../../src/domain/coach/providers/index';

const SECRET = 'sk-test-secret-key-12345';

function request(content: string): CoachRequest {
  return {
    system: 'You are the coach.',
    messages: [{ role: 'user', content }],
    maxTokens: 600,
    signal: new AbortController().signal,
  };
}

type FetchStub = (url: string, init?: RequestInit) => Promise<Response>;

function stubFetch(
  impl: (url: string, init: RequestInit | undefined, calls: { url: string; init?: RequestInit }[]) => Response | Promise<Response>,
): { fetchFn: FetchStub; calls: { url: string; init?: RequestInit }[] } {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchFn: FetchStub = async (url, init) => {
    calls.push({ url, init });
    return impl(url, init, calls);
  };
  return { fetchFn, calls };
}

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

describe('MockProvider', () => {
  it('is deterministic per question and ends with one Next action line', async () => {
    const provider = new MockProvider();
    const a = await provider.send(request('How do I punish -13?'));
    const b = await provider.send(request('How do I punish -13?'));
    expect(a.text).toBe(b.text);
    expect(a.text.split('\n').filter((l) => l.startsWith('Next action:'))).toHaveLength(1);
    const other = await provider.send(request('Tell me about Heat.'));
    expect(other.text).toContain('Next action:');
  });

  it('rejects when already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(new MockProvider().send({ ...request('hi'), signal: controller.signal })).rejects.toBeInstanceOf(CoachUnavailable);
  });
});

describe('OpenAICompatibleProvider', () => {
  it('posts system-first messages with the Bearer key and max_tokens', async () => {
    const { fetchFn, calls } = stubFetch(() =>
      jsonResponse(200, { choices: [{ message: { content: 'Use df+1,4.\nNext action: Drill it.' } }] }),
    );
    const provider = new OpenAICompatibleProvider({
      baseUrl: 'https://example.test/v1', apiKey: SECRET, model: 'test-model',
      fetchImpl: fetchFn as typeof fetch, retryDelayMs: 1, timeoutMs: 5000,
    });
    const result = await provider.send(request('Punish -13?'));
    expect(result.text).toContain('Use df+1,4.');
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('https://example.test/v1/chat/completions');
    const headers = calls[0]?.init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${SECRET}`);
    const body = JSON.parse(String(calls[0]?.init?.body)) as { model: string; messages: { role: string }[]; max_tokens: number };
    expect(body.model).toBe('test-model');
    expect(body.messages[0]?.role).toBe('system');
    expect(body.messages[1]?.role).toBe('user');
    expect(body.max_tokens).toBe(600);
  });

  it('retries once on a 500, then succeeds', async () => {
    let attempts = 0;
    const { fetchFn } = stubFetch(() => {
      attempts += 1;
      return attempts === 1
        ? jsonResponse(500, {})
        : jsonResponse(200, { choices: [{ message: { content: 'ok' } }] });
    });
    const provider = new OpenAICompatibleProvider({
      baseUrl: 'https://example.test/v1', apiKey: SECRET, model: 'm',
      fetchImpl: fetchFn as typeof fetch, retryDelayMs: 1, timeoutMs: 5000,
    });
    await expect(provider.send(request('hi'))).resolves.toEqual({ text: 'ok' });
    expect(attempts).toBe(2);
  });

  it('retries once on a network error, then throws CoachUnavailable without the key', async () => {
    let attempts = 0;
    const { fetchFn } = stubFetch(() => {
      attempts += 1;
      throw new Error('boom');
    });
    const provider = new OpenAICompatibleProvider({
      baseUrl: 'https://example.test/v1', apiKey: SECRET, model: 'm',
      fetchImpl: fetchFn as typeof fetch, retryDelayMs: 1, timeoutMs: 5000,
    });
    await expect(provider.send(request('hi'))).rejects.toBeInstanceOf(CoachUnavailable);
    expect(attempts).toBe(2);
    try {
      await provider.send(request('hi'));
      throw new Error('should have thrown');
    } catch (error) {
      expect((error as Error).message).not.toContain(SECRET);
      expect((error as Error).message).toContain('AI coach unavailable');
    }
  });

  it('does not retry a 400', async () => {
    let attempts = 0;
    const { fetchFn } = stubFetch(() => {
      attempts += 1;
      return jsonResponse(400, { error: 'bad request' });
    });
    const provider = new OpenAICompatibleProvider({
      baseUrl: 'https://example.test/v1', apiKey: SECRET, model: 'm',
      fetchImpl: fetchFn as typeof fetch, retryDelayMs: 1, timeoutMs: 5000,
    });
    await expect(provider.send(request('hi'))).rejects.toBeInstanceOf(CoachUnavailable);
    expect(attempts).toBe(1);
  });

  it('throws CoachUnavailable on a malformed response', async () => {
    const { fetchFn } = stubFetch(() => jsonResponse(200, { choices: [] }));
    const provider = new OpenAICompatibleProvider({
      baseUrl: 'https://example.test/v1', apiKey: SECRET, model: 'm',
      fetchImpl: fetchFn as typeof fetch, retryDelayMs: 1, timeoutMs: 5000,
    });
    await expect(provider.send(request('hi'))).rejects.toBeInstanceOf(CoachUnavailable);
  });
});

describe('AnthropicProvider', () => {
  it('posts the Anthropic shape with the required headers and default model', async () => {
    const { fetchFn, calls } = stubFetch(() =>
      jsonResponse(200, { content: [{ type: 'text', text: 'Use ws1,2.' }, { type: 'text', text: ' Next action: Drill it.' }] }),
    );
    const provider = new AnthropicProvider({
      apiKey: SECRET, fetchImpl: fetchFn as typeof fetch, retryDelayMs: 1, timeoutMs: 5000,
    });
    const result = await provider.send(request('Punish -13 crouching?'));
    expect(result.text).toBe('Use ws1,2. Next action: Drill it.');
    expect(calls[0]?.url).toBe('https://api.anthropic.com/v1/messages');
    const headers = calls[0]?.init?.headers as Record<string, string>;
    expect(headers['x-api-key']).toBe(SECRET);
    expect(headers['anthropic-version']).toBe('2023-06-01');
    expect(headers['anthropic-dangerous-direct-browser-access']).toBe('true');
    const body = JSON.parse(String(calls[0]?.init?.body)) as { model: string; system: string; max_tokens: number };
    expect(body.model).toBe('claude-sonnet-5-5');
    expect(body.system).toBe('You are the coach.');
    expect(body.max_tokens).toBe(600);
  });

  it('retries once on a 429, then throws CoachUnavailable without the key', async () => {
    const { fetchFn } = stubFetch(() => jsonResponse(429, {}));
    const provider = new AnthropicProvider({
      apiKey: SECRET, fetchImpl: fetchFn as typeof fetch, retryDelayMs: 1, timeoutMs: 5000,
    });
    try {
      await provider.send(request('hi'));
      throw new Error('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(CoachUnavailable);
      expect((error as Error).message).not.toContain(SECRET);
    }
  });

  it('uses an explicit model and baseUrl when configured', async () => {
    const { fetchFn, calls } = stubFetch(() =>
      jsonResponse(200, { content: [{ type: 'text', text: 'ok' }] }),
    );
    const provider = new AnthropicProvider({
      apiKey: SECRET, model: 'custom-model', baseUrl: 'https://proxy.test/messages',
      fetchImpl: fetchFn as typeof fetch, retryDelayMs: 1, timeoutMs: 5000,
    });
    await provider.send(request('hi'));
    expect(calls[0]?.url).toBe('https://proxy.test/messages');
    const body = JSON.parse(String(calls[0]?.init?.body)) as { model: string };
    expect(body.model).toBe('custom-model');
  });
});
