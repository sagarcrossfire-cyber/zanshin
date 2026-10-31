// @vitest-environment node
// P9 — Provider adapter contracts (§8.7) against a local mock server.
// No external network. Verifies request shapes, headers, retry-on-429/5xx,
// and CoachUnavailable after the retry budget is spent.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AnthropicProvider } from '../../src/domain/coach/providers/anthropic';
import { CoachUnavailable } from '../../src/domain/coach/providers';
import { OpenAICompatibleProvider } from '../../src/domain/coach/providers/openai';

interface Seen {
  method: string;
  url: string;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

let server: Server;
let baseUrl = '';
let seen: Seen[] = [];
let scripted: { status: number; body: unknown }[] = [];

function handler(req: IncomingMessage, res: ServerResponse) {
  let body = '';
  req.on('data', (chunk: Buffer) => {
    body += chunk.toString();
  });
  req.on('end', () => {
    seen.push({ method: req.method ?? '', url: req.url ?? '', headers: req.headers, body });
    const next = scripted.shift() ?? { status: 200, body: {} };
    res.writeHead(next.status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(next.body));
  });
}

beforeAll(async () => {
  server = createServer(handler);
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
});

const input = {
  system: 'System prompt.',
  messages: [{ role: 'user' as const, content: 'Hello?' }],
  maxTokens: 600,
  signal: new AbortController().signal,
};

describe('openai-compatible adapter', () => {
  it('posts model/messages/system-first/max_tokens with a Bearer key', async () => {
    seen = [];
    scripted = [{ status: 200, body: { choices: [{ message: { content: 'Hi.\nNext action: Drill.' } }] } }];
    const provider = new OpenAICompatibleProvider({
      baseUrl, apiKey: 'sk-test-key', model: 'test-model', timeoutMs: 2000, retryDelayMs: 10,
    });
    const response = await provider.send(input);
    expect(response.text).toBe('Hi.\nNext action: Drill.');
    expect(seen).toHaveLength(1);
    const request = seen[0] as Seen;
    expect(request.url).toBe('/chat/completions');
    expect(request.headers.authorization).toBe('Bearer sk-test-key');
    const body = JSON.parse(request.body) as { model: string; max_tokens: number; messages: { role: string }[] };
    expect(body.model).toBe('test-model');
    expect(body.max_tokens).toBe(600);
    expect(body.messages[0]?.role).toBe('system');
    expect(body.messages[1]?.role).toBe('user');
  });

  it('retries once on 429, then succeeds', async () => {
    seen = [];
    scripted = [
      { status: 429, body: { error: 'slow down' } },
      { status: 200, body: { choices: [{ message: { content: 'Recovered.\nNext action: Drill.' } }] } },
    ];
    const provider = new OpenAICompatibleProvider({
      baseUrl, apiKey: 'k', model: 'm', timeoutMs: 2000, retryDelayMs: 10,
    });
    const response = await provider.send(input);
    expect(response.text).toContain('Recovered.');
    expect(seen).toHaveLength(2);
  });

  it('throws CoachUnavailable after two 500s, without the key', async () => {
    seen = [];
    scripted = [
      { status: 500, body: {} },
      { status: 500, body: {} },
    ];
    const provider = new OpenAICompatibleProvider({
      baseUrl, apiKey: 'sk-secret-key', model: 'm', timeoutMs: 2000, retryDelayMs: 10,
    });
    let caught: unknown;
    try {
      await provider.send(input);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(CoachUnavailable);
    expect((caught as Error).message).toContain('HTTP 500');
    expect((caught as Error).message).not.toContain('sk-secret-key');
    expect(seen).toHaveLength(2);
  });
});

describe('anthropic adapter', () => {
  it('posts system/messages/max_tokens with the required headers', async () => {
    seen = [];
    scripted = [{ status: 200, body: { content: [{ type: 'text', text: 'Hey.\nNext action: Drill.' }] } }];
    const provider = new AnthropicProvider({
      apiKey: 'sk-ant-key', model: 'claude-sonnet-5-5', baseUrl: `${baseUrl}/v1/messages`,
      timeoutMs: 2000, retryDelayMs: 10,
    });
    const response = await provider.send(input);
    expect(response.text).toBe('Hey.\nNext action: Drill.');
    expect(seen).toHaveLength(1);
    const request = seen[0] as Seen;
    expect(request.headers['x-api-key']).toBe('sk-ant-key');
    expect(request.headers['anthropic-version']).toBe('2023-06-01');
    expect(request.headers['anthropic-dangerous-direct-browser-access']).toBe('true');
    const body = JSON.parse(request.body) as { system: string; max_tokens: number; model: string };
    expect(body.system).toBe('System prompt.');
    expect(body.max_tokens).toBe(600);
    expect(body.model).toBe('claude-sonnet-5-5');
  });
});

describe('R7 timeout (P11)', () => {
  it('a provider answering after the timeout is tried once, then CoachUnavailable', async () => {
    // Dedicated hanging server: never responds. The provider is configured
    // with a 50 ms timeout + 5 ms retry delay so the production 30 s / 2 s
    // defaults are exercised structurally (see PROVIDER_TIMEOUT_MS) without
    // waiting 60+ seconds. Exactly 2 attempts must reach the server.
    let attempts = 0;
    const hanging = createServer((_req, _res) => {
      attempts += 1;
      // Never respond: the AbortController fires, the socket is destroyed.
    });
    await new Promise<void>((resolve) => {
      hanging.listen(0, '127.0.0.1', () => resolve());
    });
    try {
      const address = hanging.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      const provider = new OpenAICompatibleProvider({
        baseUrl: `http://127.0.0.1:${port}`, apiKey: 'sk-hang-key', model: 'm',
        timeoutMs: 50, retryDelayMs: 5,
      });
      const start = Date.now();
      let caught: unknown;
      try {
        await provider.send(input);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(CoachUnavailable);
      expect(attempts).toBe(2);
      expect(Date.now() - start).toBeLessThan(5000);
    } finally {
      await new Promise<void>((resolve) => {
        hanging.close(() => resolve());
      });
    }
  });
});
