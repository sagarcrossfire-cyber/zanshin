// 2.0: every kanji the app shows is in the bundled kanji subset, so the marks
// never fall back to a device font. Fix: python3 scripts/subset-kanji.py
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const CJK = /[぀-ヿ㐀-鿿豈-﫿]/g;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.(ts|tsx|css|json)$/.test(name)) out.push(path);
  }
  return out;
}

describe('kanji subset', () => {
  it('covers every kanji used in src/', () => {
    const subset = new Set(readFileSync('src/styles/fonts/kanji-subset.txt', 'utf8').trim());
    const used = new Set<string>();
    for (const file of walk('src')) for (const ch of readFileSync(file, 'utf8').match(CJK) ?? []) used.add(ch);
    const missing = [...used].filter((ch) => !subset.has(ch));
    expect(missing, `run: python3 scripts/subset-kanji.py (missing ${missing.join('')})`).toEqual([]);
    expect(used.size).toBeGreaterThan(0);
  });
});
