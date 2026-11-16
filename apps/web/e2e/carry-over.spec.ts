import { expect, test, type Page } from '@playwright/test';

// Fixed clock: Monday 16 November 2026, 23:58 in Berlin. The rules are unit-tested in the core; these tests only
// check that the clock fires the midnight job and that the banner and Anytime show the result.
const MON_2358 = new Date('2026-11-16T23:58:00+01:00');
const TUE_0000 = new Date('2026-11-17T00:00:00+01:00');
const THU_0830 = new Date('2026-11-19T08:30:00+01:00');

test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: MON_2358 });
  await page.clock.setFixedTime(MON_2358);
});

async function type(page: Page, placeholder: string, text: string) {
  const field = page.getByPlaceholder(placeholder);
  await field.fill(text);
  await field.press('Enter');
}

const anytime = (page: Page) => page.getByRole('region', { name: /Anytime today/ });
const banner = (page: Page) => page.getByRole('region', { name: 'Overnight' });
const somedayTab = (page: Page) => page.getByRole('tab', { name: /Someday/ });

test('at local midnight unfinished Tasks move to the new day, with a banner and a ↪ badge', async ({ page }) => {
  await page.goto('/?db=carry-midnight');
  await type(page, '+ Task today', 'Write report');
  await type(page, '+ Task today', 'Buy stamps');
  await page.getByRole('button', { name: 'Tick off Buy stamps' }).click();
  await expect(page.getByRole('region', { name: /Done today/ })).toContainText('1 of 2 done');
  await expect(banner(page)).toHaveCount(0);

  await page.clock.setFixedTime(TUE_0000);
  await page.clock.runFor(61_000);

  await expect(page.getByRole('heading', { name: 'Tuesday 17 November' })).toBeVisible();
  await expect(banner(page)).toContainText('carried over');
  await expect(banner(page)).toContainText('Write report');
  await expect(banner(page)).not.toContainText('Buy stamps');
  await expect(anytime(page).getByRole('listitem')).toHaveText([/Write report/]);
  await expect(anytime(page).getByRole('listitem').first()).toContainText('↪');

  await banner(page).getByRole('button', { name: 'Dismiss overnight banner' }).click();
  await expect(banner(page)).toHaveCount(0);
});

test('Someday Tasks stay in Someday through midnight', async ({ page }) => {
  await page.goto('/?db=carry-someday');
  await somedayTab(page).click();
  await type(page, '+ Someday Task', 'Learn piano');

  await page.clock.setFixedTime(TUE_0000);
  await page.clock.runFor(61_000);

  await expect(page.getByRole('heading', { name: 'Tuesday 17 November' })).toBeVisible();
  await expect(banner(page)).toHaveCount(0);
  await expect(somedayTab(page).locator('.tabcount')).toHaveText('1');
});

test('opening the app after missing several midnights moves unfinished items from all those days to today', async ({ page }) => {
  await page.goto('/?db=carry-missed');
  await type(page, '+ Task today', 'From Monday');
  await page.getByRole('navigation', { name: 'Upcoming' }).locator('.chip').nth(1).click();
  await type(page, '+ Task on Tue', 'From Tuesday');
  await expect(page.getByRole('listitem').filter({ hasText: 'From Tuesday' })).toBeVisible();

  // the app is closed over Tuesday, Wednesday and Thursday's midnights and opened on Thursday morning
  await page.clock.setFixedTime(THU_0830);
  await page.reload();

  await expect(page.getByRole('heading', { name: 'Thursday 19 November' })).toBeVisible();
  await expect(anytime(page).getByRole('listitem')).toHaveText([/From Monday/, /From Tuesday/]);
  await expect(anytime(page).getByRole('listitem').first()).toContainText('↪');
  await expect(banner(page)).toContainText('From Monday');
  await expect(banner(page)).toContainText('From Tuesday');
});

test('a long overnight list collapses behind "+N more"', async ({ page }) => {
  await page.goto('/?db=carry-long');
  for (let i = 1; i <= 8; i++) await type(page, '+ Task today', `Chore ${i}`);
  await expect(page.getByTestId('anytime-count')).toHaveText('8');

  await page.clock.setFixedTime(TUE_0000);
  await page.clock.runFor(61_000);

  await expect(banner(page).getByRole('button', { name: '+3 more' })).toBeVisible();
  await expect(banner(page)).not.toContainText('Chore 8');
  await banner(page).getByRole('button', { name: '+3 more' }).click();
  await expect(banner(page)).toContainText('Chore 8');
});
