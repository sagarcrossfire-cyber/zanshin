// Theme handling — spec §4.3/§5.17: data-theme on <html>; default follows
// the system, falling back to dark. Choice persists in localStorage.
export type ThemeChoice = 'system' | 'dark' | 'light';

export const THEME_STORAGE_KEY = 'zanshin-theme';

export function resolveTheme(choice: ThemeChoice, prefersDark: boolean): 'dark' | 'light' {
  if (choice === 'dark' || choice === 'light') return choice;
  return prefersDark ? 'dark' : 'light';
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
  const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
  return stored === 'dark' || stored === 'light' || stored === 'system' ? stored : 'system';
}

export function applyTheme(choice: ThemeChoice): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, choice);
  } catch {
    // Storage unavailable (private mode): theme still applies for this session.
  }
  document.documentElement.dataset.theme = resolveTheme(choice, prefersDarkScheme());
}

/** Applies the stored theme and keeps it in sync with OS changes while 'system'. Returns a cleanup function. */
export function initTheme(): () => void {
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
