// Spec §8.7 — Anthropic provider. POST https://api.anthropic.com/v1/messages
// with model, system, messages and max_tokens; headers x-api-key,
// anthropic-version: 2023-06-01, anthropic-dangerous-direct-browser-access.
// The key comes from config only and never appears in errors or logs.

import {
  CoachUnavailable,
  fetchWithRetry,
  parseJsonBody,
  type CoachProvider,
  type CoachRequest,
  type CoachResponse,
} from './index';

export interface AnthropicConfig {
  apiKey: string;
  /** Editable setting, prefilled claude-sonnet-5-5. */
  model?: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  retryDelayMs?: number;
}

interface AnthropicResponse {
  content?: { type?: string; text?: unknown }[] | unknown;
}

export class AnthropicProvider implements CoachProvider {
  readonly id = 'anthropic' as const;
  private readonly config: AnthropicConfig;

  constructor(config: AnthropicConfig) {
    this.config = config;
  }

  async send(input: CoachRequest): Promise<CoachResponse> {
    const fetchFn = this.config.fetchImpl ?? globalThis.fetch;
    const url = this.config.baseUrl ?? 'https://api.anthropic.com/v1/messages';
    const response = await fetchWithRetry(
      fetchFn,
      url,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.config.apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model: this.config.model ?? 'claude-sonnet-5-5',
          system: input.system,
          messages: input.messages,
          max_tokens: input.maxTokens,
        }),
      },
      { timeoutMs: this.config.timeoutMs, retryDelayMs: this.config.retryDelayMs, signal: input.signal },
    );
    const body = (await parseJsonBody(response)) as AnthropicResponse;
    if (!Array.isArray(body.content)) throw new CoachUnavailable('invalid response');
    const text = body.content
      .filter((block) => block.type === 'text' && typeof block.text === 'string')
      .map((block) => block.text as string)
      .join('');
    if (text === '') throw new CoachUnavailable('invalid response');
    return { text };
  }
}
