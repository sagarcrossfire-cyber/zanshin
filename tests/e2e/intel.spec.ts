// Release 1.3.0 gate: the intelligence features against a mocked intel
// function. page.route answers /.netlify/functions/intel/* so no request
// leaves the preview server and nothing costs money. Covers the ZANSHIN
// coach provider (Settings → Ask), Look it up with Keep as a note, the
// matchup primer card, the daily-cap message, and axe on the new surfaces.
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page, type Route } from '@playwright/test';

const INTEL = '**/.netlify/functions/intel/**';

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

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ body: JSON.stringify(body), contentType: 'application/json', status });
}

const USAGE = { capUsd: 3, costUsd: 0.012, inputTokens: 900, outputTokens: 180, todayUsd: 0.37 };
const CITATIONS = [
  { date: '2026-09-12', id: '1', title: 'Yoshimitsu vs Kazuya — Wavu Wiki', url: 'https://wavu.wiki/t/Yoshimitsu_counterplay' },
  { date: null, id: '2', title: 'Kazuya punishment guide', url: 'https://tekkendocs.com/t8/kazuya' },
];

/** A healthy mocked intel function; `seen` collects every request body. */
async function mockIntel(page: Page, seen: Array<{ url: string; body: unknown }>) {
  await page.route(INTEL, async (route) => {
    const url = route.request().url();
    const raw = route.request().postData();
    seen.push({ body: raw ? JSON.parse(raw) : null, url });
    if (url.includes('/intel/health')) {
      return json(route, {
        capUsd: 3, defaultModels: { coach: 'anthropic/claude-haiku-5-5', research: 'perplexity/sonar' }, keyConfigured: true,
        models: [], ok: true, today: { costUsd: 0.37, day: '2026-10-31', inputTokens: 900, outputTokens: 180, requests: 2 },
      });
    }
    if (url.includes('/intel/usage')) {
      return json(route, { capUsd: 3, days: [{ costUsd: 0.37, day: '2026-10-31', inputTokens: 900, outputTokens: 180, requests: 2 }] });
    }
    if (url.includes('/intel/coach')) {
      return json(route, { model: 'anthropic/claude-haiku-5-5', text: 'Drill WS 4 punishes for ten minutes in Practice.\n\nNext action: Open the Lab and run the punish ladder.', usage: USAGE });
    }
    if (url.includes('/intel/research')) {
      return json(route, {
        citations: CITATIONS, model: 'perplexity/sonar',
        text: 'Most Yoshimitsu players step left after blocking f,f+2 [1]. The hellsweep is reported -23 on block, so stand and launch it [2].',
        usage: USAGE,
      });
    }
    if (url.includes('/intel/primer/')) {
      return json(route, {
        cached: false, character: 'Kazuya', citations: CITATIONS, generatedAt: '2026-10-31T12:00:00.000Z', model: 'perplexity/sonar', stale: false,
        text: '**Their plan**\n- Wall carry with f,f+2 and mids [1]\n\n**Punish these**\n- Hellsweep: stand and launch [2]\n\n**Duck or step these**\n- Step left after f,f+2 [1]\n\n**Yoshimitsu\'s answers**\n- Flash on predictable d/f+2 [1]\n\n**Watch for**\n- Electric pressure at the wall [2]',
        usage: USAGE,
      });
    }
    return json(route, { error: 'Unknown route.' }, 404);
  });
}

test('Settings: the ZANSHIN provider needs no key, shows the model list and the spend meter', async ({ page }) => {
  const seen: Array<{ url: string; body: unknown }> = [];
  await mockIntel(page, seen);
  await completeOnboarding(page);
  await page.goto('/settings');
  await page.locator('#set-ai-provider').selectOption('zanshin');
  await expect(page.getByLabel('API key')).toHaveCount(0);
  await expect(page.getByLabel('Coach model')).toBeVisible();
  await page.getByLabel('Coach model').selectOption('anthropic/claude-sonnet-5-5');
  await expect(page.getByTestId('intel-spend')).toContainText('$0.37 of $3.00 today');
  await page.getByRole('button', { name: 'Test connection' }).click();
  await expect(page.getByRole('status')).toContainText('Connection works. $0.37 of $3.00 today.');
  expect(seen.some((call) => call.url.includes('/intel/health'))).toBe(true);
  expect(seen.some((call) => call.url.includes('/intel/coach'))).toBe(false);
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByText('Settings saved.')).toBeVisible();
});

