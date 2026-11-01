// Release 1.4.1 — the site sign-in watch: a 401 on /version.json shows
// "Sign in again", a different version asks the worker to update, and
// offline or odd answers change nothing.
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  PROBE_MIN_INTERVAL_MS, VERSION_URL, checkSiteNow, dismissSignInBanner, isSignInBannerVisible, probeSite,
  resetSiteAccessForTests, signInAgain, startSiteAccessWatch, subscribeSiteAccess,
} from '../../../src/services/siteAccess';

const versionBody = (version: string) => JSON.stringify({ format: 'zanshin-version', version });
const answer = (status: number, body = '', type = 'application/json') =>
  vi.fn(async () => new Response(status === 204 ? null : body, { headers: { 'content-type': type }, status }));
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => {
  resetSiteAccessForTests();
  vi.restoreAllMocks();
});

describe('probeSite', () => {
  it('asks /version.json without the HTTP cache, with the sign-in cookie', async () => {
    const fetchImpl = answer(200, versionBody('1.4.1'));
    expect(await probeSite(fetchImpl as never)).toEqual({ kind: 'ok', version: '1.4.1' });
    expect(fetchImpl).toHaveBeenCalledWith(VERSION_URL, expect.objectContaining({ cache: 'no-store', credentials: 'same-origin' }));
  });

  it('reads 401 and 403 as an expired sign-in', async () => {
    expect(await probeSite(answer(401, '<html>Log in</html>', 'text/html') as never)).toEqual({ kind: 'signed-out', status: 401 });
    expect(await probeSite(answer(403) as never)).toEqual({ kind: 'signed-out', status: 403 });
  });

  it('treats offline, server errors and 404 as unknown, and a non-version 200 as signed in', async () => {
    expect(await probeSite(vi.fn(async () => { throw new TypeError('Failed to fetch'); }) as never)).toEqual({ kind: 'unknown' });
    expect(await probeSite(answer(500) as never)).toEqual({ kind: 'unknown' });
    expect(await probeSite(answer(404) as never)).toEqual({ kind: 'unknown' });
    expect(await probeSite(answer(200, '<!doctype html>', 'text/html') as never)).toEqual({ kind: 'ok', version: null });
    expect(await probeSite(answer(200, JSON.stringify({ version: 7 })) as never)).toEqual({ kind: 'ok', version: null });
  });
});

describe('the banner and the update nudge', () => {
  it('shows on 401, hides with Later, and clears once the site answers again', async () => {
    const changes = vi.fn();
    subscribeSiteAccess(changes);
    await checkSiteNow({ appVersion: '1.4.1', fetchImpl: answer(401) as never });
    expect(isSignInBannerVisible()).toBe(true);
    dismissSignInBanner();
    expect(isSignInBannerVisible()).toBe(false);
    await checkSiteNow({ appVersion: '1.4.1', fetchImpl: answer(200, versionBody('1.4.1')) as never });
    expect(isSignInBannerVisible()).toBe(false);
    // A later expiry shows it again even after an earlier "Later".
    await checkSiteNow({ appVersion: '1.4.1', fetchImpl: answer(401) as never });
    expect(isSignInBannerVisible()).toBe(true);
    expect(changes).toHaveBeenCalled();
  });

  it('offline leaves the banner as it was', async () => {
    await checkSiteNow({ appVersion: '1.4.1', fetchImpl: answer(401) as never });
    await checkSiteNow({ appVersion: '1.4.1', fetchImpl: vi.fn(async () => { throw new TypeError('offline'); }) as never });
    expect(isSignInBannerVisible()).toBe(true);
  });

  it('asks for an update only when the site serves another version', async () => {
    const onOtherVersion = vi.fn();
    await checkSiteNow({ appVersion: '1.4.1', fetchImpl: answer(200, versionBody('1.4.1')) as never, onOtherVersion });
    expect(onOtherVersion).not.toHaveBeenCalled();
    await checkSiteNow({ appVersion: '1.4.1', fetchImpl: answer(200, versionBody('1.5.0')) as never, onOtherVersion });
    expect(onOtherVersion).toHaveBeenCalledWith('1.5.0');
  });
});

describe('startSiteAccessWatch', () => {
  it('checks at start, on foreground at most every five minutes, and on reconnect', async () => {
    let clock = 1_000_000;
    const fetchImpl = answer(200, versionBody('1.4.1'));
    const stop = startSiteAccessWatch({ appVersion: '1.4.1', fetchImpl: fetchImpl as never, now: () => clock });
    await flush();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    document.dispatchEvent(new Event('visibilitychange'));
    await flush();
    expect(fetchImpl).toHaveBeenCalledTimes(1); // too soon
    clock += PROBE_MIN_INTERVAL_MS;
    document.dispatchEvent(new Event('visibilitychange'));
    await flush();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    window.dispatchEvent(new Event('online'));
    await flush();
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    stop();
    window.dispatchEvent(new Event('online'));
    await flush();
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });
});

describe('signInAgain', () => {
  it('unregisters every service worker, then reloads', async () => {
    const order: string[] = [];
    const unregister = vi.fn(async () => { order.push('unregister'); return true; });
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: { getRegistrations: async () => [{ unregister }, { unregister }] },
    });
    const reload = vi.fn(() => { order.push('reload'); });
    const original = window.location;
    Object.defineProperty(window, 'location', { configurable: true, value: { ...original, reload } });
    try {
      await signInAgain();
      expect(unregister).toHaveBeenCalledTimes(2);
      expect(order).toEqual(['unregister', 'unregister', 'reload']);
    } finally {
      Object.defineProperty(window, 'location', { configurable: true, value: original });
      delete (navigator as { serviceWorker?: unknown }).serviceWorker;
    }
  });

  it('still reloads when the worker cannot be reached', async () => {
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: { getRegistrations: async () => { throw new Error('denied'); } },
    });
    const reload = vi.fn();
    const original = window.location;
    Object.defineProperty(window, 'location', { configurable: true, value: { ...original, reload } });
    try {
      await signInAgain();
      expect(reload).toHaveBeenCalledTimes(1);
    } finally {
      Object.defineProperty(window, 'location', { configurable: true, value: original });
      delete (navigator as { serviceWorker?: unknown }).serviceWorker;
    }
  });
});
