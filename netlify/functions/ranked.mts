// ZANSHIN ranked (2.0 M2) — /api/ranked reads Sagar's ranked games from Wavu
// Wank (player page + a few replay windows for in-game ranks), falls back to
// ewgf.gg when EWGF_API_KEY is set, and caches each player for 10 minutes in
// Netlify Blobs. Locked to paired devices (ZANSHIN_DEVICE_KEY_SHA256,
// src/server/deviceKey.ts). Logic lives in src/server/ranked so it is
// unit-tested; this file only wires the environment and Blobs.
import { getStore } from '@netlify/blobs';
import type { Config, Context } from '@netlify/functions';
import { loadRankPack } from '../../src/data/packs/ranks';
import { DEVICE_KEY_ENV, type DeviceKeyHashStore } from '../../src/server/deviceKey';
import { createRankedHandler, type RankedStore } from '../../src/server/ranked/handler';
import { scopedStoreName } from '../../src/server/storeName';

let warned = false;
let syncWarned = false;

function blobStore(deployContext: string | undefined): RankedStore | null {
  try {
    const store = getStore({ consistency: 'strong', name: scopedStoreName('ranked', deployContext) });
    return {
      async get(key) {
        return (await store.get(key, { type: 'json' })) as unknown | null;
      },
      async set(key, value) {
        await store.setJSON(key, value);
      },
    };
  } catch (error) {
    if (!warned) {
      warned = true;
      console.warn(`ranked: Netlify Blobs unavailable, no cache (${error instanceof Error ? error.message : String(error)})`);
    }
    return null;
  }
}

/** Read-only view of the sync store's `v1/devicekeyhash` (SSO Option B,
 * src/server/deviceKey.ts allowedDeviceKeyHashes), scoped exactly like
 * netlify/functions/sync.mts so a preview never reads production's hash. */
function syncStore(deployContext: string | undefined): DeviceKeyHashStore | null {
  try {
    const store = getStore({ consistency: 'strong', name: scopedStoreName('sync', deployContext) });
    return { async get(key) { return await store.get(key, { type: 'text' }); } };
  } catch (error) {
    if (!syncWarned) {
      syncWarned = true;
      console.warn(`ranked: Netlify Blobs unavailable for the sync store, env hashes only (${error instanceof Error ? error.message : String(error)})`);
    }
    return null;
  }
}

export default async (request: Request, context: Context): Promise<Response> => {
  const handler = createRankedHandler({
    deviceKeySha256: process.env[DEVICE_KEY_ENV],
    ewgfApiKey: process.env['EWGF_API_KEY']?.trim() || undefined,
    pack: loadRankPack(),
    store: blobStore(context?.deploy?.context),
    syncStore: syncStore(context?.deploy?.context),
  });
  try {
    return await handler(request);
  } catch (error) {
    return new Response(JSON.stringify({ ok: false, code: 'upstream', error: error instanceof Error ? error.message : 'Unexpected error.' }), {
      headers: { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8' },
      status: 500,
    });
  }
};

export const config: Config = {
  path: '/api/ranked',
  // Each call can reach Wank up to four times; a runaway client is stopped early.
  rateLimit: { action: 'rate_limit', aggregateBy: ['ip', 'domain'], windowLimit: 10, windowSize: 60 },
};
