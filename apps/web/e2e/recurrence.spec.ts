import { expect, test, type Page } from '@playwright/test';

// Fixed clock: Monday 16 November 2026, 10:15 in Berlin. The rules (the three rule types, the 31st, Occurrence
// ids, what an Occurrence brings) are unit-tested in the core; these tests only check that "Repeat…", the
// Occurrences on screen and ticking one reach the core.
const NOW = new Date('2026-11-16T10:15:00+01:00');

test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: NOW });
  await page.clock.setFixedTime(NOW);
});

async function type(page: Page, placeholder: string, text: string) {
  const field = page.getByPlaceholder(placeholder);
  await field.fill(text);
  await field.press('Enter');
}

const chip = (page: Page, name: RegExp) => page.getByRole('navigation', { name: 'Upcoming' }).getByRole('button', { name });
const anytime = (page: Page) => page.getByRole('region', { name: /Anytime today|Not placed/ });
const done = (page: Page) => page.getByRole('region', { name: /Done/ });
const heading = (page: Page) => page.getByRole('heading', { level: 1 });

test('"Repeat…" on a Task makes Occurrences on later days, marked ↻, that tick on their own', async ({ page }) => {
  await page.goto('/?db=rec-task');
  await type(page, '+ Task today', 'Water plants');
  await page.getByRole('button', { name: 'Water plants', exact: true }).click();
  await page.getByRole('button', { name: 'Repeat…' }).click();
  await page.getByRole('button', { name: 'Start repeating' }).click(); // every 1 day, the default

  // today's Task is the first Occurrence: a bare ↻ in Anytime today
  await expect(anytime(page).getByRole('listitem')).toHaveText([/Water plants.*↻/]);

  // tomorrow has its own, with the full tag, like any row
  await chip(page, /Tuesday 17 November/).click();
  await expect(heading(page)).toHaveText('Tuesday 17 November');
  await expect(anytime(page).getByRole('listitem')).toHaveText([/Water plants.*↻ daily/]);

  // ticking it, ahead of time, leaves today's open
  await page.getByRole('button', { name: 'Tick off Water plants' }).click();
  await expect(done(page).getByRole('listitem')).toHaveText([/Water plants/]);
  await chip(page, /^Today/).click();
  await expect(anytime(page).getByRole('listitem')).toHaveText([/Water plants/]);
  await expect(page.getByTestId('anytime-count')).toHaveText('1');
});

test('"Repeat…" on an Event: weekdays; later Occurrences start with nothing placed in them', async ({ page }) => {
  await page.goto('/?db=rec-event');
  await type(page, '+ Event, e.g. Gym 18-19', 'Gym 18-19');
  await type(page, '+ Task in Gym', 'Pack bag');
  await page.getByTestId('next').getByRole('button', { name: 'Gym', exact: true }).click();
  await page.getByRole('button', { name: 'Repeat…' }).click();
  await page.getByLabel('Repeat rule').selectOption('weekdays');
  await page.getByRole('button', { name: 'Mon', exact: true }).click();
  await page.getByRole('button', { name: 'Tue', exact: true }).click();
  await page.getByRole('button', { name: 'Start repeating' }).click();

  // today's Gym is the first Occurrence: a bare ↻ on the Next card, and its own Task stays placed
  await expect(page.getByTestId('next')).toContainText('Gym ↻');
  await expect(page.getByTestId('next')).toContainText('Pack bag');

  await chip(page, /Tuesday 17 November/).click();
  const events = page.getByTestId('tab-panel');
  await expect(events).toContainText('Gym');
  await expect(events).toContainText('↻ Mon/Tue');
  await expect(events).not.toContainText('Pack bag');
  // no Occurrence on Wednesday
  await chip(page, /Wednesday 18 November/).click();
  await expect(page.getByRole('tab', { name: /^Events/ })).toHaveText(/0$/);
});

test('"Repeat…" on a Someday Task puts its first Occurrence on the first matching day and out of Someday', async ({ page }) => {
  await page.goto('/?db=rec-someday');
  await page.getByRole('tab', { name: /Someday/ }).click();
  await type(page, '+ Someday Task', 'Clean oven');
  await page.getByTestId('tab-panel').getByRole('button', { name: 'Clean oven', exact: true }).click();
  await page.getByRole('button', { name: 'Repeat…' }).click();
  await page.getByLabel('Repeat rule').selectOption('weekdays');
  await page.getByRole('button', { name: 'Wed', exact: true }).click();
  await page.getByRole('button', { name: 'Start repeating' }).click();

  await expect(page.getByRole('tab', { name: /Someday/ }).locator('.tabcount')).toHaveText('0');
  await expect(page.getByTestId('anytime-count')).toHaveText('0');
  await chip(page, /Wednesday 18 November/).click();
  await expect(anytime(page).getByRole('listitem')).toHaveText([/Clean oven.*↻ Wed/]);
});
