import { expect, test, type Page } from '@playwright/test';

// Fixed clock: Monday 16 November 2026, 10:15 in Berlin. The rules are unit-tested in the core;
// these tests only check that the screen reaches them.
const NOW = new Date('2026-11-16T10:15:00+01:00');

test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: NOW });
  await page.goto('/');
});

async function addEvent(page: Page, text: string) {
  const field = page.getByPlaceholder('+ Event, e.g. Gym 18-19');
  await field.fill(text);
  await field.press('Enter');
}

test('with no Events, Now says Free and both tabs are empty', async ({ page }) => {
  await expect(page.getByTestId('now')).toContainText('Free');
  await expect(page.getByRole('tab', { name: /Later today/ })).toContainText('0');
  await expect(page.getByRole('tab', { name: /Earlier today/ })).toContainText('0');
});

test('typing "Gym 18-19" at the end of Later today makes an Event: Next shows it, Later today lists the rest', async ({ page }) => {
  await addEvent(page, 'Gym 18-19');
  await expect(page.getByPlaceholder('+ Event, e.g. Gym 18-19')).toHaveValue('');
  await addEvent(page, 'Dinner 20:30-21:15');

  const next = page.getByTestId('next');
  await expect(next).toContainText('Gym');
  await expect(next).toContainText('in 7h 45m');

  await expect(page.getByRole('tab', { name: /Later today/ })).toContainText('1');
  const later = page.getByTestId('tab-panel');
  await expect(later).toContainText('Dinner');
  await expect(later).toContainText('20:30–21:15');
  await expect(later).toContainText('in 10h 15m');
});

test('an Event without a time, or one that ends before it starts, is refused with a message', async ({ page }) => {
  await addEvent(page, 'Gym');
  await expect(page.getByRole('alert')).toContainText('Gym 18-19');
  await expect(page.getByPlaceholder('+ Event, e.g. Gym 18-19')).toHaveValue('Gym'); // kept, so it can be fixed

  await addEvent(page, 'Gym 19-18');
  await expect(page.getByRole('alert')).toContainText('end after it starts');
  await expect(page.getByTestId('now')).toContainText('Free');
  await expect(page.getByTestId('next')).toHaveCount(0);
});

test('a live Event shows on Now with its time range, time left and a progress bar', async ({ page }) => {
  await addEvent(page, 'Deep work 10-11');

  const now = page.getByTestId('now');
  await expect(now).toContainText('Deep work');
  await expect(now).toContainText('10:00–11:00');
  await expect(now).toContainText('45 min left');
  await expect(now.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '25');
});

test('two live Events read "2 Events at once": the latest start leads, the other is "Also now"', async ({ page }) => {
  await addEvent(page, 'Deep work 10-11');
  await addEvent(page, 'Call 10:10-10:45');

  const now = page.getByTestId('now');
  await expect(now).toContainText('2 Events at once');
  const cards = now.locator('[data-testid="now-card"]');
  await expect(cards).toHaveCount(2);
  await expect(cards.first()).toContainText('Call');
  await expect(cards.nth(1)).toContainText('Deep work');
  await expect(cards.nth(1)).toContainText('Also now');

  // side by side on desktop, stacked on a phone
  const [a, b] = await Promise.all([cards.first().boundingBox(), cards.nth(1).boundingBox()]);
  const phone = page.viewportSize()!.width < 500;
  if (phone) expect(b!.y).toBeGreaterThan(a!.y + a!.height - 1);
  else expect(b!.x).toBeGreaterThan(a!.x + a!.width - 1);
});

test('Earlier today lists finished Events with their duration and "ended … ago"', async ({ page }) => {
  await addEvent(page, 'Standup 8-9:15');

  const tab = page.getByRole('tab', { name: /Earlier today/ });
  await expect(tab).toContainText('1');
  await tab.click();
  const panel = page.getByTestId('tab-panel');
  await expect(panel).toContainText('Standup');
  await expect(panel).toContainText('08:00–09:15');
  await expect(panel).toContainText('1h 15m');
  await expect(panel).toContainText('ended 1h ago');
});

test('the tap menu renames and retimes an Event, so it moves between Next and Now, and deletes it', async ({ page }) => {
  await addEvent(page, 'Gym 18-19');
  await expect(page.getByTestId('next')).toContainText('Gym');

  await page.getByTestId('next').getByRole('button', { name: /Gym/ }).click();
  const menu = page.getByRole('dialog', { name: 'Edit Event' });
  await menu.getByLabel('Name').fill('Climbing');
  await menu.getByLabel('Start').fill('10:00');
  await menu.getByLabel('End').fill('11:00');
  await menu.getByRole('button', { name: 'Save' }).click();

  await expect(menu).toBeHidden();
  await expect(page.getByTestId('now')).toContainText('Climbing');
  await expect(page.getByTestId('next')).toHaveCount(0);

  await page.getByTestId('now').getByRole('button', { name: /Climbing/ }).click();
  await menu.getByLabel('End').fill('09:00');
  await menu.getByRole('button', { name: 'Save' }).click();
  await expect(menu.getByRole('alert')).toContainText('end after it starts');
  await menu.getByRole('button', { name: 'Delete' }).click();

  await expect(menu).toBeHidden();
  await expect(page.getByTestId('now')).toContainText('Free');
});

test('every Event card has a "+ Task in …" field: Later today and Earlier today too, not only Now and Next', async ({ page }) => {
  await addEvent(page, 'Gym 18-19');
  await addEvent(page, 'Dinner 20:30-21:15');
  await addEvent(page, 'Standup 8-9:15');

  // Gym is Next, so Dinner is the one in Later today
  const field = page.getByPlaceholder('+ Task in Dinner');
  await field.fill('Book a table');
  await field.press('Enter');
  await expect(page.getByTestId('tab-panel')).toContainText('Book a table');
  await expect(page.getByTestId('anytime-count')).toHaveText('0'); // placed, so not in Anytime

  await page.getByRole('tab', { name: /Earlier today/ }).click();
  const earlier = page.getByPlaceholder('+ Task in Standup');
  await earlier.fill('Write notes');
  await earlier.press('Enter');
  await expect(page.getByTestId('tab-panel')).toContainText('Write notes');
});