test('Ask through the site: the answer renders with one Next action and the chosen model is sent', async ({ page }) => {
  const seen: Array<{ url: string; body: unknown }> = [];
  await mockIntel(page, seen);
  await completeOnboarding(page);
  await page.goto('/settings');
  await page.locator('#set-ai-provider').selectOption('zanshin');
  await page.getByLabel('Coach model').selectOption('anthropic/claude-sonnet-5-5');
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByText('Settings saved.')).toBeVisible();

  await page.goto('/coach');
  await page.getByRole('tab', { name: 'Ask' }).click();
  await expect(page.getByText(/intelligence function \(Claude Sonnet 5.5\)/)).toBeVisible();
  await page.getByLabel('Ask the coach').fill('What should I drill today?');
  await page.getByRole('button', { name: 'Send' }).click();
  const reply = page.locator('.z-coach__message--coach').last();
  await expect(reply).toContainText('Drill WS 4 punishes');
  const text = await reply.innerText();
  expect(text.match(/Next action:/g)).toHaveLength(1);
  const coachCall = seen.find((call) => call.url.includes('/intel/coach'));
  expect(coachCall).toBeDefined();
  const body = coachCall?.body as { model: string; system: string; messages: Array<{ role: string; content: string }> };
  expect(body.model).toBe('anthropic/claude-sonnet-5-5');
  expect(body.system).toContain('CONTEXT');
  expect(body.messages[0]).toEqual({ content: 'What should I drill today?', role: 'user' });
  expect(JSON.stringify(body)).not.toMatch(/pplx-/);
});

test('Look it up: web answer with sources and the web badge; Keep stores a research note', async ({ page }) => {
  const seen: Array<{ url: string; body: unknown }> = [];
  await mockIntel(page, seen);
  await completeOnboarding(page);
  await page.goto('/coach');
  await page.getByRole('tab', { name: 'Look it up' }).click();
  await page.getByLabel('What do you want to know?').fill('How do Yoshimitsu players deal with Kazuya f,f+2?');
  await page.getByRole('button', { name: 'Look it up' }).click();
  const answer = page.getByTestId('lookup-answer');
  await expect(answer).toBeVisible();
  await expect(answer).toContainText('step left after blocking f,f+2');
  await expect(answer.getByText(/Web-sourced · sonar/)).toBeVisible();
  await expect(answer.getByRole('link', { name: 'Yoshimitsu vs Kazuya — Wavu Wiki' })).toHaveAttribute('href', 'https://wavu.wiki/t/Yoshimitsu_counterplay');
  await expect(answer.getByText(/Frame numbers here \(-23\)/)).toBeVisible();
  await expect(answer).toContainText('$0.37 of $3.00 today');
  const researchCall = seen.find((call) => call.url.includes('/intel/research'));
  expect((researchCall?.body as { question: string }).question).toBe('How do Yoshimitsu players deal with Kazuya f,f+2?');

  await page.getByRole('button', { name: 'Keep as a note' }).click();
  await expect(answer.getByRole('button', { name: 'Kept', exact: true })).toBeDisabled();
  await expect(page.getByTestId('research-kept')).toHaveCount(1);
  await page.reload();
  await page.getByRole('tab', { name: 'Look it up' }).click();
  const kept = page.getByTestId('research-kept');
  await expect(kept).toHaveCount(1);
  await kept.locator('summary').click();
  await expect(kept).toContainText('step left after blocking f,f+2');
  await kept.getByRole('button', { name: 'Delete note' }).click();
  await expect(page.getByTestId('research-kept')).toHaveCount(0);
});

