// 2.0 M3 regression guard — acceptance criteria not yet covered by sync-pairing.spec.ts:
//
//  r1  every /api/sync request body matches a protocol shape and carries no plaintext secrets
//  r2  X-Zanshin-Sync header is the HKDF-derived auth key, never the raw pairing code shown in UI
//  r3  a 401 (Netlify sign-in wall) from /api/sync shows signed-out state in Settings and keeps
//      the outbox intact (pending count unchanged)
//  r4  B's pre-join records reach A — the B→A direction (sync-pairing.spec.ts tests A→B only)
//  r5  per-device multi-write reading: A writes, B reads, A writes again, B reads → both present
//      (regression guard for the per-writer cursor protocol)
//  r6  B's own aiApiKey survives A's settings winning via LWW sync — applyRemoteChanges must
//      restore this device's device-local settings fields after a remote win
//  r7  axe: /settings (paired view) zero serious/critical violations — tablet coverage gap
//      (sync-pairing.spec.ts runs on phone+desktop only; this file runs on all three projects)
//
// Runs on phone, tablet AND desktop: playwright.config.ts includes **/*regressions.spec.ts
// in the tablet project's testMatch list.
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page, type Route } from '@playwright/test';
import { createSyncHandler, memorySyncStore } from '../../src/server/sync/handler';

// ──────────────────────────────────────────────────────────────────────────────
// Shared helpers (standalone — no import from other spec files)
// ──────────────────────────────────────────────────────────────────────────────

async function completeOnboarding(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Get started' }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: "Start today's plan" }).click();
  await expect(page).toHaveURL(/\/today$/);
}

/** Routes /api/sync/* through the REAL server handler AND captures request metadata. */
interface CapturedRequests {
  bodies: string[];       // POST/PUT request body strings
  authHeaders: string[];  // x-zanshin-sync header values
}

function newSyncHandle() {
  return createSyncHandler({ store: memorySyncStore(), log: () => {} });
}

async function routeSyncCapturing(
  page: Page,
  handle: (request: Request) => Promise<Response>,
): Promise<CapturedRequests> {
  const captured: CapturedRequests = { bodies: [], authHeaders: [] };
  await page.route('**/api/sync/**', async (route: Route) => {
    const req = route.request();
    const method = req.method();
    const hdrs = req.headers();

    const authValue = hdrs['x-zanshin-sync'];
    if (authValue !== undefined && authValue.length > 0) captured.authHeaders.push(authValue);

    const data = (method !== 'GET' && method !== 'HEAD') ? req.postData() : null;
    if (data !== null && data.length > 0) captured.bodies.push(data);

    const url = new URL(req.url());
    const init: RequestInit = { method, headers: hdrs };
    if (data !== null) init.body = data;
    const response = await handle(new Request(url.toString(), init));
    const text = await response.text();
    const outHeaders: Record<string, string> = {};
    response.headers.forEach((v, k) => { outHeaders[k] = v; });
    await route.fulfill({ status: response.status, headers: outHeaders, body: text });
  });
  return captured;
}

async function routeSyncTo(page: Page, handle: (request: Request) => Promise<Response>) {
  await page.route('**/api/sync/**', async (route: Route) => {
    const req = route.request();
    const method = req.method();
    const init: RequestInit = { method, headers: req.headers() };
    const data = (method !== 'GET' && method !== 'HEAD') ? req.postData() : null;
    if (data !== null) init.body = data;
    const url = new URL(req.url());
    const response = await handle(new Request(url.toString(), init));
    const text = await response.text();
    const headers: Record<string, string> = {};
    response.headers.forEach((v, k) => { headers[k] = v; });
    await route.fulfill({ status: response.status, headers, body: text });
  });
}

/** Clicks "Set up sync on this device", captures the one-time pairing code, then Done. */
async function setUpSync(page: Page): Promise<string> {
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Set up sync on this device' }).click();
  await expect(page.getByTestId('pairing-code')).toBeVisible();
  const code = (await page.getByTestId('pairing-code').textContent())?.trim() ?? '';
  expect(code.length).toBeGreaterThan(10);
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByTestId('pairing-code')).toHaveCount(0);
  return code;
}

