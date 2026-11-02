// 2.0 M2 (F6) — the ranked session protocol, as pure rules over synced
// battles (docs/v2/research/coach-intel.md §1.4): one focus before queueing,
// a stop-loss (3 losses in a row, or the Wank rating down by a set amount),
// a reset between sets, and a 30-second reflection at the end. The app shows
// these as calm prompts after a sync; nothing here blocks play.

export type ProtocolResult = 'win' | 'loss' | 'draw';

export interface ProtocolBattle {
  at: string;
  result: ProtocolResult;
  ratingChange?: number;
  setId?: string;
}

export interface StopLossRules {
  /** Stop after this many losses in a row. */
  straightLosses: number;
  /** Stop when the session's Wank rating is down by at least this much. */
  ratingDrop: number;
}

export const DEFAULT_STOP_LOSS: StopLossRules = { straightLosses: 3, ratingDrop: 75 };

/** Battles more than this far apart belong to different play sessions. */
export const SESSION_GAP_MINUTES = 30;
/** A play session older than this (by its last battle) is over. */
export const SESSION_RECENT_MINUTES = 120;

export interface RankedSessionState {
  startedAt: string;
  focusNodeId?: string;
  focusTitle?: string;
  /** "Keep going" after a stop-loss: rules count again from this battle time. */
  stopLossAcknowledgedAt?: string;
}

/** Losses at the end of the list (a win or a draw ends the run). */
export function trailingLossStreak(battles: readonly ProtocolBattle[]): number {
  let streak = 0;
  for (let i = battles.length - 1; i >= 0; i -= 1) {
    if (battles[i]?.result !== 'loss') break;
    streak += 1;
  }
  return streak;
}

/** Sum of the rating changes, or null when no battle has one. */
export function ratingDelta(battles: readonly ProtocolBattle[]): number | null {
  let seen = false;
  let total = 0;
  for (const battle of battles) {
    if (battle.ratingChange === undefined) continue;
    seen = true;
    total += battle.ratingChange;
  }
  return seen ? total : null;
}

export interface StopLossCheck {
  triggered: boolean;
  reason: 'streak' | 'rating' | null;
  streak: number;
  delta: number | null;
  message: string;
}

export function evaluateStopLoss(battles: readonly ProtocolBattle[], rules: StopLossRules = DEFAULT_STOP_LOSS): StopLossCheck {
  const ordered = [...battles].sort((a, b) => (a.at < b.at ? -1 : 1));
  const streak = trailingLossStreak(ordered);
  const delta = ratingDelta(ordered);
  if (streak >= rules.straightLosses) {
    return {
      triggered: true, reason: 'streak', streak, delta,
      message: `${streak} losses in a row — that is your stop-loss. Stand up, drink some water, and come back for one more set only if your focus is clear.`,
    };
  }
  if (delta !== null && delta <= -rules.ratingDrop) {
    return {
      triggered: true, reason: 'rating', streak, delta,
      message: `Your rating is down ${Math.abs(delta)} this session — that is your stop-loss. Rank drops slowly in Season 3, so nothing is lost by stopping here. Review one loss instead.`,
    };
  }
  return { triggered: false, reason: null, streak, delta, message: '' };
}

/**
 * The battles of the session being played: after the session's start (and
 * after a "keep going"), or — with no explicit session — the latest run of
 * battles less than SESSION_GAP_MINUTES apart, if it ended within
 * SESSION_RECENT_MINUTES of `nowMs`.
 */
export function currentSessionBattles(
  battles: readonly ProtocolBattle[],
  nowMs: number,
  session?: RankedSessionState | null,
): ProtocolBattle[] {
  const ordered = [...battles].sort((a, b) => (a.at < b.at ? -1 : 1));
  if (session) {
    const from = session.stopLossAcknowledgedAt && session.stopLossAcknowledgedAt > session.startedAt
      ? session.stopLossAcknowledgedAt
      : session.startedAt;
    const strict = from === session.stopLossAcknowledgedAt;
    return ordered.filter((b) => (strict ? b.at > from : b.at >= from));
  }
  const last = ordered[ordered.length - 1];
  if (!last || nowMs - Date.parse(last.at) > SESSION_RECENT_MINUTES * 60_000) return [];
  let start = ordered.length - 1;
  while (start > 0) {
    const previous = ordered[start - 1] as ProtocolBattle;
    const current = ordered[start] as ProtocolBattle;
    if (Date.parse(current.at) - Date.parse(previous.at) > SESSION_GAP_MINUTES * 60_000) break;
    start -= 1;
  }
  return ordered.slice(start);
}

export interface SessionSummary {
  games: number;
  wins: number;
  losses: number;
  draws: number;
  sets: number;
  delta: number | null;
}

export function summarizeSession(battles: readonly ProtocolBattle[]): SessionSummary {
  return {
    games: battles.length,
    wins: battles.filter((b) => b.result === 'win').length,
    losses: battles.filter((b) => b.result === 'loss').length,
    draws: battles.filter((b) => b.result === 'draw').length,
    sets: new Set(battles.map((b) => b.setId ?? b.at)).size,
    delta: ratingDelta(battles),
  };
}

/** The prompt between sets: a breath, then the one focus again. */
export function resetPrompt(focusTitle?: string): string {
  const focus = focusTitle ? `Your focus stays: ${focusTitle}.` : 'Pick the one thing you are practising before the next set.';
  return `Between sets: three slow breaths, drop your shoulders, loosen your grip. ${focus}`;
}

export const REFLECTION_SECONDS = 30;

export const REFLECTION_PROMPTS = [
  'Did you practise your focus? When did it work?',
  'What beat you most often?',
  'One thing to take into the Lab next time.',
] as const;

export function formatReflection(text: string, focusTitle: string | undefined, atIso: string): string {
  const day = atIso.slice(0, 10);
  const focus = focusTitle ? ` (focus: ${focusTitle})` : '';
  return `Ranked session reflection ${day}${focus}: ${text.trim()}`;
}

/** Notes keep everything already written; the reflection goes on a new paragraph. */
export function appendNote(existing: string | undefined, addition: string): string {
  const before = (existing ?? '').trim();
  return before === '' ? addition : `${before}\n\n${addition}`;
}

/** Season 3 rank rules in plain words (official Ver.3.00 notes, coach-intel §1.4). */
export const SEASON3_RULES = {
  points: [
    'Each character has its own rank, and matchmaking uses the rank of the character you pick.',
    'You only drop a rank after two losses in a row. At the bottom of a rank your points stay at the minimum until that second loss.',
    'Promotion bonuses and win-streak bonuses help you climb (streak bonuses stop at the rank below Bushin).',
    'Revenge Bonus: win the rematch right after a loss and you earn extra points.',
    'By default you are matched within two ranks of your own.',
    'The result screen shows exactly how many points each game gave or took.',
  ],
  meaning: 'Losing a rank is slow and easy to win back, so play to practise your focus, not to protect points.',
} as const;
