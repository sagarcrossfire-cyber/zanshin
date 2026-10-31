// §9.1/§9.2 — CLI that runs the importer and writes pack JSON. Never overwrites the
// bundled seed packs without --write; by default it writes to /tmp/zanshin-import/.
//
// Usage:
//   tsx scripts/import-wavu.ts [--character Yoshimitsu] [--source wavu|tekkendocs]
//     [--fallback] [--write] [--out <dir>]
//   --write writes moves.<character>.json into src/data/packs/ (seed pack overwrite).
//   Without --write, output goes to --out, default /tmp/zanshin-import/.
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { importMoves as importWavuMoves, type FetchLike } from '../src/data/import/wavu';
import { importMoves as importTekkenDocsMoves } from '../src/data/import/tekkendocs';
import { moveSchema } from '../src/data/schemas';

interface CliOptions {
  character: string;
  source: 'wavu' | 'tekkendocs';
  fallback: boolean;
  write: boolean;
  out: string;
  patch?: string;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    character: 'Yoshimitsu',
    source: 'wavu',
    fallback: false,
    write: false,
    out: '/tmp/zanshin-import',
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] as string;
    if (arg === '--help' || arg === '-h') {
      console.log('Usage: tsx scripts/import-wavu.ts [--character Yoshimitsu] [--source wavu|tekkendocs] [--fallback] [--write] [--out <dir>] [--patch <label>]');
      process.exit(0);
    } else if (arg === '--character') options.character = argv[i + 1] as string;
    else if (arg === '--source') {
      const source = argv[i + 1] as string;
      if (source !== 'wavu' && source !== 'tekkendocs') throw new Error(`Unknown --source ${source}`);
      options.source = source;
    } else if (arg === '--fallback') options.fallback = true;
    else if (arg === '--write') options.write = true;
    else if (arg === '--out') options.out = argv[i + 1] as string;
    else if (arg === '--patch') options.patch = argv[i + 1] as string;
    else if (arg.startsWith('--character=')) options.character = arg.slice('--character='.length);
    else if (arg.startsWith('--out=')) options.out = arg.slice('--out='.length);
    else if (arg.startsWith('--patch=')) options.patch = arg.slice('--patch='.length);
    else throw new Error(`Unknown argument ${arg}`);
  }
  return options;
}

/** Adapts the platform fetch to the importer's FetchLike surface. */
const nodeFetch: FetchLike = async (url, init) => {
  const response = await fetch(url, { headers: init?.headers });
  return { ok: response.ok, status: response.status, text: async () => response.text() };
};

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const importOptions = { character: options.character, patch: options.patch };

  let moves;
  try {
    moves = options.source === 'wavu'
      ? await importWavuMoves(nodeFetch, importOptions)
      : await importTekkenDocsMoves(nodeFetch, { character: options.character.toLowerCase(), patch: options.patch });
  } catch (error) {
    if (options.fallback && options.source === 'wavu') {
      console.error(`Wavu import failed (${error instanceof Error ? error.message : String(error)}); falling back to TekkenDocs.`);
      moves = await importTekkenDocsMoves(nodeFetch, { character: options.character.toLowerCase(), patch: options.patch });
    } else {
      throw error;
    }
  }
  // The importers already schema-validate every row; re-validate the array as a whole.
  const validated = moveSchema.array().parse(moves);

  const fileName = `moves.${options.character.toLowerCase()}.json`;
  const outDir = options.write
    ? resolve(process.cwd(), 'src/data/packs')
    : resolve(options.out);
  await mkdir(outDir, { recursive: true });
  const outPath = join(outDir, fileName);
  await writeFile(outPath, JSON.stringify(validated, null, 2), 'utf8');

  console.log(
    `imported ${validated.length} moves for ${options.character} ` +
    `(source: ${moves[0]?.provenance.source ?? options.source}, patch: ${moves[0]?.provenance.patch ?? options.patch ?? 'unknown'}) -> ${outPath}`,
  );
}

main().catch((error: unknown) => {
  console.error(`import-wavu failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
