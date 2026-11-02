// ZANSHIN diag (2.0 M1) — the app's telemetry endpoint at /api/diag. The
// app posts one sanitized event per problem (src/services/errorReport.ts);
// this function writes it as one `ZT1 {…}` log line and keeps a copy in
// Netlify Blobs for history past the 24 h log window. The site's own sign-in
// gates who can call it; the rate limit bounds a runaway client. Logic lives
// in src/server/diag so it is unit-tested; this file only wires Blobs.
import { getStore } from '@netlify/blobs';
import type { Config, Context } from '@netlify/functions';
import { createDiagHandler, diagStoreName, type DiagStore } from '../../src/server/diag/handler';

let warned = false;

function blobStore(deployContext: string | undefined): DiagStore | null {
  try {
    const store = getStore({ consistency: 'strong', name: diagStoreName(deployContext) });
    return {
      async list(prefix) {
        const { blobs } = await store.list({ prefix });
        return blobs.map((blob) => blob.key);
      },
      async setIfNew(key, value) {
        const { modified } = await store.setJSON(key, value, { onlyIfNew: true });
        return modified;
      },
    };
  } catch (error) {
    if (!warned) {
      warned = true;
      console.warn(`diag: Netlify Blobs unavailable, events are logged only (${error instanceof Error ? error.message : String(error)})`);
    }
    return null;
  }
}

export default async (request: Request, context: Context): Promise<Response> => {
  const handler = createDiagHandler({ store: blobStore(context?.deploy?.context) });
  try {
    return await handler(request);
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Unexpected error.' }), {
      headers: { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8' },
      status: 500,
    });
  }
};

export const config: Config = {
  path: '/api/diag',
  rateLimit: { action: 'rate_limit', aggregateBy: ['ip', 'domain'], windowLimit: 60, windowSize: 60 },
};
