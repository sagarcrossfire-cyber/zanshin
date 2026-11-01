// Amendment 01B — the local media library end to end: import a media pack
// through Settings → Images and clips, see icons, the portrait hero, a move
// clip and a rank badge across the app, keep layout stable while art loads,
// and turn art off again. The pack is built here from original placeholder
// images (grayscale gradients) and stand-in clip bytes, so the test ships no
// game art. Bundled Chromium cannot decode H.264, so clips are checked by
// element and source, not by playback (unit tests cover the controls).
import AxeBuilder from '@axe-core/playwright';
import { createHash } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { zipSync, type Zippable } from 'fflate';
import { grayPng } from './helpers/png';

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

// ---- The media pack ---------------------------------------------------------
interface PackItem { file: string; kind: string; subjectKey: string; mime: string; data: Uint8Array; sha?: string; width?: number; height?: number }

function buildPack(items: PackItem[]): Buffer {
  const files: Zippable = {};
  const manifestItems = items.map((item) => {
    files[item.file] = [item.data, { level: 0 }];
    return {
      bytes: item.data.byteLength,
      credit: 'Test placeholder',
      file: item.file,
      kind: item.kind,
      mime: item.mime,
      sha256: item.sha ?? createHash('sha256').update(item.data).digest('hex'),
      subjectKey: item.subjectKey,
      ...(item.width ? { height: item.height, width: item.width } : {}),
    };
  });
  const manifest = { createdAt: '2026-10-30T10:00:00.000Z', format: 'zanshin-media-pack', items: manifestItems, version: 1 };
  return Buffer.from(zipSync({ 'manifest.json': new Uint8Array(Buffer.from(JSON.stringify(manifest))), ...files }));
}

const FAKE_CLIP = Uint8Array.from({ length: 4096 }, (_, i) => (i * 13) % 256);

const PACK = buildPack([
  { data: grayPng(72, 88), file: 'icons/KazuyaT8.png', height: 88, kind: 'character-icon', mime: 'image/png', subjectKey: 'character:Kazuya', width: 72 },
  { data: grayPng(72, 88), file: 'icons/YoshimitsuT8.png', height: 88, kind: 'character-icon', mime: 'image/png', subjectKey: 'character:Yoshimitsu', width: 72 },
  { data: grayPng(800, 1000), file: 'portraits/Yoshimitsu_portrait.png', kind: 'character-portrait', mime: 'image/png', subjectKey: 'character:Yoshimitsu' },
  { data: FAKE_CLIP, file: 'clips/t8-p2-yoshimitsu-1+4.mp4', kind: 'move-clip', mime: 'video/mp4', subjectKey: 'move:Yoshimitsu-1+4' },
  { data: grayPng(48, 48), file: 'ranks/tekken-king.png', kind: 'rank-badge', mime: 'image/png', subjectKey: 'rank:Tekken King' },
  { data: grayPng(72, 88), file: 'icons/LiliT8.png', kind: 'character-icon', mime: 'image/png', sha: '0'.repeat(64), subjectKey: 'character:Lili' },
]);

async function importPack(page: Page) {
  await page.goto('/settings/media');
  await expect(page.getByTestId('media-summary')).toHaveText('No media imported yet.');
  await page.getByTestId('media-pack-input').setInputFiles({ buffer: PACK, mimeType: 'application/zip', name: 'zanshin-media-core.zip' });
  const report = page.getByTestId('media-import-report');
  await expect(report).toContainText('Imported 5 of 6 items.');
  await expect(report).toContainText('1 skipped');
  await expect(report).toContainText('icons/LiliT8.png: SHA-256 does not match the manifest');
  await expect(page.getByTestId('media-summary')).toContainText('5 items');
}

/** Layout shifts attributed to media only: the observer starts once the
 * screen's own content is on the page, and only shifts whose sources sit
 * inside a media box count. Screens load cards asynchronously, and that
 * (pre-existing) movement is not what this spec guards. */
async function startMediaShiftWatch(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __mediaShift: number };
    w.__mediaShift = 0;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as unknown as Array<{ value: number; hadRecentInput: boolean; sources?: Array<{ node: Node | null }> }>) {
        if (entry.hadRecentInput) continue;
        const fromMedia = (entry.sources ?? []).some((source) =>
          source.node instanceof Element && source.node.closest('[data-media], .z-art-icon, .z-hero, .z-clip, .z-art-image') !== null);
        if (fromMedia) w.__mediaShift += entry.value;
      }
    }).observe({ buffered: false, type: 'layout-shift' });
  });
}

async function mediaShift(page: Page): Promise<number> {
  return page.evaluate(() => (window as unknown as { __mediaShift: number }).__mediaShift);
}

