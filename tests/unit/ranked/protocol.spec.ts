// 2.0 M2 (F6) — the ranked session protocol: trailing loss streak, rating
// delta, stop-loss (3 straight losses or a 75-point rating drop),
// acknowledgement resets, and the 30-minute session split.
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_STOP_LOSS, REFLECTION_SECONDS, SESSION_GAP_MINUTES, SESSION_RECENT_MINUTES,
  appendNote, currentSessionBattles, evaluateStopLoss, formatReflection, ratingDelta,
  resetPrompt, summarizeSession, trailingLossStreak, type ProtocolBattle, type RankedSessionState,
} from '../../../src/domain/ranked/protocol';

function battle(at: string, overrides: Partial<ProtocolBattle> = {}): ProtocolBattle {
  return { at, result: 'win', ...overrides };
}

const T0 = '2026-11-02T20:00:00.000Z';
function plusMin(iso: string, minutes: number): string {
  return new Date(Date.parse(iso) + minutes * 60_000).toISOString();
}

describe('trailingLossStreak', () => {
  it('counts losses at the end of the list, stopping at a win or draw', () => {
    const battles = [
      battle(T0, { result: 'win' }),
      battle(plusMin(T0, 1), { result: 'loss' }),
      battle(plusMin(T0, 2), { result: 'loss' }),
      battle(plusMin(T0, 3), { result: 'loss' }),
    ];
    expect(trailingLossStreak(battles)).toBe(3);
  });

  it('is 0 when the last battle is a win or a draw', () => {
    expect(trailingLossStreak([battle(T0, { result: 'loss' }), battle(plusMin(T0, 1), { result: 'draw' })])).toBe(0);
    expect(trailingLossStreak([battle(T0, { result: 'win' })])).toBe(0);
    expect(trailingLossStreak([])).toBe(0);
  });
});

describe('ratingDelta', () => {
  it('sums the rating changes present', () => {
    expect(ratingDelta([battle(T0, { ratingChange: 10 }), battle(plusMin(T0, 1), { ratingChange: -25 })])).toBe(-15);
  });

  it('is null when no battle carries a ratingChange', () => {
    expect(ratingDelta([battle(T0), battle(plusMin(T0, 1))])).toBeNull();
    expect(ratingDelta([])).toBeNull();
  });
});

describe('evaluateStopLoss', () => {
  it('triggers on 3 straight losses', () => {
    const battles = [1, 2, 3].map((i) => battle(plusMin(T0, i), { result: 'loss' }));
    const check = evaluateStopLoss(battles);
    expect(check.triggered).toBe(true);
    expect(check.reason).toBe('streak');
    expect(check.streak).toBe(3);
  });

  it('does not trigger on 2 straight losses', () => {
    const battles = [1, 2].map((i) => battle(plusMin(T0, i), { result: 'loss' }));
    expect(evaluateStopLoss(battles).triggered).toBe(false);
  });

  it('triggers when the rating drop reaches the threshold (>=75)', () => {
    const battles = [
      battle(T0, { result: 'loss', ratingChange: -40 }),
      battle(plusMin(T0, 1), { result: 'win', ratingChange: -35 }),
    ];
    const check = evaluateStopLoss(battles, DEFAULT_STOP_LOSS);
    expect(check.triggered).toBe(true);
    expect(check.reason).toBe('rating');
    expect(check.delta).toBe(-75);
  });

  it('does not trigger just short of the rating threshold', () => {
    const battles = [battle(T0, { result: 'loss', ratingChange: -74 })];
    expect(evaluateStopLoss(battles).triggered).toBe(false);
  });

  it('streak takes priority when both would trigger, and respects custom rules', () => {
    const battles = [1, 2, 3].map((i) => battle(plusMin(T0, i), { result: 'loss', ratingChange: -50 }));
    const check = evaluateStopLoss(battles, { straightLosses: 3, ratingDrop: 1000 });
    expect(check.triggered).toBe(true);
    expect(check.reason).toBe('streak');
  });
});

