// 2.0 M3 (card m3-sync-pairing-ui) — Settings → Devices acceptance: pairing
// code shown once and hidden for good by Done, joining with that code syncs
// a match set from the paired device (real server logic via
// createSyncHandler + memorySyncStore, shared by both browser contexts so
// the protocol under test is the real one), the wrong-code message, unpair
// returning to the unpaired view while keeping data, the Ranked sync card's
// derived-key line once paired, axe cleanliness and 44 px targets.
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page, type Route } from '@playwright/test';
import { encodePairingCode, generatePairingSecret } from '../../src/domain/sync/crypto';
import { createSyncHandler, memorySyncStore } from '../../src/server/sync/handler';

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

/** Logs one minimal match set (default opponent "Kazuya") and lands on its detail page. */
async function logAMatchSet(page: Page) {
  await page.goto('/log');
  await page.getByRole('button', { name: 'Log a match set' }).click();
  await expect(page.getByLabel('Date and time')).toBeVisible();
  await page.getByRole('button', { name: 'Increase Games won' }).click();
  await page.getByRole('button', { name: 'Log match set' }).click();
  await expect(page).toHaveURL(/\/log\/[^/]+$/);
  await expect(page.getByText(/Result:/)).toBeVisible();
}

function newSyncHandle() {
  return createSyncHandler({ store: memorySyncStore(), log: () => {} });
}

/** Routes /api/sync/* on `page` through the REAL server handler: every
 * intercepted request is turned into a `Request` and fulfilled with the
 * handler's `Response`, so two contexts sharing one `handle` talk the real
 * wire protocol (per-writer cursors, onlyIfNew, retention) to each other. */
async function routeSyncTo(page: Page, handle: (request: Request) => Promise<Response>) {
  await page.route('**/api/sync/**', async (route: Route) => {
    const req = route.request();
    const url = new URL(req.url());
    const method = req.method();
    const init: RequestInit = { method, headers: req.headers() };
    if (method !== 'GET' && method !== 'HEAD') {
      const data = req.postData();
      if (data !== null) init.body = data;
    }
    const response = await handle(new Request(url.toString(), init));
    const text = await response.text();
    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => { headers[key] = value; });
    await route.fulfill({ status: response.status, headers, body: text });
  });
}

/** Clicks "Set up sync on this device", captures the one-time code, then Done. */
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

async function axeSerious(page: Page) {
  const results = await new AxeBuilder({ page: page as never }).analyze();
  return results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
}

