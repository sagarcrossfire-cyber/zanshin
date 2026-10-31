// §9.1/§9.2 — Importer tests against saved Cargo/TekkenDocs fixtures (tests/fixtures/wavu/).
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { seedProvenance } from '../../../src/data/schemas';
import {
  buildCargoUrl, extractCargoRows, ImportError, importMoves, resolveFullInput,
} from '../../../src/data/import/wavu';
import { importMoves as importTekkenDocsMoves } from '../../../src/data/import/tekkendocs';
import type { FetchLike } from '../../../src/data/import/wavu';

function fixture(name: string): string {
  // Vitest serves transformed modules with a root-relative import.meta.url, so
  // resolve from the project root first and fall back to the file's own URL.
  const fromRoot = resolve(process.cwd(), 'tests/fixtures/wavu', name);
  const path = existsSync(fromRoot)
    ? fromRoot
    : fileURLToPath(new URL(`../../fixtures/wavu/${name}`, import.meta.url));
  return readFileSync(path, 'utf8');
}

const page1 = fixture('cargo-page-1.json');
const page2 = fixture('cargo-page-2.json');
const revisions = fixture('cargo-revisions.json');

function wavuFetcher(requests: { url: string; headers?: Record<string, string> }[]): FetchLike {
  return async (url, init) => {
    requests.push({ url, headers: init?.headers });
    if (url.includes('prop=revisions')) {
      return { ok: true, status: 200, text: async () => revisions };
    }
    const offset = new URL(url).searchParams.get('offset');
    return { ok: true, status: 200, text: async () => (offset === '2' ? page2 : page1) };
  };
}

describe('Wavu Cargo query shape', () => {
  it('prefixes fields with Move. and single-quotes the LIKE literal', () => {
    const url = buildCargoUrl('Yoshimitsu', 200, 0);
    expect(url).toContain('fields=Move.id');
    // URLSearchParams encodes the where value; parse it back to compare the literal.
    expect(new URL(url).searchParams.get('where')).toBe("Move.id LIKE 'Yoshimitsu-%'");
    expect(url).toContain('origin=*');
  });

  it('extracts rows from the cargoquery.title shape', () => {
    const rows = extractCargoRows(JSON.parse(page1) as unknown);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.['Move.id']).toBe('Yoshimitsu-b+2');
  });

  it('extracts rows from the live shape: cargoquery array, title-wrapped, unprefixed keys, nulls', () => {
    const live = fixture('cargo-live-shape.json');
    const rows = extractCargoRows(JSON.parse(live) as unknown);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.['Move.id']).toBe('Yoshimitsu-1');
    expect(rows[0]?.['Move.num']).toBeNull();
    expect(rows[1]?.['Move.parent']).toBe('Yoshimitsu-1');
  });

  it('returns [] for an empty cargoquery array (end of paging), not an error', () => {
    expect(extractCargoRows({ cargoquery: [] })).toEqual([]);
  });

  it('imports the live shape end to end, cleaning HTML aliases and entity-escaped notes', async () => {
    const live = fixture('cargo-live-shape.json');
    const fetcher: FetchLike = async (url) => {
      const offset = new URL(url).searchParams.get('offset');
      if (url.includes('prop=revisions')) return { ok: true, status: 200, text: async () => revisions };
      return { ok: true, status: 200, text: async () => (offset === '2' ? '{"cargoquery":[]}' : live) };
    };
    const moves = await importMoves(fetcher, { limit: 2, delayMs: 0 });
    expect(moves).toHaveLength(2);
    const child = moves.find((m) => m.id === 'Yoshimitsu-1,1');
    expect(child?.input).toBe('1,1');
    expect(child?.aliases).toEqual(['1SS.1,1', '1,1SS.1']);
    expect(child?.notes).toContain('Floor Break');
    expect(child?.notes).not.toContain('<div');
    expect(child?.notes).not.toContain('&lt;');
  });
});

