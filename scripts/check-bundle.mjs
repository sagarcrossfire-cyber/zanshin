// Spec §13.8 bundle budgets: shell JS <=200 kB gz, each ROUTE JS chunk
// <=80 kB (Progress with charts <=140 kB). CSS is reported, not budgeted
// as a route chunk. Uses gzip of dist assets. Fails verify when over budget.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

// fileURLToPath, never URL.pathname: on Windows it keeps a leading slash before the drive
// letter and path.join turns it into a drive-relative path (docs/ops/RCA_LOG.md 2026-11-03).
const DIST = fileURLToPath(new URL('../dist', import.meta.url));
const gz = (p) => gzipSync(readFileSync(p)).length;
let failures = [];
let shell = 0;
const chunks = [];
function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p);
    else if (p.endsWith('.js') || p.endsWith('.css')) chunks.push(p);
  }
}
walk(join(DIST, 'assets'));
for (const p of chunks) {
  const size = gz(p);
  const name = basename(p);
  console.log(`  ${name}: ${(size / 1024).toFixed(1)} kB gz`);
  if (!p.endsWith('.js')) continue; // CSS/fonts are reported, not route-budgeted
  if (/index-.*\.js$/.test(name)) shell = size;
  const budget = /progress|charts/i.test(name) ? 140 * 1024 : 80 * 1024;
  if (!/index-.*\.js$/.test(name) && size > budget) failures.push(`${name} ${(size / 1024).toFixed(1)} kB gz > ${(budget / 1024).toFixed(0)} kB`);
}
console.log(`shell: ${(shell / 1024).toFixed(1)} kB gz (budget 200 kB)`);
if (shell > 200 * 1024) failures.push(`shell ${(shell / 1024).toFixed(1)} kB gz > 200 kB`);
// §13.8: the Yoshimitsu move pack itself must stay under 150 kB gzipped.
const packGz = gz(fileURLToPath(new URL('../src/data/packs/moves.yoshimitsu.json', import.meta.url)));
console.log(`moves pack: ${(packGz / 1024).toFixed(1)} kB gz (budget 150 kB)`);
if (packGz > 150 * 1024) failures.push(`moves pack ${(packGz / 1024).toFixed(1)} kB gz > 150 kB`);
// 2.0 M6: the hall photos (public/art, every width and format) stay under 1.5 MB in all,
// and the precached 800 px set under 400 kB.
const ART = join(DIST, 'art');
let artAll = 0;
let artSmall = 0;
if (existsSync(ART)) {
  for (const entry of readdirSync(ART)) {
    const size = statSync(join(ART, entry)).size;
    artAll += size;
    if (/-800\./.test(entry)) artSmall += size;
  }
}
console.log(`hall art: ${(artAll / 1024).toFixed(0)} kB (budget 1536 kB), 800 px set ${(artSmall / 1024).toFixed(0)} kB (budget 400 kB)`);
if (artAll > 1536 * 1024) failures.push(`hall art ${(artAll / 1024).toFixed(0)} kB > 1536 kB`);
if (artSmall > 400 * 1024) failures.push(`hall art 800 px set ${(artSmall / 1024).toFixed(0)} kB > 400 kB`);
if (failures.length > 0) {
  console.error('BUNDLE BUDGET FAILURES:');
  for (const f of failures) console.error(' ', f);
  process.exit(1);
}
console.log('check-bundle: OK');