test('set up shows a pairing code once; Done hides it for good', async ({ page }) => {
  await routeSyncTo(page, newSyncHandle());
  await completeOnboarding(page);
  await setUpSync(page);
  await expect(page.getByRole('button', { name: 'Unpair this device' })).toBeVisible();
  // Reloading re-derives status from the stored pairing; the code is never shown again.
  await page.reload();
  await expect(page.getByTestId('pairing-code')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Unpair this device' })).toBeVisible();
});

test('joining with that code syncs a match set from the paired device', async ({ page, browser }) => {
  const handle = newSyncHandle();
  await routeSyncTo(page, handle);
  await completeOnboarding(page);
  const code = await setUpSync(page);
  await logAMatchSet(page);

  // Push the outbox now (it may have already auto-synced via the 5 s debounce
  // trigger; either way, click Sync now and wait for no changes pending).
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Sync now' }).click();
  await expect(page.getByText(/changes? waiting/)).toHaveCount(0);

  const contextB = await browser.newContext();
  try {
    const pageB = await contextB.newPage();
    await routeSyncTo(pageB, handle);
    await completeOnboarding(pageB);
    await joinWithCode(pageB, code);
    await expect(pageB.getByRole('button', { name: 'Unpair this device' })).toBeVisible();

    await pageB.goto('/log');
    await expect(pageB.getByRole('heading', { name: 'Kazuya' })).toBeVisible({ timeout: 10_000 });
  } finally {
    await contextB.close();
  }
});

test('a wrong-but-well-formed code shows the mismatch message', async ({ page, browser }) => {
  const handle = newSyncHandle();
  await routeSyncTo(page, handle);
  await completeOnboarding(page);
  await setUpSync(page);

  const contextB = await browser.newContext();
  try {
    const pageB = await contextB.newPage();
    await routeSyncTo(pageB, handle);
    await completeOnboarding(pageB);
    const wrongCode = encodePairingCode(generatePairingSecret());
    await joinWithCode(pageB, wrongCode);
    await expect(pageB.getByText("That code doesn't match. Check it on your other device.")).toBeVisible();
    // Still on the join form (not reset to the two-button view) so retyping is one edit away.
    await expect(pageB.getByLabel('Pairing code')).toBeVisible();
    await expect(pageB.getByRole('button', { name: 'Join' })).toBeVisible();
  } finally {
    await contextB.close();
  }
});

test('joining before any device has set up sync shows the unpaired message', async ({ page }) => {
  await routeSyncTo(page, newSyncHandle());
  await completeOnboarding(page);
  const code = encodePairingCode(generatePairingSecret());
  await joinWithCode(page, code);
  await expect(page.getByText('No device has set up sync yet. Set it up on your other device first.')).toBeVisible();
});

test('unpair returns to the unpaired view and keeps data', async ({ page }) => {
  await routeSyncTo(page, newSyncHandle());
  await completeOnboarding(page);
  await logAMatchSet(page);
  await setUpSync(page);

  await page.getByRole('button', { name: 'Unpair this device' }).click();
  const sheet = page.getByRole('dialog', { name: 'Unpair this device' });
  await expect(sheet.getByText('This device stops syncing. Its data stays here.')).toBeVisible();
  await sheet.getByRole('button', { name: 'Unpair this device' }).click();

  await expect(page.getByRole('button', { name: 'Set up sync on this device' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Join with a code' })).toBeVisible();

  await page.goto('/log');
  await expect(page.getByRole('heading', { name: 'Kazuya' })).toBeVisible();
});

test('the Ranked sync card shows the derived device key once paired', async ({ page }) => {
  await routeSyncTo(page, newSyncHandle());
  await completeOnboarding(page);
  await page.goto('/settings');
  await expect(page.getByLabel('Device key', { exact: true })).toBeVisible();

  await setUpSync(page);
  await expect(page.getByText(/Device key comes from sync pairing \(ends …/)).toBeVisible();
  await expect(page.getByLabel('Device key', { exact: true })).toHaveCount(0);
});

test('Devices card buttons measure at least 44 px, unpaired and paired', async ({ page }) => {
  await routeSyncTo(page, newSyncHandle());
  await completeOnboarding(page);
  await page.goto('/settings');

  const checkButtons = async () => {
    const small = await page.evaluate(() => {
      const bad: string[] = [];
      for (const el of document.querySelectorAll('.z-card button')) {
        const rect = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        if (rect.width === 0 || style.visibility === 'hidden' || style.display === 'none') continue;
        if (rect.height < 44) bad.push(`${el.textContent?.trim() ?? el.getAttribute('aria-label')}: ${rect.height}`);
      }
      return bad;
    });
    expect(small, `buttons under 44px: ${small.join('; ')}`).toEqual([]);
  };
  await checkButtons();
  await setUpSync(page);
  await checkButtons();
});

for (const theme of ['dark', 'light'] as const) {
  test(`axe: /settings Devices card has no serious/critical violations, unpaired and paired (${theme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme });
    await routeSyncTo(page, newSyncHandle());
    await completeOnboarding(page);
    await page.goto('/settings');
    expect(await axeSerious(page)).toEqual([]);

    await page.getByRole('button', { name: 'Join with a code' }).click();
    expect(await axeSerious(page)).toEqual([]);
    await page.getByRole('button', { name: 'Cancel' }).click();

    await page.getByRole('button', { name: 'Set up sync on this device' }).click();
    await expect(page.getByTestId('pairing-code')).toBeVisible();
    expect(await axeSerious(page)).toEqual([]);

    await page.getByRole('button', { name: 'Done' }).click();
    await expect(page.getByRole('button', { name: 'Unpair this device' })).toBeVisible();
    expect(await axeSerious(page)).toEqual([]);
  });
}