async function joinWithCode(page: Page, code: string) {
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Join with a code' }).click();
  await page.getByLabel('Pairing code').fill(code);
  await page.getByRole('button', { name: 'Join' }).click();
}

async function syncNowAndWait(page: Page) {
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Sync now' }).click();
  await expect(page.getByText(/changes? waiting/)).toHaveCount(0, { timeout: 15_000 });
}

/** Logs a match set and returns the page to /log. Defaults to Kazuya opponent. */
async function logAMatchSet(page: Page) {
  await page.goto('/log');
  await page.getByRole('button', { name: 'Log a match set' }).click();
  await expect(page.getByLabel('Date and time')).toBeVisible();
  await page.getByRole('button', { name: 'Increase Games won' }).click();
  await page.getByRole('button', { name: 'Log match set' }).click();
  await expect(page).toHaveURL(/\/log\/[^/]+$/);
  await expect(page.getByText(/Result:/)).toBeVisible();
}

// ──────────────────────────────────────────────────────────────────────────────
// r1: every /api/sync request body matches the four protocol shapes, no secrets
// ──────────────────────────────────────────────────────────────────────────────

/** True iff `body` is one of the four allowed /api/sync protocol shapes:
 *   1. `v1.<base64url>.<base64url>` — PUT log (encrypted op batch)
 *   2. `{"verifier":"<64-hex>"}` — POST init
 *   3. `{"cursor":{…},"data":"v1.…"}` — PUT snap
 *   4. `{"deviceId":"…","through":{…}}` — POST ack
 */
function isAllowedSyncBody(body: string): boolean {
  // Shape 1: v1.<iv>.<ciphertext>
  if (/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_+=/-]+$/.test(body)) return true;

  let parsed: unknown;
  try { parsed = JSON.parse(body); } catch { return false; }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return false;
  const obj = parsed as Record<string, unknown>;

  // Shape 2: {verifier: 64-hex} (no other keys)
  if (
    Object.keys(obj).length === 1
    && typeof obj['verifier'] === 'string'
    && /^[0-9a-f]{64}$/.test(obj['verifier'] as string)
  ) return true;

  // Shape 3: {cursor:{…}, data:"v1.…"} (snap)
  if (
    'cursor' in obj && typeof obj['cursor'] === 'object' && !Array.isArray(obj['cursor'])
    && 'data' in obj && typeof obj['data'] === 'string'
    && (obj['data'] as string).startsWith('v1.')
  ) return true;

  // Shape 4: {deviceId:"…", through:{…}} (ack)
  if (
    'deviceId' in obj && typeof obj['deviceId'] === 'string'
    && 'through' in obj && typeof obj['through'] === 'object' && !Array.isArray(obj['through'])
  ) return true;

  return false;
}

/** True iff the JSON body contains any key matching the secret-field pattern. */
function jsonBodyHasSecretField(body: string): boolean {
  let parsed: unknown;
  try { parsed = JSON.parse(body); } catch { return false; }
  if (typeof parsed !== 'object' || parsed === null) return false;
  return Object.keys(parsed as Record<string, unknown>).some((k) => /(Key|Token|Secret)$/i.test(k));
}

