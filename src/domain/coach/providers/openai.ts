// Spec §8.7 — OpenAI-compatible provider. POST {baseUrl}/chat/completions with
// model, messages (system first) and max_tokens; Authorization: Bearer <key>.
// The key comes from config only and never appears in errors or logs.

import {
  CoachUnavailable,
  fetchWithRetry,
  parseJsonBody,
  type CoachProvider,
  type CoachRequest,
  type CoachResponse,
} from './index';

export interface OpenAICompatibleConfig {
  baseUrl: string;
  apiKey: string;
  /** Model name is a required setting. */
  model: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  retryDelayMs?: number;
}

interface OpenAIResponse {
  choices?: { message?: { content?: unknown } }[];
}

export class OpenAICompatibleProvider implements CoachProvider {
  readonly id = 'openai-compatible' as const;
  private readonly config: OpenAICompatibleConfig;

  constructor(config: OpenAICompatibleConfig) {
    this.config = config;
  }

  async send(input: CoachRequest): Promise<CoachResponse> {
    const fetchFn = this.config.fetchImpl ?? globalThis.fetch;
    const url = `${this.config.baseUrl.replace(/\/$/, '')}/chat/completions`;
    const response = await fetchWithRetry(
      fetchFn,
      url,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({
          model: this.config.model,
          messages: [{ role: 'system', content: input.system }, ...input.messages],
          max_tokens: input.maxTokens,
        }),
      },
      { timeoutMs: this.config.timeoutMs, retryDelayMs: this.config.retryDelayMs, signal: input.signal },
    );
    const body = (await parseJsonBody(response)) as OpenAIResponse;
    const content = body.choices?.[0]?.message?.content;
    if (typeof content !== 'string') throw new CoachUnavailable('invalid response');
    return { text: content };
  }
}
