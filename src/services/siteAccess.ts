// Release 1.4.1 — site sign-in watch.
//
// ZANSHIN is hosted as a private Netlify project: every request needs the
// visitor's Netlify sign-in. When that sign-in expires, the service worker
// keeps serving the saved copy of the app (so it still opens), but every
// update check is refused with 401 and the app silently stays on the last
// version it installed. That is how 1.4.0 never reached Sagar's browser.
//
// This module asks the site for /version.json (written at build time, never
// precached) at start-up, when the app comes back to the foreground, and
// when the device comes back online:
//   401 / 403      the sign-in expired: show "Sign in again".
//   a version      the sign-in is fine; if it differs from this build, a
//                  release is out, so the caller asks the worker to look.
//   anything else  (offline, 404 in dev, a server error) changes nothing.
// "Sign in again" unregisters the service worker and reloads, so the reload
// reaches the network, Netlify shows its login, and the fresh app installs a
// fresh worker. Nothing in IndexedDB is touched.
import { z } from 'zod';
import { recordError } from './errorReport';

export const VERSION_URL = '/version.json';
/** Foreground checks are at most this often; start-up and "online" always check. */
export const PROBE_MIN_INTERVAL_MS = 5 * 60 * 1000;

const versionFileSchema = z.object({ format: z.literal('zanshin-version'), version: z.string().min(1) });

export type ProbeResult =
  | { kind: 'ok'; version: string | null }
  | { kind: 'signed-out'; status: number }
  | { kind: 'unknown' };

export async function probeSite(fetchImpl: typeof fetch = fetch): Promise<ProbeResult> {
  let response: Response;
  try {
    response = await fetchImpl(VERSION_URL, {
      cache: 'no-store',
      credentials: 'same-origin',
      headers: { accept: 'application/json' },
    });
  } catch {
    return { kind: 'unknown' };
  }
  if (response.status === 401 || response.status === 403) return { kind: 'signed-out', status: response.status };
  if (!response.ok) return { kind: 'unknown' };
  try {
    const parsed = versionFileSchema.safeParse(await response.json());
    return { kind: 'ok', version: parsed.success ? parsed.data.version : null };
  } catch {
    // Answered, but not with the version file: the site let us in, which is
    // all the sign-in check needs to know.
    return { kind: 'ok', version: null };
  }
}

type Listener = () => void;
let signedOut = false;
let dismissed = false;
let lastProbeAt = Number.NEGATIVE_INFINITY;
const listeners = new Set<Listener>();

function notify(): void {
  for (const listener of listeners) listener();
}

function setSignedOut(value: boolean): void {
  if (signedOut === value) return;
  signedOut = value;
  if (!value) dismissed = false;
  notify();
}

/** True when the "Sign in again" banner should show. */
export function isSignInBannerVisible(): boolean {
  return signedOut && !dismissed;
}

export function subscribeSiteAccess(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** "Later": hide the banner until the app is opened again. */
export function dismissSignInBanner(): void {
  if (dismissed) return;
  dismissed = true;
  notify();
}

export interface SiteWatchOptions {
  appVersion: string;
  /** Called when the site serves a different version than this build. */
  onOtherVersion?: (version: string) => void;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

export async function checkSiteNow(options: SiteWatchOptions): Promise<ProbeResult> {
  lastProbeAt = (options.now ?? Date.now)();
  const result = await probeSite(options.fetchImpl ?? fetch);
  if (result.kind === 'signed-out') {
    setSignedOut(true);
  } else if (result.kind === 'ok') {
    setSignedOut(false);
    if (result.version !== null && result.version !== options.appVersion) options.onOtherVersion?.(result.version);
  }
  return result;
}

/** Check now, then on foreground (throttled) and on reconnect. Returns a stop function. */
export function startSiteAccessWatch(options: SiteWatchOptions): () => void {
  const now = options.now ?? Date.now;
  void checkSiteNow(options);
  const onVisible = (): void => {
    if (document.visibilityState === 'visible' && now() - lastProbeAt >= PROBE_MIN_INTERVAL_MS) void checkSiteNow(options);
  };
  const onOnline = (): void => {
    void checkSiteNow(options);
  };
  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('online', onOnline);
  return () => {
    document.removeEventListener('visibilitychange', onVisible);
    window.removeEventListener('online', onOnline);
  };
}

/** Drop the service worker so the reload reaches the network and Netlify's login. */
export async function signInAgain(): Promise<void> {
  try {
    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map((registration) => registration.unregister()));
    }
  } catch (error) {
    recordError('siteAccess.signInAgain', error);
  }
  window.location.reload();
}

/** Test/reset helper. */
export function resetSiteAccessForTests(): void {
  signedOut = false;
  dismissed = false;
  lastProbeAt = Number.NEGATIVE_INFINITY;
  listeners.clear();
}
