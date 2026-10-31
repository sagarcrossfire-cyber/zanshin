// Safe Mode detection — spec §14.4. Opened with ?safe=1 or from Diagnostics.
// In Safe Mode the app loads the bundled seed packs, disables service worker
// updates, the importer, the AI coach and match import, shows user data
// read-only, keeps export available, and shows a Safe Mode banner. Leaving
// Safe Mode clears the switch.
const SAFE_MODE_KEY = 'zanshin:safe-mode';

export function isSafeMode(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get('safe') === '1') return true;
    return window.localStorage.getItem(SAFE_MODE_KEY) === '1';
  } catch {
    return false;
  }
}

export function setSafeMode(on: boolean): void {
  try {
    if (on) window.localStorage.setItem(SAFE_MODE_KEY, '1');
    else window.localStorage.removeItem(SAFE_MODE_KEY);
  } catch {
    // Storage unavailable: Safe Mode still applies for this page load via ?safe=1.
  }
}

export function safeModeSearch(on: boolean): string {
  return on ? '?safe=1' : '';
}
