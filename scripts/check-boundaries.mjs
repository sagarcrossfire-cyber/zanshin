// Spec §6.2 boundary check: only src/data/repos touches Dexie/IndexedDB;
// screens never import fetch/Dexie. (ESLint rule covers most; this is a repo-wide grep guard.)
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const violations = [];
function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const s = statSync(p);
    if (s.isDirectory()) {
      if (['node_modules', 'dist', 'dist-standalone', 'coverage'].includes(entry)) continue;
      walk(p);
    } else if (/\.(ts|tsx)$/.test(p)) {
      const text = readFileSync(p, 'utf8');
      const rel = p.replace(ROOT, '');
      if (/src\/(screens|components)\//.test(rel) && /from ['"]dexie['"]|indexedDB\.open|fetch\(/.test(text)) {
        violations.push(`${rel}: direct Dexie/fetch in screen/component`);
      }
      if (/src\/domain\//.test(rel) && /from ['"]dexie['"]|indexedDB/.test(text)) {
        violations.push(`${rel}: domain code touches IndexedDB`);
      }
    }
  }
}
walk(join(ROOT, 'src'));
if (violations.length > 0) {
  console.error('BOUNDARY VIOLATIONS:');
  for (const v of violations) console.error(' ', v);
  process.exit(1);
}
console.log('check-boundaries: OK');
