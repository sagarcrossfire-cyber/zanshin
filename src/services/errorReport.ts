// Global error reporting — spec §14.1. Global handlers for `error` and
// `unhandledrejection` write to the errors ring buffer (last 50) and show
// at most one toast per minute. Messages are sanitized: API keys and bearer
// tokens are redacted before anything is stored or shown, so a secret can
// never leak into Diagnostics, a copied error, or a toast (AC-COACH-3).
import { errorsRepo } from '../data/repos';

const TOAST_MIN_INTERVAL_MS = 60_000;
const MAX_MESSAGE_LENGTH = 2000;

let lastToastAt = 0;

export function sanitizeErrorText(text: string): string {
  return text
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, 'sk-[redacted]')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [redacted]')
    .replace(/api[_-]?key\s*[:=]\s*['"]?[A-Za-z0-9._-]{8,}['"]?/gi, 'api-key=[redacted]')
    .slice(0, MAX_MESSAGE_LENGTH);
}

export function describeError(error: unknown): { name: string; message: string } {
  if (error instanceof Error) return { name: error.name, message: sanitizeErrorText(error.message) };
  return { name: 'Error', message: sanitizeErrorText(String(error)) };
}

/** QuotaExceededError (or Dexie's QuotaExceeded wrapper): storage is full. */
export function isQuotaError(error: unknown): boolean {
  if (error instanceof Error) {
    if (error.name === 'QuotaExceededError') return true;
    // Dexie wraps some DOMExceptions; the message still names the quota.
    if (/quota/i.test(error.message) && /exceed/i.test(error.message)) return true;
  }
  if (typeof DOMException !== 'undefined' && error instanceof DOMException) {
    return error.name === 'QuotaExceededError';
  }
  return false;
}

export function storageFullMessage(): string {
  return 'Storage is full — nothing was lost. Export a backup, then remove old snapshots in Settings to free space.';
}

/**
 * Write an error record to the ring buffer without any toast. Used by the
 * per-route error boundary, which shows its own screen.
 */
export function recordError(where: string, error: unknown, nowMs: number = Date.now()): void {
  const { name, message } = describeError(error);
  const text = isQuotaError(error) ? storageFullMessage() : `${name}: ${message}`;
  void errorsRepo
    .put({
      at: new Date(nowMs).toISOString(),
      id: `err-${nowMs}-${Math.floor(Math.random() * 1e6)}`,
      message: `[${where}] ${text}`,
      where,
    })
    .catch(() => {
      // The errors table itself is unavailable (e.g. storage full): swallow.
    });
}

/**
 * Record an unexpected error and decide whether a toast may be shown.
 * Returns the (sanitized) message to show, or null when the one-per-minute
 * throttle suppresses the toast. The write is fire-and-forget: reporting
 * must never throw into the handler that called it.
 */
export function reportUnexpectedError(
  where: string,
  error: unknown,
  nowMs: number = Date.now(),
): string | null {
  recordError(where, error, nowMs);
  const { name, message } = describeError(error);
  const text = isQuotaError(error) ? storageFullMessage() : `${name}: ${message}`;
  if (nowMs - lastToastAt < TOAST_MIN_INTERVAL_MS) return null;
  lastToastAt = nowMs;
  return text;
}

/** Test helper: resets the toast throttle. */
export function resetErrorThrottleForTests(): void {
  lastToastAt = 0;
}