test('Look it up: the daily cap and a missing key are explained in plain words', async ({ page }) => {
  await completeOnboarding(page);
  await page.route(INTEL, (route) => json(route, { capUsd: 3, error: 'Daily intel budget reached ($3.00 of $3.00). Try again tomorrow.', todayUsd: 3.01 }, 429));
  await page.goto('/coach');
  await page.getByRole('tab', { name: 'Look it up' }).click();
  await page.getByLabel('What do you want to know?').fill('Anything');
  await page.getByRole('button', { name: 'Look it up' }).click();
  await expect(page.getByRole('alert')).toContainText('Daily intel budget reached');
  await expect(page.getByRole('alert')).toContainText('resets at midnight UTC');

  await page.unroute(INTEL);
  await page.route(INTEL, (route) => json(route, { error: 'The site has no Perplexity key.' }, 503));
  await page.getByRole('button', { name: 'Look it up' }).click();
  await expect(page.getByRole('alert')).toContainText('PERPLEXITY_API_KEY');
});

test('Matchup primer: fetched once, kept on the device, refreshable', async ({ page }) => {
  const seen: Array<{ url: string; body: unknown }> = [];
  await mockIntel(page, seen);
  await completeOnboarding(page);
  await page.goto('/matchups/Kazuya');
  const card = page.getByTestId('primer-card');
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: 'Get the primer' }).click();
  await expect(card).toContainText('Their plan');
  await expect(card).toContainText('Hellsweep: stand and launch');
  await expect(card.getByText(/Web-sourced · sonar/)).toBeVisible();
  await expect(card.getByText('from the site')).toBeVisible();
  expect(seen.filter((call) => call.url.includes('/intel/primer/Kazuya')).length).toBe(1);

  await page.reload();
  await expect(card).toContainText('Their plan');
  await expect(card.getByText('kept on this device')).toBeVisible();
  expect(seen.filter((call) => call.url.includes('/intel/primer/')).length).toBe(1);

  await card.getByRole('button', { name: 'Refresh primer' }).click();
  await expect(card.getByText('from the site')).toBeVisible();
  const refresh = seen.filter((call) => call.url.includes('/intel/primer/Kazuya'));
  expect(refresh.length).toBe(2);
  expect(refresh[1]?.url).toContain('refresh=1');
});

test('Diagnostics reports the intelligence function; axe passes on the new surfaces', async ({ page }) => {
  const seen: Array<{ url: string; body: unknown }> = [];
  await mockIntel(page, seen);
  await completeOnboarding(page);
  await page.goto('/diagnostics');
  await expect(page.getByTestId('diagnostics-intel')).toContainText('not checked yet');
  await page.getByRole('button', { name: 'Check intelligence function' }).click();
  await expect(page.getByTestId('diagnostics-intel')).toContainText('key configured');
  await expect(page.getByTestId('diagnostics-intel')).toContainText('$0.37 of $3.00 today');

  await page.goto('/matchups/Kazuya');
  await page.getByTestId('primer-card').getByRole('button', { name: 'Get the primer' }).click();
  await expect(page.getByTestId('primer-card')).toContainText('Their plan');
  for (const step of ['primer', 'lookup'] as const) {
    if (step === 'lookup') {
      await page.goto('/coach');
      await page.getByRole('tab', { name: 'Look it up' }).click();
      await page.getByLabel('What do you want to know?').fill('Kazuya');
      await page.getByRole('button', { name: 'Look it up' }).click();
      await expect(page.getByTestId('lookup-answer')).toBeVisible();
    }
    const results = await new AxeBuilder({ page: page as never }).analyze();
    const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(serious, `${step}: ${JSON.stringify(serious, null, 2)}`).toEqual([]);
  }
});
