import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyTheme, initTheme, readThemeChoice, resolveTheme } from '../../src/app/theme';

function mockMatchMedia(prefersDark: boolean) {
  const listeners = new Set<() => void>();
  const media = {
    addEventListener: vi.fn((_e: string, fn: () => void) => listeners.add(fn)),
    addListener: vi.fn((fn: () => void) => listeners.add(fn)),
    matches: prefersDark,
    removeEventListener: vi.fn(),
    removeListener: vi.fn(),
  };
  vi.stubGlobal('matchMedia', vi.fn(() => media));
  return { media, fire: () => listeners.forEach((fn) => fn()) };
}

describe('theme', () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.dataset.theme = 'dark';
  });
  afterEach(() => vi.unstubAllGlobals());

  it('resolves system to the OS scheme, dark/light explicitly', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
    expect(resolveTheme('light', true)).toBe('light');
  });

  it('defaults to system when nothing is stored; explicit choices apply verbatim', () => {
    expect(readThemeChoice()).toBe('system');
    applyTheme('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    applyTheme('light');
    expect(document.documentElement.dataset.theme).toBe('light');
    // The no-matchMedia fallback (dark) in prefersDarkScheme is defensive
    // code for ancient browsers; jsdom always provides matchMedia, so it
    // is not unit-testable here.
  });

  it('applies the stored choice and follows OS changes while system', () => {
    const { media, fire } = mockMatchMedia(true);
    const cleanup = initTheme();
    expect(document.documentElement.dataset.theme).toBe('dark');
    media.matches = false;
    fire();
    expect(document.documentElement.dataset.theme).toBe('light');
    cleanup();
    window.localStorage.setItem('zanshin-theme', 'dark');
    initTheme();
    expect(document.documentElement.dataset.theme).toBe('dark');
  });
});
