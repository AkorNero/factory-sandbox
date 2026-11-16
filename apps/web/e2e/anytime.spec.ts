import { expect, test } from '@playwright/test';

// Fixed clock: Monday 16 November 2026, 10:15 in Berlin.
const NOW = new Date('2026-11-16T10:15:00+01:00');

test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: NOW });
});

test('opens on Today with an empty Anytime today', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Monday 16 November' })).toBeVisible();
  await expect(page.getByTestId('anytime-count')).toHaveText('0');
  await expect(page.getByRole('navigation', { name: 'Upcoming' }).locator('.chip')).toHaveCount(8);
});

test('typing a title into "+ Task today" adds an unplaced Task to Anytime today', async ({ page }) => {
  await page.goto('/');

  const field = page.getByPlaceholder('+ Task today');
  await field.fill('Buy stamps');
  await field.press('Enter');

  await expect(page.getByRole('listitem').filter({ hasText: 'Buy stamps' })).toBeVisible();
  await expect(page.getByTestId('anytime-count')).toHaveText('1');
  await expect(field).toBeFocused();
  await expect(field).toHaveValue('');

  // the strip's dot count for today follows
  await expect(page.getByRole('navigation', { name: 'Upcoming' }).locator('.chip').first()).toContainText('•');
});

test('the Task is still there after a reload (it lives in the local database)', async ({ page }) => {
  await page.goto('/?db=reload-test');
  await page.getByPlaceholder('+ Task today').fill('Call Ann');
  await page.getByPlaceholder('+ Task today').press('Enter');
  await expect(page.getByTestId('anytime-count')).toHaveText('1');

  await page.reload();

  await expect(page.getByRole('listitem').filter({ hasText: 'Call Ann' })).toBeVisible();
});

test('serves an installable manifest', async ({ request }) => {
  const res = await request.get('/manifest.webmanifest');
  expect(res.ok()).toBe(true);
  const manifest = await res.json();
  expect(manifest).toMatchObject({ name: 'Day Planner', display: 'standalone', start_url: '/' });
  expect(manifest.icons.map((i: { sizes: string }) => i.sizes)).toEqual(expect.arrayContaining(['192x192', '512x512']));
});
