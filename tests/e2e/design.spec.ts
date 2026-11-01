// Release 1.4.0 gate ("Ink and steel"): art is never cropped on any route,
// the frame-data key is on the move list and remembers being closed, the
// four colour schemes apply and persist, and axe stays clean in each.
// Media is served from page.route with grayscale stand-ins in Wavu's shapes:
// tall 3:4 and 9:16 portraits, square icons.
import AxeBuilder from '@axe-core/playwright';
import { createHash } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { grayPng } from './helpers/png';

test.use({ serviceWorkers: 'block' });

async function completeOnboarding(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Get started' }).click();
  for (let i = 0; i < 4; i += 1) await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: "Start today's plan" }).click();
  await expect(page).toHaveURL(/\/today$/);
}

const ITEMS = [
  { data: grayPng(96, 96), kind: 'character-icon', subjectKey: 'character:Kazuya' },
  { data: grayPng(96, 96), kind: 'character-icon', subjectKey: 'character:Jin' },
  { data: grayPng(300, 400), kind: 'character-portrait', subjectKey: 'character:Yoshimitsu' },
  { data: grayPng(225, 400), kind: 'character-portrait', subjectKey: 'character:Kazuya' },
].map((item) => {
  const sha256 = createHash('sha256').update(item.data).digest('hex');
  return { ...item, bytes: item.data.byteLength, file: `media/${item.kind}/${sha256.slice(0, 16)}.png`, mime: 'image/png', sha256 };
});

async function serveMedia(page: Page) {
  const manifest = { createdAt: '2026-10-31T09:00:00Z', format: 'zanshin-media-pack', items: ITEMS.map(({ data: _d, ...rest }) => rest), packId: 'sha256-design', version: 1 };
  await page.route('**/media/manifest.json', (route) => route.fulfill({ body: JSON.stringify(manifest), contentType: 'application/json', status: 200 }));
  for (const item of ITEMS) {
    await page.route(`**/${item.file}`, (route) => route.fulfill({ body: Buffer.from(item.data), contentType: item.mime, status: 200 }));
  }
}

/** Every <img> whose box cuts off part of its picture (object-fit cover in a
 * box of a different shape), except blurred ambient layers. */
async function croppedImages(page: Page): Promise<string[]> {
  return page.evaluate(() => [...document.querySelectorAll('img')]
    .filter((img) => img.complete && img.naturalWidth > 0 && !img.hasAttribute('data-ambient'))
    .map((img) => {
      const fit = getComputedStyle(img).objectFit;
      const box = img.getBoundingClientRect();
      if (fit !== 'cover' || box.width === 0 || box.height === 0) return null;
      const boxRatio = box.width / box.height;
      const picRatio = img.naturalWidth / img.naturalHeight;
      return Math.abs(boxRatio - picRatio) / picRatio > 0.08
        ? `${img.className || img.parentElement?.className} ${Math.round(box.width)}x${Math.round(box.height)} for ${img.naturalWidth}x${img.naturalHeight}`
        : null;
    })
    .filter((v): v is string => v !== null));
}

test('no art is cropped: the stage hero shows the whole figure, icons are square, scene art is contained', async ({ page }) => {
  await serveMedia(page);
  await completeOnboarding(page);
  const figure = page.locator('.z-hero img.z-hero__img--loaded');
  await expect(figure).toBeVisible({ timeout: 20000 });
  // The figure is contained, and its box sits wholly inside the stage (no
  // overflow trimming it at the edge), on phones and desktops alike.
  expect(await figure.evaluate((img: HTMLImageElement) => getComputedStyle(img).objectFit)).toBe('contain');
  for (const route of ['/today', '/matchups/Kazuya']) {
    await page.goto(route);
    await expect(page.locator('.z-hero img.z-hero__img--loaded')).toBeVisible({ timeout: 20000 });
    await page.waitForTimeout(500); // let the entrance finish
    const inside = await page.locator('.z-hero').evaluate((hero) => {
      const box = hero.getBoundingClientRect();
      const img = hero.querySelector('img.z-hero__img')!.getBoundingClientRect();
      return img.left >= box.left - 1 && img.right <= box.right + 1 && img.top >= box.top - 1 && img.bottom <= box.bottom + 1;
    });
    expect(inside, `hero figure inside its stage on ${route}`).toBe(true);
  }
  for (const route of ['/today', '/matchups', '/matchups/Kazuya', '/log', '/log/new', '/codex/moves', '/settings']) {
    await page.goto(route);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(400);
    expect(await croppedImages(page), `cropped art on ${route}`).toEqual([]);
  }
  // Scene art stands behind screens without a stage hero; with one, the hero shows the figure.
  await page.goto('/codex/moves');
  await expect(page.locator('[data-scene-art="Yoshimitsu"] img')).toBeVisible();
  await page.goto('/matchups/Kazuya');
  await expect(page.locator('.z-hero img.z-hero__img--loaded')).toBeVisible();
  await expect(page.locator('[data-scene-art]')).toHaveCount(0);
  const icon = page.locator('.z-art-icon').first();
  await page.goto('/matchups');
  await expect(icon).toBeVisible();
  const box = await icon.boundingBox();
  expect(box && Math.abs(box.width - box.height)).toBeLessThanOrEqual(1);
});

