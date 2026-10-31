// Spec §8.7 — mock provider. Deterministic canned answers keyed by a hash of
// the question; used by every automated test. Never calls a network.

import { hashSeed } from '../../engine/prng';
import {
  CoachUnavailable,
  type CoachProvider,
  type CoachRequest,
  type CoachResponse,
} from './index';

const CANNED: string[] = [
  'The mock coach has no live data. Check the Codex entry for the move and drill it in Practice.\nNext action: Run one set of the drill from today\'s plan.',
  'No provider is configured, so this is the built-in mock answer. Your plan and weaknesses are in the context bundle.\nNext action: Start today\'s session from the Today screen.',
  'This is a deterministic mock reply. Frame values are only quoted from context, never invented.\nNext action: Review the top weakness on the Today screen.',
];

export class MockProvider implements CoachProvider {
  readonly id = 'mock' as const;

  send(input: CoachRequest): Promise<CoachResponse> {
    if (input.signal.aborted) {
      return Promise.reject(new CoachUnavailable('request aborted'));
    }
    const lastUser = [...input.messages].reverse().find((message) => message.role === 'user');
    const question = lastUser?.content ?? '';
    const index = hashSeed(question) % CANNED.length;
    const text = CANNED[index] as string;
    return Promise.resolve({ text });
  }
}

export const mockProvider = new MockProvider();
