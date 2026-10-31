// P11 — resilience helpers (§14.1/§14.4/§14.5): update gate (R8), error
// reporting (sanitize + throttle + quota), Safe Mode detection, backup
// prompt timing (§14.3).
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isSafeMode, safeModeSearch, setSafeMode } from '../../src/config/safeMode';
import {
  isQuotaError,
  recordError,
  reportUnexpectedError,
  resetErrorThrottleForTests,
  sanitizeErrorText,
  storageFullMessage,
} from '../../src/services/errorReport';
import {
  isBackupPromptDue,
} from '../../src/services/backupPrompt';
import {
  isSessionActive,
  isUpdatePending,
  mayShowUpdateToast,
  reloadForUpdate,
  resetUpdateGateForTests,
  setSessionActive,
  setUpdatePending,
  setUpdateReloader,
  subscribeUpdateGate,
} from '../../src/services/updateGate';
import { errorsRepo, resetDbForTests } from '../../src/data/repos';

beforeEach(async () => {
  await resetDbForTests();
  resetUpdateGateForTests();
  resetErrorThrottleForTests();
});

afterEach(async () => {
  await resetDbForTests();
  resetUpdateGateForTests();
  setSafeMode(false);
  window.history.replaceState(null, '', '/');
});

describe('update gate (R8)', () => {
  it('holds the update toast while a session is active, releases it when the session ends', () => {
    const seen: boolean[] = [];
    const off = subscribeUpdateGate(() => seen.push(mayShowUpdateToast()));
    setUpdatePending(true);
    expect(mayShowUpdateToast()).toBe(true);
    setSessionActive(true);
    expect(mayShowUpdateToast()).toBe(false);
    setSessionActive(false);
    expect(mayShowUpdateToast()).toBe(true);
    expect(seen).toEqual([true, false, true]);
    off();
  });

  it('shows nothing until an update is pending', () => {
    setSessionActive(false);
    expect(isUpdatePending()).toBe(false);
    expect(mayShowUpdateToast()).toBe(false);
    setUpdatePending(true);
    expect(mayShowUpdateToast()).toBe(true);
  });

  it('reloadForUpdate calls the registered reloader, and does not throw without one', () => {
    // jsdom's location.reload is non-configurable, so the no-reloader
    // fallback is covered by "does not throw" (it is one line that calls
    // window.location.reload); the reloader path is asserted directly.
    expect(() => reloadForUpdate()).not.toThrow();
    let called = false;
    setUpdateReloader(() => { called = true; });
    reloadForUpdate();
    expect(called).toBe(true);
    expect(isSessionActive()).toBe(false);
  });
});

describe('error reporting (§14.1)', () => {
  it('redacts API keys and bearer tokens before anything is stored or shown', () => {
    const text = sanitizeErrorText('boom sk-TEST-SENTINEL-7f3a9c and Bearer abc.def.ghi api_key=sekritvalue99');
    expect(text).not.toContain('sk-TEST-SENTINEL-7f3a9c');
    expect(text).not.toContain('abc.def.ghi');
    expect(text).not.toContain('sekritvalue99');
    expect(text).toContain('sk-[redacted]');
    expect(text).toContain('Bearer [redacted]');
  });

  it('classifies QuotaExceededError and offers the storage-full message', () => {
    const quota = new DOMException('Quota exceeded', 'QuotaExceededError');
    expect(isQuotaError(quota)).toBe(true);
    expect(isQuotaError(new Error('plain failure'))).toBe(false);
    expect(storageFullMessage()).toContain('Storage is full');
    expect(storageFullMessage()).toContain('Export a backup');
    expect(storageFullMessage()).toContain('remove old snapshots');
  });

  it('records to the ring buffer and throttles toasts to one per minute', async () => {
    // Realistic wall-clock timestamps: the throttle compares against the
    // epoch, so synthetic small values would read as "within the first
    // minute" and suppress the first toast.
    const t0 = 1_760_000_000_000;
    const first = reportUnexpectedError('test', new Error('first'), t0);
    expect(first).toBe('Error: first');
    const throttled = reportUnexpectedError('test', new Error('second'), t0 + 30_000);
    expect(throttled).toBeNull();
    const afterMinute = reportUnexpectedError('test', new Error('third'), t0 + 61_000);
    expect(afterMinute).toBe('Error: third');
    const rows = await errorsRepo.all();
    expect(rows.map((r) => r.message)).toContain('[test] Error: first');
    expect(rows.map((r) => r.message)).toContain('[test] Error: second');
    expect(rows.map((r) => r.message)).toContain('[test] Error: third');
  });

  it('recordError writes without a toast path and never leaks a key', async () => {
    recordError('test', new Error('leak sk-TEST-SENTINEL-7f3a9c'), 5_000);
    const rows = await errorsRepo.all();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.message).not.toContain('sk-TEST-SENTINEL-7f3a9c');
    expect(rows[0]?.message).toContain('sk-[redacted]');
  });
});

describe('Safe Mode detection (§14.4)', () => {
  it('reads ?safe=1 from the URL', () => {
    window.history.replaceState(null, '', '/today?safe=1');
    expect(isSafeMode()).toBe(true);
    window.history.replaceState(null, '', '/today');
    expect(isSafeMode()).toBe(false);
  });

  it('reads the persisted flag and clears it on exit', () => {
    expect(isSafeMode()).toBe(false);
    setSafeMode(true);
    expect(isSafeMode()).toBe(true);
    expect(safeModeSearch(true)).toBe('?safe=1');
    setSafeMode(false);
    expect(isSafeMode()).toBe(false);
    expect(safeModeSearch(false)).toBe('');
  });
});

describe('backup prompt (§14.3)', () => {
  it('is due with no history, quiet within 14 days, due again on day 14', () => {
    expect(isBackupPromptDue(null, null, '2026-10-30')).toBe(true);
    expect(isBackupPromptDue('2026-10-29', null, '2026-10-30')).toBe(false);
    expect(isBackupPromptDue(null, '2026-10-20', '2026-10-30')).toBe(false);
    expect(isBackupPromptDue('2026-10-16', null, '2026-10-30')).toBe(true);
    expect(isBackupPromptDue('2026-10-01', '2026-10-20', '2026-10-30')).toBe(false);
    expect(isBackupPromptDue('2026-10-01', '2026-10-15', '2026-10-30')).toBe(true);
  });

  it('treats unparseable dates as due', () => {
    expect(isBackupPromptDue('not-a-date', null, '2026-10-30')).toBe(true);
  });
});
