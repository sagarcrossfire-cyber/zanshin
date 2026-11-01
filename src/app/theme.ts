// Theme handling — spec §4.3/§5.17: data-theme on <html>; default follows
// the system, falling back to dark. Release 1.4.0 adds the dark colour
// scheme (data-scheme: manji | crimson | heat); light is Washi Daylight.
// Both choices persist in localStorage (and in Settings for backups).
export type ThemeChoice = 'system' | 'dark' | 'light';
export type SchemeChoice = 'manji' | 'crimson' | 'heat';

export const THEME_STORAGE_KEY = 'zanshin-theme';
export const SCHEME_STORAGE_KEY = 'zanshin-scheme';
export const SCHEMES: Array<{ id: SchemeChoice; label: string; note: string }> = [
  { id: 'manji', label: 'Manji Night', note: 'blue-black lacquer, cyan and ember' },
  { id: 'crimson', label: 'Crimson Dojo', note: 'black lacquer, vermilion and gold' },
  { id: 'heat', label: 'Heat Surge', note: 'violet energy on midnight' },
];

export function resolveTheme(choice: ThemeChoice, prefersDark: boolean): 'dark' | 'light' {
  if (choice === 'dark' || choice === 'light') return choice;
  return prefersDark ? 'dark' : 'light';
}

export function isScheme(value: unknown): value is SchemeChoice {
  return value === 'manji' || value === 'crimson' || value === 'heat';
}

function prefersDarkScheme(): boolean {
  try {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  } catch {
    return false;
  }
}

export function readThemeChoice(): ThemeChoice {
  if (typeof window === 'undefined') return 'system';
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return stored === 'dark' || stored === 'light' || stored === 'system' ? stored : 'system';
  } catch {
    return 'system';
  }
}

export function readSchemeChoice(): SchemeChoice {
  if (typeof window === 'undefined') return 'manji';
  try {
    const stored = window.localStorage.getItem(SCHEME_STORAGE_KEY);
    return isScheme(stored) ? stored : 'manji';
  } catch {
    return 'manji';
  }
}

export function applyScheme(scheme: SchemeChoice): void {
  try {
    window.localStorage.setItem(SCHEME_STORAGE_KEY, scheme);
  } catch {
    // Storage unavailable: the scheme still applies for this session.
  }
  document.documentElement.dataset.scheme = scheme;
}

export function applyTheme(choice: ThemeChoice): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, choice);
  } catch {
    // Storage unavailable (private mode): theme still applies for this session.
  }
  document.documentElement.dataset.theme = resolveTheme(choice, prefersDarkScheme());
  if (document.documentElement.dataset.scheme === undefined) document.documentElement.dataset.scheme = readSchemeChoice();
}

/** Applies the stored theme and keeps it in sync with OS changes while 'system'. Returns a cleanup function. */
export function initTheme(): () => void {
  document.documentElement.dataset.scheme = readSchemeChoice();
  applyTheme(readThemeChoice());
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => undefined;
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  const onChange = () => {
    if (readThemeChoice() === 'system') applyTheme('system');
  };
  if (typeof media.addEventListener === 'function') media.addEventListener('change', onChange);
  else media.addListener(onChange);
  return () => {
    if (typeof media.removeEventListener === 'function') media.removeEventListener('change', onChange);
    else media.removeListener(onChange);
  };
}
