/* Contrast — spec §4.3: every text token >= 4.5:1 on every surface in its theme;
 * every control border >= 3:1. Parses tokens.css directly; WCAG math implemented
 * locally, no deps. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function parseTheme(css: string, theme: 'dark' | 'light'): Record<string, string> {
  const re = new RegExp(`\\[data-theme="${theme}"\\][^{]*\\{([^}]*)\\}`, 's');
  const block = css.match(re)?.[1] ?? '';
  const out: Record<string, string> = {};
  for (const m of block.matchAll(/(--[\w-]+)\s*:\s*(#[0-9a-fA-F]{6})\b/g)) {
    if (m[1] && m[2]) out[m[1]] = m[2];
  }
  return out;
}

function luminance(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const lin = c.map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
  const [r = 0, g = 0, b = 0] = lin;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contrastRatio(a: string, b: string): number {
  const [hi = 0, lo = 0] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
function tok(tokens: Record<string, string>, name: string): string {
  const v = tokens[name];
  if (!v) throw new Error(`missing token ${name}`);
  return v;
}

const css = readFileSync(join(process.cwd(), 'src/styles/tokens.css'), 'utf8');
const TEXT_TOKENS = ['--text-1', '--text-2', '--text-3'];
const SURFACES = ['--bg', '--surface', '--raised', '--overlay'];

describe('tokens.css contrast (§4.3)', () => {
  for (const theme of ['dark', 'light'] as const) {
    const tokens = parseTheme(css, theme);
    it(`${theme}: all text tokens >= 4.5:1 on all surfaces`, () => {
      expect(Object.keys(tokens).length).toBeGreaterThan(10);
      for (const text of TEXT_TOKENS) {
        for (const surface of SURFACES) {
          const ratio = contrastRatio(tok(tokens, text), tok(tokens, surface));
          expect(ratio, `${theme} ${text} on ${surface}`).toBeGreaterThanOrEqual(4.5);
        }
      }
    });
    it(`${theme}: on-paper text on paper >= 4.5:1`, () => {
      expect(contrastRatio(tok(tokens, '--on-paper'), tok(tokens, '--paper'))).toBeGreaterThanOrEqual(4.5);
    });
    it(`${theme}: control border >= 3:1 on all surfaces`, () => {
      for (const surface of SURFACES) {
        const ratio = contrastRatio(tok(tokens, '--control-border'), tok(tokens, surface));
        expect(ratio, `${theme} --control-border on ${surface}`).toBeGreaterThanOrEqual(3.0);
      }
    });
  }
  it('both themes define the same token set', () => {
    const dark = Object.keys(parseTheme(css, 'dark')).sort();
    const light = Object.keys(parseTheme(css, 'light')).sort();
    const colorDark = dark.filter((k) => !k.startsWith('--space') && !k.startsWith('--radius') && !k.startsWith('--dur') && !k.startsWith('--ease') && !k.startsWith('--shadow') && !k.startsWith('--font') && k !== '--scrim');
    const colorLight = light.filter((k) => colorDark.includes(k));
    expect(colorLight).toEqual(colorDark);
  });
});
