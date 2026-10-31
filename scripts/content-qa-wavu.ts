// P12 content QA (§13.3): compare 30 seeded moves against live Wavu Cargo
// values with a fixed-seed RNG for reproducibility. Run with:
//   npx tsx scripts/content-qa-wavu.ts
// Reads the bundled pack, fetches the live rows for the sampled ids via the
// real importer fetcher, and reports field-level mismatches. Never writes.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { importMoves } from '../src/data/import/wavu';
import type { Move } from '../src/data/schemas';
import { mulberry32 } from '../src/domain/engine/prng';

const SAMPLE = 30;
const SEED = 20261030;

const pack = JSON.parse(
  readFileSync(new URL('../src/data/packs/moves.yoshimitsu.json', import.meta.url), 'utf8'),
) as Move[];

const rng = mulberry32(SEED);
const picked = new Set<number>();
while (picked.size < SAMPLE) picked.add(Math.floor(rng() * pack.length));
const sampled = [...picked].map((i) => pack[i] as Move);

const live = await importMoves(fetch, { limit: 500, delayMs: 1000, skipRevision: true });
const liveById = new Map(live.map((m) => [m.id, m]));

const FIELDS: (keyof Move)[] = ['input', 'hitLevel', 'damage', 'startup', 'block', 'hit', 'counterHit', 'recovery', 'total'];
let mismatches = 0;
let missing = 0;
for (const move of sampled) {
  const row = liveById.get(move.id);
  if (row === undefined) {
    missing += 1;
    console.log(`MISSING live: ${move.id}`);
    continue;
  }
  for (const field of FIELDS) {
    const a = String(move[field] ?? '');
    const b = String(row[field] ?? '');
    if (a !== b) {
      mismatches += 1;
      console.log(`DIFF ${move.id} ${field}: pack=${JSON.stringify(a)} live=${JSON.stringify(b)}`);
    }
  }
}
const digest = createHash('sha256').update(sampled.map((m) => m.id).join(',')).digest('hex').slice(0, 12);
console.log(`\nSampled ${sampled.length} moves (seed ${SEED}, digest ${digest}); live rows ${live.length}; missing ${missing}; field mismatches ${mismatches}.`);
