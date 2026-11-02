// ZANSHIN intel — a Netlify Function that holds the Perplexity key and answers
// the app's intelligence requests (coach, research, matchup primers, patch
// briefs). The site's own sign-in gates who can call it; the daily spending
// cap (INTEL_DAILY_CAP_USD, default 3) bounds what any day can cost. Logic
// lives in src/server/intel so it is unit-tested; this file only wires the
// environment and Netlify Blobs. Each request logs one `ZT1` breadcrumb
// (src/server/intel/handler.ts); the provider may take up to 45 s, inside
// Netlify's 60 s synchronous limit.
import { getStore } from '@netlify/blobs';
import type { Context } from '@netlify/functions';
import { INTEL_PROVIDER_TIMEOUT_MS, createIntelHandler } from '../../src/server/intel/handler';
import { memoryStore, type IntelStore } from '../../src/server/intel/store';

/** Blobs when the environment provides them; otherwise a per-instance memory
 * store, so a site where Blobs is off still answers (the cap then only counts
 * one warm instance's spend, and caches do not survive a cold start). */
let fallback: ReturnType<typeof memoryStore> | undefined;
let warned = false;

function blobStore(): { store: IntelStore; durable: boolean } {
  try {
    const store = getStore({ consistency: 'strong', name: 'intel' });
    return {
      durable: true,
      store: {
        async get(key) {
          return (await store.get(key, { type: 'json' })) as unknown | null;
        },
        async list(prefix) {
          const { blobs } = await store.list({ prefix });
          return blobs.map((blob) => blob.key);
        },
        async set(key, value) {
          await store.setJSON(key, value);
        },
        async setIfNew(key, value) {
          const { modified } = await store.setJSON(key, value, { onlyIfNew: true });
          return modified;
        },
      },
    };
  } catch (error) {
    if (!warned) {
      warned = true;
      console.warn(`intel: Netlify Blobs unavailable, using a memory store (${error instanceof Error ? error.message : String(error)})`);
    }
    fallback ??= memoryStore();
    return { durable: false, store: fallback };
  }
}

export default async (request: Request, _context: Context): Promise<Response> => {
  const capRaw = Number(process.env['INTEL_DAILY_CAP_USD'] ?? '3');
  const { store, durable } = blobStore();
  const handler = createIntelHandler({
    apiKey: process.env['PERPLEXITY_API_KEY']?.trim() || undefined,
    capUsd: Number.isFinite(capRaw) && capRaw >= 0 ? capRaw : 3,
    durableStore: durable,
    store,
    timeoutMs: INTEL_PROVIDER_TIMEOUT_MS,
  });
  try {
    return await handler(request);
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Unexpected error.' }), {
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      status: 500,
    });
  }
};
