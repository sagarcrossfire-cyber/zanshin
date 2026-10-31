// Spec §13.7: no color values outside tokens.css (CSS side; the ESLint rule covers TS/TSX).
// Scans all .css files except tokens.css for hex/rgb/hsl literals.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const COLOR_RE = /(#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\))/g;
let violations = [];
function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const s = statSync(p);
    if (s.isDirectory()) {
      if (['node_modules', 'dist', 'dist-standalone', 'coverage'].includes(entry)) continue;
      walk(p);
    } else if (p.endsWith('.css') && !p.endsWith('tokens.css')) {
      const text = readFileSync(p, 'utf8');
      for (const m of text.matchAll(COLOR_RE)) violations.push(`${p}:${m[0]}`);
    }
  }
}
walk(join(ROOT, 'src'));
if (violations.length > 0) {
  console.error('COLOR LITERALS OUTSIDE tokens.css:');
  for (const v of violations) console.error(' ', v);
  process.exit(1);
}
console.log('check-no-colors: OK (no color literals outside tokens.css)');
