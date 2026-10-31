// Service worker update gate — spec §14.5 / §13.9 R8. A waiting update must
// never reload during an active Lab session: the "Update available, reload"
// toast waits until the session ends. This module is the single place that
// knows whether a session is active and whether an update is pending; the
// shell subscribes and shows the toast only when both conditions allow it.
type Listener = () => void;

let sessionActive = false;
let updatePending = false;
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

/** Test/reset helper: returns the gate to its initial state. */
export function resetUpdateGateForTests(): void {
  sessionActive = false;
  updatePending = false;
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
