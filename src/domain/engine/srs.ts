// Spec §7.6 — spaced repetition, an SM-2 variant. Pure functions; the clock is injected.

export type Grade = 0 | 1 | 2 | 3;

export const GRADE_AGAIN: Grade = 0;
export const GRADE_HARD: Grade = 1;
export const GRADE_GOOD: Grade = 2;
export const GRADE_EASY: Grade = 3;

export interface CardState {
  cardId: string;
  reps: number;
  lapses: number;
  ease: number;
  intervalDays: number;
  due: string; // practice day, YYYY-MM-DD
  lastGrade?: Grade;
  history: { at: string; grade: Grade }[];
}

export const EASE_FLOOR = 1.3;
export const INTERVAL_CAP_DAYS = 180;
export const DEFAULT_DAY_BOUNDARY = '04:00';

function parseBoundary(boundary: string): number {
  const match = /^(\d{1,2}):(\d{2})$/.exec(boundary.trim());
  if (match === null) return 4 * 60;
  return (Number(match[1]) % 24) * 60 + Number(match[2]);
}

function wallClock(dateTime: string): { date: string; minutes: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::\d{2})?)?/.exec(dateTime);
  if (match === null) return null;
  return {
    date: `${match[1] as string}-${match[2] as string}-${match[3] as string}`,
    minutes: match[4] !== undefined && match[5] !== undefined ? Number(match[4]) * 60 + Number(match[5]) : 0,
  };
}

function addDays(date: string, days: number): string {
  const ms = Date.parse(`${date}T00:00:00Z`);
  if (Number.isNaN(ms)) return date;
  return new Date(ms + days * 86400000).toISOString().slice(0, 10);
}

/**
 * The practice day a date-time belongs to: the day rolls over at the day
 * boundary (04:00 by default), so a review at 01:30 counts for the day before.
 */
export function practiceDay(dateTime: string, boundary: string = DEFAULT_DAY_BOUNDARY): string {
  const clock = wallClock(dateTime);
  if (clock === null) return dateTime.slice(0, 10);
  if (clock.minutes < parseBoundary(boundary)) return addDays(clock.date, -1);
  return clock.date;
}

/** The interval Good would give from this state (used by Easy's 1.3x rule). */
function goodInterval(repsAfter: number, intervalDays: number, ease: number): number {
  if (repsAfter === 1) return 1;
  if (repsAfter === 2) return 3;
  return Math.round(intervalDays * ease);
}

export function gradeCard(
  state: CardState,
  grade: Grade,
  gradedAt: string,
  dayBoundary: string = DEFAULT_DAY_BOUNDARY,
): CardState {
  const today = practiceDay(gradedAt, dayBoundary);
  const repsAfter = grade === GRADE_AGAIN ? 0 : state.reps + 1;
  let lapses = state.lapses;
  let ease = state.ease;
  let intervalDays: number;
  switch (grade) {
    case GRADE_AGAIN:
      lapses += 1;
      intervalDays = 1;
      ease = Math.max(EASE_FLOOR, ease - 0.2);
      break;
    case GRADE_HARD:
      intervalDays = Math.max(1, Math.round(state.intervalDays * 1.2));
      ease = Math.max(EASE_FLOOR, ease - 0.15);
      break;
    case GRADE_GOOD:
      intervalDays = goodInterval(repsAfter, state.intervalDays, ease);
      break;
    case GRADE_EASY:
      intervalDays = Math.max(4, Math.round(goodInterval(repsAfter, state.intervalDays, ease) * 1.3));
      ease = ease + 0.15;
      break;
    default:
      intervalDays = state.intervalDays;
      break;
  }
  intervalDays = Math.min(INTERVAL_CAP_DAYS, intervalDays);
  return {
    cardId: state.cardId,
    reps: repsAfter,
    lapses,
    ease,
    intervalDays,
    due: addDays(today, intervalDays),
    lastGrade: grade,
    history: [...state.history, { at: gradedAt, grade }],
  };
}

/** Cards due on or before `day` (a practice day, YYYY-MM-DD). */
export function dueCount(states: CardState[], day: string): number {
  return states.filter((state) => state.due <= day).length;
}
