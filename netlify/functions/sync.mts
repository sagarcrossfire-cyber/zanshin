// ZANSHIN sync (2.0 M3) — /api/sync/* is the encrypted per-device operation
// log described in docs/v2/research/infra.md §2. The server only ever stores
// ciphertext: ints, keys and routing live here; AES-GCM batches are opaque
// strings. Logic lives in src/server/sync so it is unit-tested; this file
// only wires the environment and Netlify Blobs.
import { getStore } from '@netlify/blobs';
import type { Config, Context } from '@netlify/functions';
import { createSyncHandler, type SyncStore } from '../../src/server/sync/handler';
import { scopedStoreName } from '../../src/server/storeName';

let warned = false;

function blobStore(deployContext: string | undefined): SyncStore | null {
  try {
    const store = getStore({ consistency: 'strong', name: scopedStoreName('sync', deployContext) });
    return {
      async get(key) {
        return await store.get(key, { type: 'text' });
      },
      async set(key, value, opts) {
        return await store.set(key, value, opts?.onlyIfNew ? { onlyIfNew: true } : {});
      },
      async list(prefix) {
        const { blobs } = await store.list({ prefix });
        return blobs.map((blob) => blob.key);
      },
      async delete(key) {
        await store.delete(key);
      },
    };
  } catch (error) {
    if (!warned) {
      warned = true;
      console.warn(`sync: Netlify Blobs unavailable (${error instanceof Error ? error.message : String(error)})`);
    }
    return null;
  }
}

export default async (request: Request, context: Context): Promise<Response> => {
  const handler = createSyncHandler({ store: blobStore(context?.deploy?.context) });
  try {
    return await handler(request);
  } catch (error) {
    return new Response(JSON.stringify({ ok: false, code: 'sync-store', error: error instanceof Error ? error.message : 'Unexpected error.' }), {
      headers: { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8' },
      status: 503,
    });
  }
};

export const config: Config = {
  path: '/api/sync/*',
  rateLimit: { action: 'rate_limit', aggregateBy: ['ip', 'domain'], windowLimit: 120, windowSize: 60 },
};
