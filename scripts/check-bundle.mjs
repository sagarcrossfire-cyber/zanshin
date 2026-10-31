// Spec §13.8 bundle budgets: shell JS <=200 kB gz, each ROUTE JS chunk
// <=80 kB (Progress with charts <=140 kB). CSS is reported, not budgeted
// as a route chunk. Uses gzip of dist assets. Fails verify when over budget.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const DIST = new URL('../dist', import.meta.url).pathname;
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
  const name = p.split('/assets/')[1];
  console.log(`  ${name}: ${(size / 1024).toFixed(1)} kB gz`);
  if (!p.endsWith('.js')) continue; // CSS/fonts are reported, not route-budgeted
  if (/index-.*\.js$/.test(name)) shell = size;
  const budget = /progress|charts/i.test(name) ? 140 * 1024 : 80 * 1024;
  if (!/index-.*\.js$/.test(name) && size > budget) failures.push(`${name} ${(size / 1024).toFixed(1)} kB gz > ${(budget / 1024).toFixed(0)} kB`);
}
console.log(`shell: ${(shell / 1024).toFixed(1)} kB gz (budget 200 kB)`);
if (shell > 200 * 1024) failures.push(`shell ${(shell / 1024).toFixed(1)} kB gz > 200 kB`);
// §13.8: the Yoshimitsu move pack itself must stay under 150 kB gzipped.
const packGz = gz(new URL('../src/data/packs/moves.yoshimitsu.json', import.meta.url).pathname);
console.log(`moves pack: ${(packGz / 1024).toFixed(1)} kB gz (budget 150 kB)`);
if (packGz > 150 * 1024) failures.push(`moves pack ${(packGz / 1024).toFixed(1)} kB gz > 150 kB`);
if (failures.length > 0) {
  console.error('BUNDLE BUDGET FAILURES:');
  for (const f of failures) console.error(' ', f);
  process.exit(1);
}
console.log('check-bundle: OK');
