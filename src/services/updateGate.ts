// Service worker update gate — spec §14.5 / §13.9 R8. A waiting update must
// never reload during an active Lab session: the "Update available, reload"
// toast waits until the session ends. This module is the single place that
// knows whether a session is active and whether an update is pending; the
// shell subscribes and shows the toast only when both conditions allow it.
type Listener = () => void;

let sessionActive = false;
let updatePending = false;
let interacted = false;
const listeners = new Set<Listener>();

function notify(): void {
  for (const listener of listeners) listener();
}

export function setSessionActive(active: boolean): void {
  if (sessionActive === active) return;
  sessionActive = active;
  notify();
}

export function isSessionActive(): boolean {
  return sessionActive;
}

export function setUpdatePending(pending: boolean): void {
  if (updatePending === pending) return;
  updatePending = pending;
  notify();
}

export function isUpdatePending(): boolean {
  return updatePending;
}

/** True only when the update toast may be shown: pending and no session. */
export function mayShowUpdateToast(): boolean {
  return updatePending && !sessionActive;
}

export function subscribeUpdateGate(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * 2.0.0-beta.1 follow-up: a plain reload must pick up a new release. Browsers
 * never activate a waiting service worker on reload (the reloading tab still
 * holds the old one), so with prompt-only updates the new version waited
 * until every tab closed — Sagar had to unregister the worker by hand. Now,
 * when an update is waiting and the person has not touched this page since
 * it opened (and no Lab session is running), the app applies it and reloads
 * once by itself. Anything typed is never at risk: after the first pointer,
 * key or touch the old toast flow applies.
 */
export function noteUserInteraction(): void {
  interacted = true;
}

/** Listens once for the first pointer, key or touch on this page. */
export function startInteractionWatch(target: Pick<Window, 'addEventListener' | 'removeEventListener'> = window): void {
  const events = ['pointerdown', 'keydown', 'touchstart'] as const;
  const onFirst = (): void => {
    noteUserInteraction();
    for (const type of events) target.removeEventListener(type, onFirst, true);
  };
  for (const type of events) target.addEventListener(type, onFirst, { capture: true, passive: true });
}

export const AUTO_UPDATE_GUARD_KEY = 'zanshin-sw-auto-update-at';
/** One automatic reload per minute at most, so a broken update can never loop. */
export const AUTO_UPDATE_GUARD_MS = 60_000;

/** True when a waiting update may be applied without asking. */
export function shouldAutoApplyUpdate(nowMs: number = Date.now(), storage: Pick<Storage, 'getItem'> | null = safeSessionStorage()): boolean {
  if (!updatePending || sessionActive || interacted) return false;
  try {
    const last = Number(storage?.getItem(AUTO_UPDATE_GUARD_KEY) ?? '');
    if (Number.isFinite(last) && last > 0 && nowMs - last < AUTO_UPDATE_GUARD_MS) return false;
  } catch {
    // Storage blocked: fall through and allow (the toast flow remains the backstop).
  }
  return true;
}

/** Records the automatic reload so the guard above can stop a loop. */
export function markAutoApplied(nowMs: number = Date.now(), storage: Pick<Storage, 'setItem'> | null = safeSessionStorage()): void {
  try {
    storage?.setItem(AUTO_UPDATE_GUARD_KEY, String(nowMs));
  } catch {
    // Storage blocked: nothing to record.
  }
}

function safeSessionStorage(): Storage | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
}

/** Test/reset helper: returns the gate to its initial state. */
export function resetUpdateGateForTests(): void {
  sessionActive = false;
  updatePending = false;
  interacted = false;
  listeners.clear();
  reloader = null;
}

let reloader: (() => void) | null = null;

/** The shell calls this with the service worker's update function. */
export function setUpdateReloader(fn: () => void): void {
  reloader = fn;
}

/** Activate the waiting update and reload. Falls back to a plain reload. */
export function reloadForUpdate(): void {
  if (reloader !== null) {
    reloader();
    return;
  }
  window.location.reload();
}