describe('currentSessionBattles — acknowledgement reset', () => {
  it('counts from the session start with no acknowledgement', () => {
    const session: RankedSessionState = { startedAt: T0 };
    const battles = [battle(plusMin(T0, -5)), battle(T0), battle(plusMin(T0, 5))];
    const current = currentSessionBattles(battles, Date.parse(plusMin(T0, 5)), session);
    expect(current.map((b) => b.at)).toEqual([T0, plusMin(T0, 5)]);
  });

  it('resets counting from the acknowledged battle (exclusive)', () => {
    const ackAt = plusMin(T0, 10);
    const session: RankedSessionState = { startedAt: T0, stopLossAcknowledgedAt: ackAt };
    const battles = [battle(T0), battle(ackAt, { result: 'loss' }), battle(plusMin(T0, 15))];
    const current = currentSessionBattles(battles, Date.parse(plusMin(T0, 15)), session);
    expect(current.map((b) => b.at)).toEqual([plusMin(T0, 15)]);
  });
});

describe('currentSessionBattles — implicit session (no explicit state)', () => {
  it('keeps battles together at exactly the 30-minute gap (boundary is inclusive)', () => {
    const battles = [battle(T0), battle(plusMin(T0, SESSION_GAP_MINUTES))];
    const current = currentSessionBattles(battles, Date.parse(plusMin(T0, SESSION_GAP_MINUTES)), null);
    expect(current.map((b) => b.at)).toEqual([T0, plusMin(T0, SESSION_GAP_MINUTES)]);
  });

  it('splits sessions once the gap exceeds 30 minutes', () => {
    const battles = [battle(T0), battle(plusMin(T0, SESSION_GAP_MINUTES + 1))];
    const current = currentSessionBattles(battles, Date.parse(plusMin(T0, SESSION_GAP_MINUTES + 1)), null);
    expect(current.map((b) => b.at)).toEqual([plusMin(T0, SESSION_GAP_MINUTES + 1)]);
  });

  it('is empty when the last battle ended more than 120 minutes before now', () => {
    const battles = [battle(T0)];
    const now = Date.parse(plusMin(T0, SESSION_RECENT_MINUTES + 1));
    expect(currentSessionBattles(battles, now, null)).toEqual([]);
  });

  it('is non-empty right at the 120-minute recency boundary', () => {
    const battles = [battle(T0)];
    const now = Date.parse(plusMin(T0, SESSION_RECENT_MINUTES));
    expect(currentSessionBattles(battles, now, null)).toHaveLength(1);
  });
});

describe('summarizeSession', () => {
  it('counts games, wins, losses, draws, sets and the rating delta', () => {
    const battles = [
      battle(T0, { result: 'win', ratingChange: 10, setId: 's1' }),
      battle(plusMin(T0, 1), { result: 'loss', ratingChange: -5, setId: 's1' }),
      battle(plusMin(T0, 2), { result: 'draw', setId: 's2' }),
    ];
    expect(summarizeSession(battles)).toEqual({ games: 3, wins: 1, losses: 1, draws: 1, sets: 2, delta: 5 });
  });
});

describe('resetPrompt / formatReflection / appendNote', () => {
  it('names the focus when given, and offers a generic prompt otherwise', () => {
    expect(resetPrompt('Low parry')).toContain('Low parry');
    expect(resetPrompt()).toContain('Pick the one thing');
  });

  it('formats a reflection with the day and optional focus', () => {
    const text = formatReflection(' good focus today ', 'Low parry', T0);
    expect(text).toBe('Ranked session reflection 2026-11-02 (focus: Low parry): good focus today');
  });

  it('appends a note on a new paragraph, or starts fresh when empty', () => {
    expect(appendNote(undefined, 'first')).toBe('first');
    expect(appendNote('  ', 'first')).toBe('first');
    expect(appendNote('existing', 'next')).toBe('existing\n\nnext');
  });

  it('REFLECTION_SECONDS is the 30-second reflection window', () => {
    expect(REFLECTION_SECONDS).toBe(30);
  });
});
