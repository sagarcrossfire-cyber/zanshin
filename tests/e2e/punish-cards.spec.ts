// P8 gate: Punish Trainer + Flashcards (§5.10/§5.15, AC-PUN-2–4,
// AC-CARDS-3) + axe on the new routes. Onboarding is completed first;
// each test gets a fresh browser context.
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

test('AC-PUN-2/3: ladder quiz explains with the rung highlighted; a timed-out question becomes a card', async ({ page }) => {
  await completeOnboarding(page);
  await page.goto('/punish');
  await expect(page.locator('#main').getByRole('heading', { name: 'Punish Trainer' })).toBeVisible();
  await expect(page.getByText(/Question 1 of/)).toBeVisible();

  // Answer the first question: explanation + ladder with the rung highlighted.
  await page.locator('.z-punish__option').first().click();
  await expect(page.locator('.z-punish__explanation')).toBeVisible();
  await expect(page.locator('.z-ladder__rung--highlight')).toBeVisible();
  await expect(page.locator('.z-ladder__rung[aria-current="true"]')).toBeVisible();

  // Turn the timer on and let question 2 time out: a guaranteed miss.
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByLabel('3-second timer').click();
  await expect(page.locator('.z-punish__explanation')).toBeVisible({ timeout: 8000 });
  await page.getByRole('button', { name: 'Next' }).click();
  // Timer off again so the remaining questions cannot time out mid-click.
  await page.getByLabel('3-second timer').click();

  // Finish the rest of the quiz answering the first option each time
  // (two actions per question: answer, then Next/Finish).
  for (let i = 0; i < 80; i += 1) {
    if (await page.locator('#main').getByRole('heading', { name: 'Quiz complete' }).isVisible()) break;
    if (await page.locator('.z-punish__explanation').isVisible()) {
      if (await page.getByRole('button', { name: 'Finish' }).isVisible()) {
        await page.getByRole('button', { name: 'Finish' }).click();
      } else {
        await page.getByRole('button', { name: 'Next' }).click();
      }
    } else {
      await page.locator('.z-punish__option').first().click();
    }
  }
  await expect(page.locator('#main').getByRole('heading', { name: 'Quiz complete' })).toBeVisible();
  await expect(page.getByText(/missed questions saved as flashcards/)).toBeVisible();

  // The missed card exists in the Punish ladder deck.
  await page.goto('/cards');
  await expect(page.locator('#main').getByRole('heading', { name: 'Punish ladder' })).toBeVisible();
});

test('AC-PUN-4: character quiz without a cached pack offers import, offline', async ({ page }) => {
  await completeOnboarding(page);
  await page.goto('/punish');
  await page.getByRole('tab', { name: 'Character quiz' }).click();
  await expect(page.getByText(/No cached data for Kazuya/)).toBeVisible();
  await expect(page.getByText(/Import this character's data|In-app importer is off/)).toBeVisible();
});

test('AC-CARDS-3: keyboard grading works and is announced', async ({ page }) => {
  await completeOnboarding(page);
  await page.goto('/cards');
  await expect(page.locator('#main').getByRole('heading', { name: 'Flashcards' })).toBeVisible();
  await expect(page.locator('#main').getByRole('heading', { name: 'Notation' })).toBeVisible();
  await page.getByRole('button', { name: 'Review due cards' }).click();
  await expect(page.locator('#main').getByRole('heading', { name: 'Card review' })).toBeVisible();
  await page.getByRole('button', { name: 'Reveal' }).click();
  await page.keyboard.press('3');
  const announcement = page.locator('.z-cards__announcement');
  await expect(announcement).toContainText(/Good/);
  // Space reveals the next card; grade it Easy with the 4 key.
  await page.keyboard.press(' ');
  await expect(page.getByRole('button', { name: 'Reveal' })).toBeHidden();
  await page.keyboard.press('4');
  await expect(announcement).toContainText(/Easy/);
});

test('P8 axe: punish/cards/review have no serious/critical violations', async ({ page }) => {
  await completeOnboarding(page);
  await page.goto('/cards');
  await expect(page.locator('#main').getByRole('heading', { name: 'Notation' })).toBeVisible();
  for (const route of ['/punish', '/cards', '/cards/review']) {
    await page.goto(route);
    await expect(page.locator('#main')).toBeVisible();
    const results = await new AxeBuilder({ page: page as never }).analyze();
    const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(serious, `${route}: ${JSON.stringify(serious, null, 2)}`).toEqual([]);
  }
});