test('M3 r1: all /api/sync request bodies match the four protocol shapes and contain no plaintext secrets', async ({
  page, browser,
}) => {
  test.setTimeout(150_000);
  const handle = newSyncHandle();
  const capA = await routeSyncCapturing(page, handle);
  await completeOnboarding(page);
  const code = await setUpSync(page);
  await logAMatchSet(page);
  await syncNowAndWait(page);

  const ctxB = await browser.newContext();
  try {
    const pageB = await ctxB.newPage();
    const capB = await routeSyncCapturing(pageB, handle);
    await completeOnboarding(pageB);
    await joinWithCode(pageB, code);
    await expect(pageB.getByRole('button', { name: 'Unpair this device' })).toBeVisible({ timeout: 10_000 });
    await syncNowAndWait(pageB);

    // A second sync on device A pulls B's newly-pushed entries.
    await syncNowAndWait(page);

    const allBodies = [...capA.bodies, ...capB.bodies];
    expect(allBodies.length, 'expected at least one intercepted body').toBeGreaterThan(0);

    for (const body of allBodies) {
      expect(
        isAllowedSyncBody(body),
        `body does not match any allowed protocol shape:\n${body.slice(0, 300)}`,
      ).toBe(true);

      expect(
        jsonBodyHasSecretField(body),
        `body contains a *Key/*Token/*Secret field in plaintext:\n${body.slice(0, 300)}`,
      ).toBe(false);
    }
  } finally {
    await ctxB.close();
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// r2: X-Zanshin-Sync header is NEVER the raw pairing code shown in the UI
// ──────────────────────────────────────────────────────────────────────────────

test('M3 r2: X-Zanshin-Sync header is the derived auth key, not the raw pairing code', async ({
  page, browser,
}) => {
  test.setTimeout(150_000);
  const handle = newSyncHandle();
  const capA = await routeSyncCapturing(page, handle);
  await completeOnboarding(page);
  const code = await setUpSync(page);
  await syncNowAndWait(page);

  const ctxB = await browser.newContext();
  try {
    const pageB = await ctxB.newPage();
    const capB = await routeSyncCapturing(pageB, handle);
    await completeOnboarding(pageB);
    await joinWithCode(pageB, code);
    await expect(pageB.getByRole('button', { name: 'Unpair this device' })).toBeVisible({ timeout: 10_000 });
    await syncNowAndWait(pageB);

    const allAuthHeaders = [...capA.authHeaders, ...capB.authHeaders];
    // At least some authenticated requests must have been sent.
    expect(allAuthHeaders.length, 'expected at least one authenticated request').toBeGreaterThan(0);

    // The raw pairing code (the text from the UI) must never appear as the header value.
    // The code is a dash-separated alphanumeric string; the header is the HKDF-derived authKey.
    const rawCodeNormalized = code.replace(/[^A-Za-z0-9]/g, '').toLowerCase();
    for (const headerValue of allAuthHeaders) {
      const normalizedHeader = headerValue.replace(/[^A-Za-z0-9]/g, '').toLowerCase();
      expect(
        normalizedHeader,
        'X-Zanshin-Sync header must not equal the raw pairing code',
      ).not.toBe(rawCodeNormalized);

      // The code is a base56-like string with groups; the auth key is a hex/base64 string.
      // The header value must NOT contain the pairing code verbatim (case-insensitive).
      expect(
        headerValue.toLowerCase().includes(code.toLowerCase()),
        'X-Zanshin-Sync header must not contain the raw pairing code verbatim',
      ).toBe(false);
    }
  } finally {
    await ctxB.close();
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// r3: a 401 (Netlify sign-in wall) sets the signed-out state and keeps the outbox
// ──────────────────────────────────────────────────────────────────────────────

test('M3 r3: a 401 from /api/sync sets signed-out state in Settings and keeps the outbox', async ({
  page,
}) => {
  test.setTimeout(120_000);
  // Pair successfully so the device has sync credentials, then clear initial outbox.
  const handle = newSyncHandle();
  await routeSyncTo(page, handle);
  await completeOnboarding(page);
  await setUpSync(page);
  await syncNowAndWait(page);

  // Override the log route to 401 BEFORE logging so any subsequent auto-sync also hits it.
  await page.unroute('**/api/sync/**');
  // Add the general handler FIRST (lower priority, checked second).
  await page.route('**/api/sync/**', async (route: Route) => {
    const req = route.request();
    const method = req.method();
    const init: RequestInit = { method, headers: req.headers() };
    const data = (method !== 'GET' && method !== 'HEAD') ? req.postData() : null;
    if (data !== null) init.body = data;
    const response = await handle(new Request(new URL(req.url()).toString(), init));
    const text = await response.text();
    const headers: Record<string, string> = {};
    response.headers.forEach((v, k) => { headers[k] = v; });
    await route.fulfill({ status: response.status, headers, body: text });
  });
  // Add the log-specific 401 handler SECOND (higher priority = checked first).
  await page.route('**/api/sync/log/**', (route: Route) =>
    route.fulfill({
      status: 401,
      contentType: 'text/html; charset=utf-8',
      body: '<html><body>Sign in to continue</body></html>',
    }),
  );

  // Log a match set — adds an outbox entry; any immediate auto-sync hits the 401 above.
  await logAMatchSet(page);

  await page.goto('/settings');
  // Explicit Sync now to guarantee the signed-out result shows in the UI.
  await page.getByRole('button', { name: 'Sync now' }).click();
  await expect(page.getByText('Signed out — sign in again to sync.')).toBeVisible({ timeout: 20_000 });

  // Outbox must still be intact — signed-out does not drop pending changes.
  await expect(page.getByText(/changes? waiting/)).toBeVisible();
});

// ──────────────────────────────────────────────────────────────────────────────
// r4: B's pre-join records reach A  (B→A direction)
// sync-pairing.spec.ts only tests A→B; this is the complementary direction.
// ──────────────────────────────────────────────────────────────────────────────

test("M3 r4: B logs a match set BEFORE joining → after join + sync, A has B's match set", async ({
  page, browser,
}) => {
  test.setTimeout(150_000);
  const handle = newSyncHandle();
  await routeSyncTo(page, handle);
  await completeOnboarding(page);
  const code = await setUpSync(page);
  // A syncs once so its initial outbox is clear; any Kazuya record A sees later came from B.
  await syncNowAndWait(page);

  const ctxB = await browser.newContext();
  try {
    const pageB = await ctxB.newPage();
    await routeSyncTo(pageB, handle);
    await completeOnboarding(pageB);

    // B logs a match set BEFORE joining — this is the pre-join record we're testing.
    await logAMatchSet(pageB);

    // Now B joins: captureExisting runs during pairJoin and queues the pre-join set.
    await joinWithCode(pageB, code);
    await expect(pageB.getByRole('button', { name: 'Unpair this device' })).toBeVisible({ timeout: 10_000 });

    // B syncs (pushes its captured pre-join set to the server).
    await syncNowAndWait(pageB);

    // A syncs (pulls B's set).
    await page.goto('/settings');
    await page.getByRole('button', { name: 'Sync now' }).click();
    await expect(page.getByText(/changes? waiting/)).toHaveCount(0, { timeout: 15_000 });

    // A's /log should now contain the match set B logged before pairing.
    await page.goto('/log');
    await expect(page.getByRole('heading', { name: 'Kazuya' })).toBeVisible({ timeout: 10_000 });
  } finally {
    await ctxB.close();
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// r5: per-device multi-write reading — regression guard for per-writer cursors
// The bug (pre PR-52): once B's per-writer cursor advanced into B's key range, a
// subsequent A write (which sorts before B's keys) was silently skipped forever.
// ──────────────────────────────────────────────────────────────────────────────

test("M3 r5: A writes, B reads; A writes again, B reads again → B has both of A's match sets", async ({
  page, browser,
}) => {
  test.setTimeout(180_000);
  const handle = newSyncHandle();
  await routeSyncTo(page, handle);
  await completeOnboarding(page);
  const code = await setUpSync(page);

  const ctxB = await browser.newContext();
  try {
    const pageB = await ctxB.newPage();
    await routeSyncTo(pageB, handle);
    await completeOnboarding(pageB);
    await joinWithCode(pageB, code);
    await expect(pageB.getByRole('button', { name: 'Unpair this device' })).toBeVisible({ timeout: 15_000 });
    await syncNowAndWait(pageB); // clear B's initial onboarding outbox

    // ── Round 1: A writes its first match set; B reads it ──────────────────
    await logAMatchSet(page);
    await syncNowAndWait(page);
    await syncNowAndWait(pageB);

    await pageB.goto('/log');
    await expect(pageB.getByRole('heading', { name: 'Kazuya' })).toBeVisible({ timeout: 15_000 });
    const countAfterRound1 = await pageB.getByRole('heading', { name: 'Kazuya' }).count();
    expect(countAfterRound1).toBeGreaterThanOrEqual(1);

    // ── Round 2: A writes a second match set; B reads again ────────────────
    await logAMatchSet(page);
    await syncNowAndWait(page);
    await syncNowAndWait(pageB);

    await pageB.goto('/log');
    // B must have BOTH of A's match sets — heading count must increase.
    await expect(pageB.getByRole('heading', { name: 'Kazuya' })).toHaveCount(
      countAfterRound1 + 1,
      { timeout: 15_000 },
    );
  } finally {
    await ctxB.close();
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// r6: B's own aiApiKey survives A's settings winning via LWW sync
// The receive-side merge in applyRemoteChanges (syncCapture.ts) must restore
// this device's device-local settings fields after the LWW put.
// ──────────────────────────────────────────────────────────────────────────────

test("M3 r6: B's aiApiKey is not overwritten when A's later settings win via LWW sync", async ({
  page, browser,
}) => {
  test.setTimeout(150_000);
  const handle = newSyncHandle();
  await routeSyncTo(page, handle);
  await completeOnboarding(page);
  const code = await setUpSync(page);

  const ctxB = await browser.newContext();
  try {
    const pageB = await ctxB.newPage();
    await routeSyncTo(pageB, handle);
    await completeOnboarding(pageB);

    // B sets its own AI API key before joining (HLC = H_B, assigned by settingsRepo.put).
    const B_API_KEY = 'sk-b-device-only-key-must-survive';
    await pageB.goto('/settings');
    await pageB.getByLabel('API key').fill(B_API_KEY);
    await pageB.getByRole('button', { name: /save/i }).first().click();

    // B joins and syncs; aiApiKey is stripped from the outbox by design.
    await joinWithCode(pageB, code);
    await expect(pageB.getByRole('button', { name: 'Unpair this device' })).toBeVisible({ timeout: 15_000 });
    await syncNowAndWait(pageB);

    // A saves settings NOW (HLC = H_A > H_B since this is sequential and later in wall time).
    // When B pulls these, A's settings win via LWW for all non-device-local fields.
    await page.goto('/settings');
    await page.getByRole('button', { name: 'Save settings' }).click();
    await expect(page.getByText('Settings saved.')).toBeVisible({ timeout: 15_000 });
    await syncNowAndWait(page);  // A pushes newer settings.

    // B pulls A's newer settings; applyRemoteChanges must preserve B's aiApiKey.
    await pageB.goto('/settings');
    await pageB.getByRole('button', { name: 'Sync now' }).click();
    await expect(pageB.getByText(/changes? waiting/)).toHaveCount(0, { timeout: 20_000 });

    const bApiKeyAfterSync = await pageB.evaluate(async () =>
      new Promise<string | undefined>((resolve, reject) => {
        const req = indexedDB.open('zanshin');
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction('settings', 'readonly');
          const getReq = tx.objectStore('settings').get('settings');
          getReq.onerror = () => reject(getReq.error);
          getReq.onsuccess = () => {
            db.close();
            resolve((getReq.result as Record<string, unknown> | undefined)?.['aiApiKey'] as string | undefined);
          };
        };
      }),
    );
    expect(bApiKeyAfterSync, "B's aiApiKey was overwritten by A's settings sync").toBe(B_API_KEY);
  } finally {
    await ctxB.close();
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// r7: axe /settings (paired view) — runs on tablet too via *regressions.spec.ts
// sync-pairing.spec.ts covers phone+desktop; this fills the tablet gap.
// ──────────────────────────────────────────────────────────────────────────────

for (const theme of ['dark', 'light'] as const) {
  test(`M3 r7: axe /settings (paired) has no serious/critical violations (${theme})`, async ({ page }) => {
    test.setTimeout(90_000);
    await page.emulateMedia({ colorScheme: theme });
    await routeSyncTo(page, newSyncHandle());
    await completeOnboarding(page);
    await setUpSync(page);
    await page.goto('/settings');
    await expect(page.getByRole('button', { name: 'Unpair this device' })).toBeVisible();

    const results = await new AxeBuilder({ page: page as never }).analyze();
    const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(serious, JSON.stringify(serious, null, 2)).toEqual([]);
  });
}