describe('importMoves (Wavu)', () => {
  it('pages until a short page, reconstructs parent-chain inputs, and records revision provenance', async () => {
    const requests: { url: string; headers?: Record<string, string> }[] = [];
    const moves = await importMoves(wavuFetcher(requests), { limit: 2, delayMs: 0 });
    expect(moves).toHaveLength(3);
    expect(requests.some((r) => r.url.includes('prop=revisions'))).toBe(true);
    expect(requests[0]?.headers?.['User-Agent']).toBe('ZANSHIN-importer/1.0 (personal training app)');

    const child = moves.find((m) => m.id === 'Yoshimitsu-b+2,1');
    // Yoshimitsu-b+2,1 -> 'b+2,1': the extension ',1' is joined onto the parent input 'b+2'.
    expect(child?.input).toBe('b+2,1');
    // A string's speed is its root move's startup; extension fields keep the leading comma.
    expect(child?.startupFrame).toBe(14);
    expect(child?.hitLevel).toBe(',M');
    expect(child?.damage).toBe(',20');
    expect(child?.blockMin).toBe(-17);
    // Wikitext is stripped from notes.
    expect(child?.notes).toBe('Launching follow-up; see Flash and bold');

    const flash = moves.find((m) => m.id === 'Yoshimitsu-1+4');
    expect(flash?.aliases).toEqual(['Flash']);
    expect(flash?.provenance).toMatchObject({
      source: 'wavu',
      patch: '3.02.02',
      status: 'sourced',
      sourceRev: '987654',
      sourceUrl: 'https://wavu.wiki/t/Yoshimitsu_movelist',
    });
  });

  it('throws a typed ImportError on HTTP failure', async () => {
    const failing: FetchLike = async () => ({ ok: false, status: 503, text: async () => '' });
    await expect(importMoves(failing, { delayMs: 0 })).rejects.toBeInstanceOf(ImportError);
  });
});

describe('parent-chain input reconstruction', () => {
  it('rebuilds Yoshimitsu-b+1,1,1,1,1,1 from a three-level chain', () => {
    const rows = [
      { 'Move.id': 'Yoshimitsu-b+1', 'Move.input': 'b+1' },
      { 'Move.id': 'Yoshimitsu-b+1,1', 'Move.input': ',1', 'Move.parent': 'Yoshimitsu-b+1' },
      { 'Move.id': 'Yoshimitsu-b+1,1,1,1,1,1', 'Move.input': ',1,1,1,1', 'Move.parent': 'Yoshimitsu-b+1,1' },
    ];
    const byId = new Map(rows.map((r) => [r['Move.id'] as string, r]));
    expect(resolveFullInput(rows[2] as never, byId)).toBe('b+1,1,1,1,1,1');
  });

  it('throws on a parent cycle', () => {
    const rows = [
      { 'Move.id': 'Yoshimitsu-a', 'Move.input': ',1', 'Move.parent': 'Yoshimitsu-b' },
      { 'Move.id': 'Yoshimitsu-b', 'Move.input': ',1', 'Move.parent': 'Yoshimitsu-a' },
    ];
    const byId = new Map(rows.map((r) => [r['Move.id'] as string, r]));
    expect(() => resolveFullInput(rows[0] as never, byId)).toThrow(ImportError);
  });
});

describe('importMoves (TekkenDocs fallback)', () => {
  it('returns the same Move shape with tekkendocs provenance', async () => {
    const body = fixture('tekkendocs-yoshimitsu.json');
    const fetcher: FetchLike = async (url) => {
      expect(url).toBe('https://tekkendocs.com/api/t8/yoshimitsu/framedata');
      return { ok: true, status: 200, text: async () => body };
    };
    const moves = await importTekkenDocsMoves(fetcher);
    expect(moves).toHaveLength(1);
    expect(moves[0]).toMatchObject({
      id: 'Yoshimitsu-1+4',
      input: '1+4',
      startupFrame: 6,
      blockMin: -20,
      provenance: { ...seedProvenance, source: 'tekkendocs', status: 'sourced' },
    });
    expect(moves[0]?.tags).toContain('panic');
  });
});
