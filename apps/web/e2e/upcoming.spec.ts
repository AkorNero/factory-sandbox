import { expect, test, type Page } from '@playwright/test';

// Fixed clock: Monday 16 November 2026, 10:15 in Berlin. The rules (strip counts, dating a Task, moving an
// Event with its Tasks) are unit-tested in the core; these tests only check that the strip, the date picker
// and the drag targets reach them.
const NOW = new Date('2026-11-16T10:15:00+01:00');

test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: NOW });
  await page.clock.setFixedTime(NOW);
  await page.goto('/');
});

async function type(page: Page, placeholder: string, text: string) {
  const field = page.getByPlaceholder(placeholder);
  await field.fill(text);
  await field.press('Enter');
}

const strip = (page: Page) => page.getByRole('navigation', { name: 'Upcoming' });
const chip = (page: Page, name: RegExp) => strip(page).getByRole('button', { name });
const TUE = /Tuesday 17 November/;
const heading = (page: Page) => page.getByRole('heading', { level: 1 });
const anytime = (page: Page) => page.getByRole('region', { name: /Anytime today|Not placed/ });
const dots = (page: Page, name: RegExp) => chip(page, name).locator('.dots');

test('tapping a day shows it in the same layout; its "+ …" fields add to that day', async ({ page }) => {
  await chip(page, TUE).click();

  await expect(heading(page)).toHaveText('Tuesday 17 November');
  await expect(page.getByRole('region', { name: /Not placed/ })).toBeVisible();
  await expect(page.getByRole('region', { name: /Anytime today/ })).toHaveCount(0);

  await type(page, '+ Task on Tue', 'Book flights');
  await type(page, '+ Event, e.g. Gym 18-19', 'Planning 9-10');
  await type(page, '+ Task in Planning', 'Write agenda');

  await expect(anytime(page).getByRole('listitem')).toHaveText([/Book flights/]);
  await expect(page.getByTestId('tab-panel')).toContainText('Planning');
  await expect(page.getByTestId('tab-panel')).toContainText('Write agenda');
  await expect(dots(page, TUE)).toHaveAccessibleName('1 events, 2 tasks');
  await expect(dots(page, /^Today/)).toHaveAccessibleName('0 events, 0 tasks');

  await chip(page, /^Today/).click();
  await expect(heading(page)).toHaveText('Monday 16 November');
  await expect(page.getByRole('region', { name: /Anytime today/ })).toBeVisible();
});

test('another day has the Today layout\'s tabs, so a Task there can be dragged to Someday', async ({ page }) => {
  await chip(page, TUE).click();
  for (const name of [/^Events/, /^Earlier/, /^Someday/]) await expect(page.getByRole('tab', { name })).toBeVisible();
  await type(page, '+ Task on Tue', 'Book flights');

  await anytime(page).getByRole('button', { name: 'Book flights', exact: true }).dragTo(page.getByRole('tab', { name: /^Someday/ }));

  await expect(page.locator('.toast')).toContainText('Sent “Book flights” to Someday');
  await expect(page.getByTestId('anytime-count')).toHaveText('0');
  await page.getByRole('tab', { name: /^Someday/ }).click();
  await expect(page.getByTestId('tab-panel')).toContainText('Book flights');
});

test('"Pick a day" adds a later day to the strip until its ✕ removes it', async ({ page }) => {
  const picker = page.getByLabel('Day to add to the strip');
  await expect(page.getByRole('button', { name: /Pick a day/ })).toBeVisible();
  await expect(picker).toHaveAttribute('min', '2026-11-24'); // only days after the 7 shown
  await expect(strip(page).getByRole('button', { name: /Pick a day/ })).toHaveCount(0); // outside the strip's scroll area

  await picker.fill('2026-11-25');

  await expect(strip(page).locator('.chip')).toHaveCount(9);
  await expect(heading(page)).toHaveText('Wednesday 25 November');

  await page.getByRole('button', { name: 'Remove 25 November' }).click();

  await expect(strip(page).locator('.chip')).toHaveCount(8);
  await expect(heading(page)).toHaveText('Monday 16 November');
});

test('dragging a Task onto a day chip dates it there and clears its Placement', async ({ page }) => {
  await type(page, '+ Event, e.g. Gym 18-19', 'Deep work 10-11');
  await type(page, '+ Task in Deep work', 'Write intro');
  await type(page, '+ Task today', 'Buy stamps');
  await expect(page.getByTestId('anytime-count')).toHaveText('1');

  await anytime(page).getByRole('button', { name: 'Buy stamps', exact: true }).dragTo(chip(page, TUE));
  await expect(page.locator('.toast')).toContainText('Dated “Buy stamps” to Tue 17 Nov');
  await expect(page.getByTestId('anytime-count')).toHaveText('0');
  await expect(dots(page, TUE)).toHaveAccessibleName('0 events, 1 tasks');

  // a placed Task dragged to a day leaves its Event
  await page.getByTestId('now').getByRole('button', { name: 'Write intro', exact: true }).dragTo(chip(page, TUE));
  await expect(page.getByTestId('now')).toContainText('Nothing placed');
  await expect(dots(page, TUE)).toHaveAccessibleName('0 events, 2 tasks');

  await chip(page, TUE).click();
  await expect(anytime(page).getByRole('listitem')).toHaveText([/Write intro/, /Buy stamps/]);
});

test('dragging a placed Task onto Anytime dates it to the day shown and clears its Placement', async ({ page }) => {
  await type(page, '+ Event, e.g. Gym 18-19', 'Deep work 10-11');
  await type(page, '+ Task in Deep work', 'Write intro');
  await expect(page.getByTestId('anytime-count')).toHaveText('0');

  await page.getByTestId('now').getByRole('button', { name: 'Write intro', exact: true }).dragTo(anytime(page));

  await expect(page.getByTestId('anytime-count')).toHaveText('1');
  await expect(page.getByTestId('now')).toContainText('Nothing placed');
  await expect(page.locator('.toast')).toContainText('Dated “Write intro” to Mon 16 Nov');
});

test('dragging an Event onto a day chip moves it with its placed Tasks, still placed', async ({ page }) => {
  await type(page, '+ Event, e.g. Gym 18-19', 'Deep work 10-11');
  await type(page, '+ Task in Deep work', 'Write intro');
  await expect(dots(page, /^Today/)).toHaveAccessibleName('1 events, 1 tasks');

  await page.getByTestId('now').getByRole('button', { name: 'Deep work', exact: true }).dragTo(chip(page, TUE));

  await expect(page.locator('.toast')).toContainText('Moved “Deep work” to Tue 17 Nov with its placed Tasks');
  await expect(page.getByTestId('now')).toContainText('Free');
  await expect(dots(page, /^Today/)).toHaveAccessibleName('0 events, 0 tasks');
  await expect(dots(page, TUE)).toHaveAccessibleName('1 events, 1 tasks');

  await chip(page, TUE).click();
  const events = page.getByTestId('tab-panel');
  await expect(events).toContainText('Deep work');
  await expect(events.getByRole('listitem')).toHaveText([/Write intro/]); // still placed in it
  await expect(page.getByTestId('anytime-count')).toHaveText('0');
});
