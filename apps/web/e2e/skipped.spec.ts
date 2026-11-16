import { expect, test, type Page } from '@playwright/test';

// Fixed clock: Monday 16 November 2026, 23:58 in Berlin. The rules (Skipped before Carry-over, weekly Occurrences
// carrying over, Sub-tasks, the drag limit) are unit-tested in the core; these tests only check that the midnight job
// closes an Occurrence as Skipped, that the banner lists it, and that a refused drop does nothing on screen.
const MON_2358 = new Date('2026-11-16T23:58:00+01:00');
const TUE_0000 = new Date('2026-11-17T00:00:00+01:00');

test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: MON_2358 });
  await page.clock.setFixedTime(MON_2358);
});

async function type(page: Page, placeholder: string, text: string) {
  const field = page.getByPlaceholder(placeholder);
  await field.fill(text);
  await field.press('Enter');
}

const anytime = (page: Page) => page.getByRole('region', { name: /Anytime today|Not placed/ });
const banner = (page: Page) => page.getByRole('region', { name: 'Overnight' });
const chip = (page: Page, name: RegExp) => page.getByRole('navigation', { name: 'Upcoming' }).getByRole('button', { name });

test("an unfinished daily Task is Skipped at midnight, listed in the banner, and today's Occurrence is open", async ({ page }) => {
  await page.goto('/?db=skip-daily');
  await type(page, '+ Task today', 'Water plants');
  await type(page, '+ Task today', 'Buy stamps');
  await page.getByRole('button', { name: 'Water plants', exact: true }).click();
  await page.getByRole('button', { name: 'Repeat…' }).click();
  await page.getByRole('button', { name: 'Start repeating' }).click(); // every 1 day, the default
  await expect(banner(page)).toHaveCount(0);

  await page.clock.setFixedTime(TUE_0000);
  await page.clock.runFor(61_000);

  await expect(page.getByRole('heading', { name: 'Tuesday 17 November' })).toBeVisible();
  await expect(banner(page)).toContainText('skipped');
  await expect(banner(page)).toContainText('Water plants');
  await expect(banner(page)).toContainText('carried over');
  // the plain Task was carried over (↪ first); today's own Occurrence is open and not marked as carried over
  await expect(anytime(page).getByRole('listitem')).toHaveText([/Buy stamps/, /Water plants/]);
  await expect(anytime(page).getByRole('listitem').first()).toContainText('↪');
  await expect(anytime(page).getByRole('listitem').nth(1)).not.toContainText('↪');
  await expect(page.getByTestId('anytime-count')).toHaveText('2');
});

test("a weekly Occurrence cannot be dragged onto its next Occurrence's day, but can be dragged before it", async ({ page }) => {
  await page.goto('/?db=skip-limit');
  await type(page, '+ Task today', 'Clean oven');
  await page.getByRole('button', { name: 'Clean oven', exact: true }).click();
  await page.getByRole('button', { name: 'Repeat…' }).click();
  await page.getByLabel('Repeat rule').selectOption('weekdays');
  await page.getByRole('button', { name: 'Mon', exact: true }).click();
  await page.getByRole('button', { name: 'Start repeating' }).click();
  const pill = anytime(page).getByRole('button', { name: 'Clean oven', exact: true });

  // next Monday is where its next Occurrence is: refused, it stays where it was
  await pill.dragTo(chip(page, /Monday 23 November/));
  await expect(anytime(page).getByRole('listitem')).toHaveText([/Clean oven/]);
  await expect(page.getByTestId('anytime-count')).toHaveText('1');

  // the Sunday before is fine
  await pill.dragTo(chip(page, /Sunday 22 November/));
  await expect(page.getByTestId('anytime-count')).toHaveText('0');
  await chip(page, /Sunday 22 November/).click();
  await expect(anytime(page).getByRole('listitem')).toHaveText([/Clean oven/]);
});
