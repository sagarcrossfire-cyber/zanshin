// Release 1.4.1 gate: when the site sign-in has expired (the site answers
// 401), the app says so and "Sign in again" reloads past the service worker
// to the network, where the host's login lives. The version file is never
// precached, so the check always reaches the site.
import { expect, test, type Page } from '@playwright/test';

async function completeOnboarding(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Get started' }).click();
  for (let i = 0; i < 4; i += 1) await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: "Start today's plan" }).click();
  await expect(page).toHaveURL(/\/today$/);
}

const signedOut = (page: Page) =>
  page.route('**/version.json', (route) => route.fulfill({ body: '<html>Log in to view this site</html>', contentType: 'text/html', status: 401 }));

test.describe('without a service worker', () => {
  test.use({ serviceWorkers: 'block' });

  test('a signed-in site shows no banner; the version file names this build', async ({ page }) => {
    await completeOnboarding(page);
    const version = await page.evaluate(async () => (await fetch('/version.json', { cache: 'no-store' })).json());
    expect(version).toEqual({ format: 'zanshin-version', version: expect.stringMatching(/^\d+\.\d+\.\d+$/) });
    if (test.info().project.name === 'netlify-desktop') {
      // Served the way Netlify serves it: never cached by the browser.
      const response = await page.request.get('/version.json');
      expect(response.headers()['cache-control']).toBe('no-store');
    }
    await page.waitForTimeout(1500);
    await expect(page.getByRole('status', { name: 'Site sign-in' })).toHaveCount(0);
  });

  test('401: the banner explains, Later hides it, Sign in again reloads', async ({ page }) => {
    await signedOut(page);
    await completeOnboarding(page);
    const banner = page.getByRole('status', { name: 'Site sign-in' });
    await expect(banner).toBeVisible({ timeout: 10000 });
    await expect(banner).toContainText('Your sign-in to this site has expired');
    await expect(banner).toContainText('Your data stays on this device');
    await banner.getByRole('button', { name: 'Later' }).click();
    await expect(banner).toHaveCount(0);
    await page.reload();
    await expect(banner).toBeVisible({ timeout: 10000 });
    await page.evaluate(() => { (window as Window & { beforeSignIn?: boolean }).beforeSignIn = true; });
    await Promise.all([page.waitForEvent('load'), banner.getByRole('button', { name: 'Sign in again' }).click()]);
    expect(await page.evaluate(() => (window as Window & { beforeSignIn?: boolean }).beforeSignIn)).toBeUndefined();
  });
});

test('with the worker in control: version.json is not precached, and Sign in again reaches the network', async ({ page }) => {
  test.setTimeout(120_000);
  await completeOnboarding(page);
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.reload();
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, { timeout: 15000 });
  const precached = await page.evaluate(async () => {
    const urls: string[] = [];
    for (const name of await caches.keys()) {
      for (const request of await (await caches.open(name)).keys()) urls.push(request.url);
    }
    return urls;
  });
  expect(precached.some((url) => url.includes('index.html'))).toBe(true);
  expect(precached.filter((url) => url.includes('version.json'))).toEqual([]);

  // The sign-in expires: the worker still serves the saved app, the check sees 401.
  await signedOut(page);
  const first = page.waitForEvent('response', (response) => response.request().isNavigationRequest());
  await page.reload();
  expect((await first).fromServiceWorker()).toBe(true);
  const banner = page.getByRole('status', { name: 'Site sign-in' });
  await expect(banner).toBeVisible({ timeout: 15000 });

  // Sign in again: the reload is answered by the site, not the saved copy.
  const next = page.waitForEvent('response', (response) => response.request().isNavigationRequest());
  const loaded = page.waitForEvent('load');
  await banner.getByRole('button', { name: 'Sign in again' }).click();
  expect((await next).fromServiceWorker()).toBe(false);
  await loaded;
  expect(await page.evaluate(() => navigator.serviceWorker.controller)).toBeNull();
});