test('frame-data key: open on the move list, explains the columns, remembers being closed', async ({ page }) => {
  await completeOnboarding(page);
  await page.goto('/codex/moves');
  const legend = page.getByTestId('frame-legend');
  const toggle = page.getByRole('button', { name: 'How to read frame data' });
  // Open by default on wide screens, closed on phones (it is three screens tall there).
  const wide = (page.viewportSize()?.width ?? 0) >= 900;
  await expect(toggle).toHaveAttribute('aria-expanded', wide ? 'true' : 'false');
  if (!wide) await toggle.click();
  await expect(legend).toBeVisible();
  await expect(legend.getByRole('heading', { name: 'Reading an input' })).toBeVisible();
  await expect(legend.getByRole('heading', { name: /On block/ })).toBeVisible();
  await expect(legend.getByText('Launch punishable')).toBeVisible();
  await expect(legend.getByText('Opponent airborne')).toBeVisible();
  await toggle.click();
  await expect(legend).toHaveCount(0);
  await page.reload();
  await expect(page.getByText('319 of 319 moves')).toBeVisible();
  await expect(page.getByTestId('frame-legend')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'How to read frame data' })).toHaveAttribute('aria-expanded', 'false');
  // Names arrive decoded; values carry their labels on every row.
  await page.getByLabel('Search moves').fill('Enma');
  await expect(page.getByText("Enma's Flame")).toBeVisible();
  expect(await page.locator('.z-moves__list').innerText()).not.toMatch(/&(\u0023\d+|[a-z]+);/);
  // The detail page leads with four labelled numbers.
  await page.getByText("Enma's Flame").click();
  await expect(page.getByRole('region', { name: 'Frame data', exact: true })).toContainText('On block');
});

for (const [scheme, label] of [['manji', 'Manji Night'], ['crimson', 'Crimson Dojo'], ['heat', 'Heat Surge']] as const) {
  test(`scheme ${scheme}: applies from Settings, persists, and axe is clean`, async ({ page }) => {
    test.setTimeout(180_000);
    await completeOnboarding(page);
    await page.goto('/settings');
    await page.getByLabel('Theme').selectOption('dark');
    await page.getByRole('radio', { name: new RegExp(label) }).check();
    await expect(page.locator('html')).toHaveAttribute('data-scheme', scheme);
    await page.getByRole('button', { name: 'Save settings' }).click();
    await expect(page.getByText('Settings saved.')).toBeVisible();
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-scheme', scheme);
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    for (const route of ['/today', '/codex/moves', '/settings']) {
      await page.goto(route);
      await expect(page.locator('#main')).toBeVisible();
      const results = await new AxeBuilder({ page: page as never }).analyze();
      const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
      expect(serious, `${scheme} ${route}: ${JSON.stringify(serious.map((v) => [v.id, v.nodes.slice(0, 3).map((n) => n.target)]), null, 2)}`).toEqual([]);
    }
  });
}

test('Washi Daylight (light theme): axe is clean on the redesigned surfaces', async ({ page }) => {
  test.setTimeout(180_000);
  await completeOnboarding(page);
  await page.goto('/settings');
  await page.getByLabel('Theme').selectOption('light');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.getByRole('button', { name: 'Save settings' }).click();
  for (const route of ['/today', '/codex/moves', '/codex/moves/Yoshimitsu-1%2B4']) {
    await page.goto(route);
    await expect(page.locator('#main')).toBeVisible();
    const results = await new AxeBuilder({ page: page as never }).analyze();
    const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(serious, `light ${route}: ${JSON.stringify(serious.map((v) => [v.id, v.nodes.slice(0, 3).map((n) => n.target)]), null, 2)}`).toEqual([]);
  }
});