test('media pack: import, art across the app, stable layout, art off', async ({ page }, testInfo) => {
  await completeOnboarding(page);
  await importPack(page);

  const axeMedia = await new AxeBuilder({ page: page as never }).analyze();
  const seriousMedia = axeMedia.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(seriousMedia, JSON.stringify(seriousMedia, null, 2)).toEqual([]);
  await page.screenshot({ fullPage: true, path: `qa/screenshots/01B/media-settings-${testInfo.project.name}.png` });

  // The portrait got downscaled copies in the browser (320 and 640 wide).
  const stored = page.locator('details', { hasText: 'Character portraits' });
  await stored.locator('summary').click();
  await expect(stored).toContainText('Yoshimitsu');

  // Today: the hero with the date on a plate. The box is reserved before the
  // bytes arrive, so the image loading must not move anything.
  await page.goto('/today');
  const hero = page.locator('.z-hero');
  await expect(hero).toBeVisible();
  await startMediaShiftWatch(page);
  const heroBefore = await hero.boundingBox();
  await expect(hero.locator('img.z-hero__img--loaded')).toBeVisible();
  await expect(hero.locator('img.z-hero__img')).toHaveAttribute('src', /^blob:/);
  await expect(hero.locator('.z-hero__plate')).toBeVisible();
  await page.waitForTimeout(500);
  const heroAfter = await hero.boundingBox();
  expect(heroAfter?.height, 'hero height after the image loaded').toBe(heroBefore?.height);
  expect(heroAfter?.width, 'hero width after the image loaded').toBe(heroBefore?.width);
  expect(await mediaShift(page), 'Today layout shift from media').toBeLessThanOrEqual(0.05);
  const axeToday = await new AxeBuilder({ page: page as never }).analyze();
  expect(axeToday.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')).toEqual([]);
  await page.screenshot({ path: `qa/screenshots/01B/today-hero-${testInfo.project.name}.png` });

  // Matchups: imported icons, initials tiles for everyone else, same size.
  await page.goto('/matchups');
  const kazuyaCard = page.locator('.z-card').filter({ has: page.getByRole('heading', { exact: true, name: 'Kazuya' }) });
  await expect(kazuyaCard).toBeVisible();
  await startMediaShiftWatch(page);
  const tileBefore = await kazuyaCard.locator('.z-art-icon').boundingBox();
  await expect(kazuyaCard.locator('.z-art-icon img')).toHaveAttribute('src', /^blob:/);
  const liliCard = page.locator('.z-card').filter({ has: page.getByRole('heading', { exact: true, name: 'Lili' }) });
  await expect(liliCard.locator('.z-art-icon')).toHaveText('L');
  await page.waitForTimeout(300);
  const tileAfter = await kazuyaCard.locator('.z-art-icon').boundingBox();
  expect(tileAfter?.height, 'icon tile height').toBe(tileBefore?.height);
  expect(await mediaShift(page), 'Matchups layout shift from media').toBeLessThanOrEqual(0.05);
  await page.screenshot({ path: `qa/screenshots/01B/matchups-icons-${testInfo.project.name}.png` });

  // Codex move detail: the clip card with its controls.
  await page.goto('/codex/moves/Yoshimitsu-1%2B4');
  const clip = page.locator('figure.z-clip');
  await expect(clip).toBeVisible();
  await expect(clip.locator('video')).toHaveAttribute('src', /^blob:/);
  await expect(clip.getByRole('button', { name: '0.25×' })).toBeVisible();
  await clip.getByRole('button', { name: '0.5×' }).click();
  await expect(clip.getByRole('button', { name: '0.5×' })).toHaveAttribute('aria-pressed', 'true');
  await page.screenshot({ fullPage: true, path: `qa/screenshots/01B/move-clip-${testInfo.project.name}.png` });

  // Codex list: the clip badge on that move's row.
  await page.goto('/codex/moves');
  await expect(page.getByLabel('Has an imported clip').first()).toBeVisible();

  // Progress: the target rank badge.
  await page.goto('/progress');
  await expect(page.locator('.z-rank-line .z-art-image img')).toHaveAttribute('src', /^blob:/);

  // Diagnostics: the media card.
  await page.goto('/diagnostics');
  await expect(page.getByTestId('diagnostics-media')).toContainText('Move clips');

  // The library survives a reload, and the hero is reserved before bytes load.
  await page.goto('/today');
  await page.reload();
  await expect(page.locator('.z-hero img.z-hero__img')).toBeVisible();

  // Art off: the app goes back to its ink look everywhere.
  await page.goto('/settings/media');
  await page.getByLabel('Show imported art and clips').uncheck();
  await page.goto('/today');
  await expect(page.locator('.z-hero')).toHaveCount(0);
  await page.goto('/matchups');
  await expect(page.locator('.z-art-icon')).toHaveCount(0);
});

// ---- Bundled media (1.2.0): the site's own /media folder ----------------------
const SITE_ICON = grayPng(72, 88);
const SITE_PORTRAIT = grayPng(800, 1000);
const SITE_ITEMS = [
  { data: SITE_ICON, kind: 'character-icon', mime: 'image/png', subjectKey: 'character:Jin' },
  { data: SITE_PORTRAIT, kind: 'character-portrait', mime: 'image/png', subjectKey: 'character:Yoshimitsu' },
  { data: FAKE_CLIP, kind: 'move-clip', mime: 'video/mp4', subjectKey: 'move:Yoshimitsu-1+4' },
].map((item) => {
  const sha256 = createHash('sha256').update(item.data).digest('hex');
  return { ...item, bytes: item.data.byteLength, file: `media/${item.kind}/${sha256.slice(0, 16)}-test.bin`, sha256 };
});

async function serveBundledMedia(page: Page) {
  const manifest = {
    createdAt: '2026-10-31T09:00:00Z',
    format: 'zanshin-media-pack',
    items: SITE_ITEMS.map(({ data: _data, ...item }) => item),
    packId: 'sha256-e2e',
    version: 1,
  };
  await page.route('**/media/manifest.json', (route) => route.fulfill({ body: JSON.stringify(manifest), contentType: 'application/json', status: 200 }));
  for (const item of SITE_ITEMS) {
    await page.route(`**/${item.file}`, (route) => route.fulfill({ body: Buffer.from(item.data), contentType: item.mime, status: 200 }));
  }
}

// Playwright cannot route requests the service worker makes, so the seeded
// test runs without one; the SW's own behaviour is covered by pwa-resilience.
test.describe('bundled media', () => {
  test.use({ serviceWorkers: 'block' });

test('bundled media: the site\'s media folder is added to the device on its own', async ({ page }) => {
  await serveBundledMedia(page);
  await completeOnboarding(page);
  // Seeding starts in idle time once the app is up (during onboarding here);
  // the hero appearing on Today is the durable sign that it finished.
  await expect(page.locator('.z-hero img.z-hero__img--loaded')).toBeVisible({ timeout: 20000 });

  await page.goto('/matchups');
  const jinCard = page.locator('.z-card').filter({ has: page.getByRole('heading', { exact: true, name: 'Jin' }) });
  await expect(jinCard.locator('.z-art-icon img')).toHaveAttribute('src', /^blob:/);

  await page.goto('/settings/media');
  await expect(page.getByTestId('media-summary')).toContainText('3 items');
  await expect(page.getByText(/3 items on the site/)).toBeVisible();
  await page.getByTestId('media-bundled-check').click();
  await expect(page.getByTestId('media-bundled-notice')).toContainText('Up to date: all 3 items');

  // Switched off, a reload adds nothing new (and deletes nothing).
  await page.getByLabel("Add the site's images and clips automatically").uncheck();
  await page.getByLabel('Type DELETE to remove every imported image and clip').fill('DELETE');
  await page.getByRole('button', { name: 'Delete all media' }).click();
  await expect(page.getByTestId('media-summary')).toHaveText('No media imported yet.');
  await page.goto('/today');
  await page.waitForTimeout(2500);
  await expect(page.locator('.z-hero')).toHaveCount(0);
});
});

test('bundled media: a site without bundled media stays quiet', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await completeOnboarding(page);
  await page.waitForTimeout(3000);
  await expect(page.getByText(/from the site/)).toHaveCount(0);
  await page.goto('/diagnostics');
  await expect(page.getByText('No errors recorded.')).toBeVisible();
  expect(errors).toEqual([]);
  await page.goto('/settings/media');
  await page.getByTestId('media-bundled-check').click();
  await expect(page.getByTestId('media-bundled-notice')).toContainText('no bundled media yet');
});

test('media pack: a file that is not a pack is refused with a clear message', async ({ page }) => {
  await completeOnboarding(page);
  await page.goto('/settings/media');
  await page.getByTestId('media-pack-input').setInputFiles({ buffer: Buffer.from('not a zip'), mimeType: 'application/zip', name: 'oops.zip' });
  await expect(page.getByTestId('media-pack-error')).toContainText('not a readable zip');
  await expect(page.getByTestId('media-summary')).toHaveText('No media imported yet.');
});

test('media pack: export then delete all, and the exported pack imports back', async ({ page }) => {
  await completeOnboarding(page);
  await importPack(page);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export media pack' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^zanshin-media-\d{8}-\d{4}\.zip$/);
  const path = await file.path();

  await page.getByLabel('Type DELETE to remove every imported image and clip').fill('DELETE');
  await page.getByRole('button', { name: 'Delete all media' }).click();
  await expect(page.getByTestId('media-summary')).toHaveText('No media imported yet.');

  await page.getByTestId('media-pack-input').setInputFiles(path);
  await expect(page.getByTestId('media-import-report')).toContainText('Imported 5 of 5 items.');
});
