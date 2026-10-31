// P9 gate: Coach (§5.14, AC-COACH-1/2/4) + axe on the Coach and Settings
// routes. Onboarding is completed first; each test gets a fresh context.
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

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

async function setProvider(page: Page, provider: string, extra?: (page: Page) => Promise<void>) {
  await page.goto('/settings');
  await page.locator('#set-ai-provider').selectOption(provider);
  if (extra !== undefined) await extra(page);
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByText('Settings saved.')).toBeVisible();
}

test('AC-COACH-1: with no provider, the weekly review and Copy Context work offline', async ({ page }) => {
  await completeOnboarding(page);
  await page.goto('/coach');
  await expect(page.locator('#main').getByRole('heading', { name: 'Coach' })).toBeVisible();
  await page.getByRole('button', { name: 'Generate review' }).click();
  await expect(page.getByText(/Week of/)).toBeVisible();
  await expect(page.getByText(/Next action:/)).toBeVisible();

  await page.getByRole('tab', { name: 'Ask' }).click();
  await expect(page.getByRole('button', { name: 'Copy context for any AI' })).toBeVisible();
  await expect(page.getByText('No AI provider configured')).toBeVisible();
});

test('AC-COACH-2/4: mock provider round-trips; every answer ends with exactly one Next action line', async ({ page }) => {
  await completeOnboarding(page);
  await setProvider(page, 'mock');
  await page.goto('/coach');
  await page.getByRole('tab', { name: 'Ask' }).click();
  await page.getByLabel('Ask the coach').fill('What should I drill today?');
  await page.getByRole('button', { name: 'Send' }).click();
  const reply = page.locator('.z-coach__message--coach').last();
  await expect(reply).toBeVisible();
  await expect(reply).toContainText('Next action:');
  const text = await reply.innerText();
  expect(text.match(/Next action:/g)).toHaveLength(1);
  expect(text.trim().split('\n').pop()).toMatch(/^Next action:/);
});

test('AC-COACH-2: an unreachable provider falls back to the rules coach with a visible notice', async ({ page }) => {
  await completeOnboarding(page);
  await setProvider(page, 'openai-compatible', async (p) => {
    await p.getByLabel('API key').fill('sk-test');
    await p.getByLabel('Base URL').fill('http://127.0.0.1:1/v1');
    await p.getByLabel('Model').fill('test-model');
  });
  await page.goto('/coach');
  await page.getByRole('tab', { name: 'Ask' }).click();
  await page.getByLabel('Ask the coach').fill('Help me improve.');
  await page.getByRole('button', { name: 'Send' }).click();
  const reply = page.locator('.z-coach__message--coach').last();
  await expect(reply).toContainText(/AI coach unavailable/, { timeout: 30000 });
  await expect(reply).toContainText(/Here is the built-in review/);
});

test('P9 axe: coach and settings have no serious/critical violations', async ({ page }) => {
  await completeOnboarding(page);
  for (const route of ['/coach', '/settings']) {
    await page.goto(route);
    await expect(page.locator('#main')).toBeVisible();
    const results = await new AxeBuilder({ page: page as never }).analyze();
    const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(serious, `${route}: ${JSON.stringify(serious, null, 2)}`).toEqual([]);
  }
});
