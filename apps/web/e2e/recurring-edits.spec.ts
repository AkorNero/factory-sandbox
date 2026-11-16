import { expect, test, type Page } from '@playwright/test';

// Fixed clock: Monday 16 November 2026, 10:15 in Berlin. The rules (scopes, series splitting, history, schedule
// rebuilds, stop repeating, soft delete) are unit-tested in the core; these tests only check that the menus ask
// "Just this one" / "This and following" and that the answer reaches the core and the screen.
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
const asked = (page: Page) => page.getByRole('group', { name: 'Apply to' });

/** A daily "Water plants" Task, repeating from today. */
async function dailyTask(page: Page, db: string) {
  await page.goto(`/?db=${db}`);
  await type(page, '+ Task today', 'Water plants');
  await page.getByRole('button', { name: 'Water plants', exact: true }).click();
  await page.getByRole('button', { name: 'Repeat…' }).click();
  await page.getByRole('button', { name: 'Start repeating' }).click();
}

test('rename → This and following reaches later days but not earlier ones; Delete → Just this one leaves the next day', async ({ page }) => {
  await dailyTask(page, 'rec-edit-task');

  await chip(page, /Tuesday 17 November/).click();
  await page.getByRole('button', { name: 'Water plants', exact: true }).click();
  await page.getByLabel('Title').fill('Water ferns');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(asked(page)).toBeVisible(); // a menu edit of an Occurrence asks
  await asked(page).getByRole('button', { name: 'This and following' }).click();
  await expect(anytime(page).getByRole('listitem')).toHaveText([/Water ferns.*↻ daily/]);

  await chip(page, /Wednesday 18 November/).click();
  await expect(anytime(page).getByRole('listitem')).toHaveText([/Water ferns.*↻ daily/]);
  await chip(page, /^Today/).click();
  await expect(anytime(page).getByRole('listitem')).toHaveText([/Water plants/]);

  // Delete → Just this one on Wednesday: gone there, Thursday carries on
  await chip(page, /Wednesday 18 November/).click();
  await page.getByRole('button', { name: 'Water ferns', exact: true }).click();
  await page.getByRole('button', { name: 'Delete' }).click();
  await asked(page).getByRole('button', { name: 'Just this one' }).click();
  await expect(page.getByTestId('anytime-count')).toHaveText('0');
  await chip(page, /Thursday 19 November/).click();
  await expect(anytime(page).getByRole('listitem')).toHaveText([/Water ferns/]);
});

test('Stop repeating keeps the opened day as a one-off and removes the later ones', async ({ page }) => {
  await dailyTask(page, 'rec-edit-stop');

  await chip(page, /Wednesday 18 November/).click();
  await page.getByRole('button', { name: 'Water plants', exact: true }).click();
  await page.getByRole('button', { name: 'Stop repeating' }).click(); // no question: it always means this and following

  await expect(anytime(page).getByRole('listitem')).toHaveText([/Water plants/]);
  await expect(anytime(page).getByRole('listitem')).not.toContainText('↻');
  await chip(page, /Thursday 19 November/).click();
  await expect(page.getByTestId('anytime-count')).toHaveText('0');
  await chip(page, /Tuesday 17 November/).click();
  await expect(anytime(page).getByRole('listitem')).toHaveText([/Water plants.*↻ daily/]);
});

test('an Event Occurrence: times → This and following; Change schedule removes and rebuilds the later ones', async ({ page }) => {
  await page.goto('/?db=rec-edit-event');
  await type(page, '+ Event, e.g. Gym 18-19', 'Gym 18-19');
  await page.getByTestId('next').getByRole('button', { name: 'Gym', exact: true }).click();
  await page.getByRole('button', { name: 'Repeat…' }).click();
  await page.getByRole('button', { name: 'Start repeating' }).click();

  await chip(page, /Wednesday 18 November/).click();
  const events = page.getByTestId('tab-panel');
  await events.getByRole('button', { name: /^Gym/ }).click();
  await page.getByLabel('Start').fill('17:00');
  await page.getByRole('button', { name: 'Save' }).click();
  await asked(page).getByRole('button', { name: 'This and following' }).click();
  await expect(events).toContainText('17:00–19:00');
  await chip(page, /Thursday 19 November/).click();
  await expect(events).toContainText('17:00–19:00');
  await chip(page, /Tuesday 17 November/).click();
  await expect(events).toContainText('18:00–19:00');

  // Change schedule on Tuesday: only Mondays from now on, so the Occurrence moves to Monday 23rd and the rest go
  await events.getByRole('button', { name: /^Gym/ }).click();
  await page.getByRole('button', { name: 'Change schedule' }).click();
  await page.getByLabel('Repeat rule').selectOption('weekdays');
  await page.getByRole('button', { name: 'Mon', exact: true }).click();
  await page.getByRole('button', { name: 'Apply new schedule' }).click();
  for (const day of [/Tuesday 17 November/, /Wednesday 18 November/, /Thursday 19 November/]) {
    await chip(page, day).click();
    await expect(page.getByRole('tab', { name: /^Events/ })).toHaveText(/0$/);
  }
  await chip(page, /Monday 23 November/).click();
  await expect(page.getByRole('tab', { name: /^Events/ })).toHaveText(/1$/);
  await expect(events).toContainText('Gym');
});
