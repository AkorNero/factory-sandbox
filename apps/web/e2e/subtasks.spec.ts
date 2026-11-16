import { expect, test, type Page } from '@playwright/test';

// Fixed clock: Monday 16 November 2026, 10:15 in Berlin. The rules are unit-tested in the core;
// these tests only check that the menu, the ticks and the screen reach them.
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

const anytime = (page: Page) => page.getByRole('region', { name: /Anytime today/ });
const done = (page: Page) => page.getByRole('region', { name: /Done today/ });
const panel = (page: Page) => page.getByTestId('tab-panel');
const somedayTab = (page: Page) => page.getByRole('tab', { name: /Someday/ });
const somedayCount = (page: Page) => somedayTab(page).locator('.tabcount');

test('"+ Sub-task" in a Task\'s menu adds Sub-tasks, shown as "Parent › Sub-task" in place of the parent', async ({ page }) => {
  await page.goto('/?db=sub-add');
  await type(page, '+ Task today', 'Report');
  await page.getByRole('button', { name: 'Report', exact: true }).click();

  await type(page, '+ Sub-task', 'Draft intro');
  await type(page, '+ Sub-task', 'Proofread');
  await page.getByRole('button', { name: 'Cancel' }).click();

  await expect(anytime(page).getByRole('listitem')).toHaveText([/Report › Draft intro/, /Report › Proofread/]);
  await expect(page.getByTestId('anytime-count')).toHaveText('2');

  // a Sub-task's menu offers no Sub-tasks of its own, only another one for its parent
  await page.getByRole('button', { name: 'Report › Draft intro', exact: true }).click();
  await expect(page.getByPlaceholder('+ Sub-task', { exact: true })).toHaveCount(0);
  await expect(page.getByPlaceholder('+ Sub-task of Report')).toBeVisible();
});

test('tapping "Parent ›" on a Sub-task opens the parent Task\'s own menu: rename it, or delete it with its Sub-tasks', async ({ page }) => {
  await page.goto('/?db=sub-parent-menu');
  await type(page, '+ Task today', 'Report');
  await page.getByRole('button', { name: 'Report', exact: true }).click();
  await type(page, '+ Sub-task', 'Draft intro');
  await page.getByRole('button', { name: 'Cancel' }).click();

  await anytime(page).getByRole('button', { name: 'Open Report' }).click();
  const menu = page.getByRole('dialog', { name: 'Edit task' });
  await expect(menu.getByLabel('Title')).toHaveValue('Report');
  await menu.getByLabel('Title').fill('Quarterly report');
  await menu.getByRole('button', { name: 'Save' }).click();
  await expect(anytime(page).getByRole('listitem')).toHaveText([/Quarterly report › Draft intro/]);

  await anytime(page).getByRole('button', { name: 'Open Quarterly report' }).click();
  await menu.getByRole('button', { name: 'Delete' }).click();

  await expect(page.getByTestId('anytime-count')).toHaveText('0');
});

test('the first Sub-task of a placed Task takes over its Placement', async ({ page }) => {
  await page.goto('/?db=sub-place');
  await type(page, '+ Event, e.g. Gym 18-19', 'Deep work 10-11');
  await type(page, '+ Task in Deep work', 'Report');
  const now = page.getByTestId('now');
  await expect(now.getByRole('listitem')).toHaveText([/Report/]);

  await now.getByRole('button', { name: 'Report', exact: true }).click();
  await type(page, '+ Sub-task', 'Draft intro');
  await page.getByRole('button', { name: 'Cancel' }).click();

  await expect(now.getByRole('listitem')).toHaveText([/Report › Draft intro/]);
  await expect(page.getByTestId('anytime-count')).toHaveText('0');

  // a second one is not placed
  await now.getByRole('button', { name: 'Report › Draft intro', exact: true }).click();
  await type(page, '+ Sub-task of Report', 'Proofread');
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(anytime(page).getByRole('listitem')).toHaveText([/Report › Proofread/]);
});

test('ticking the last Sub-task finishes the Task; "Tick all" in the menu ticks the rest with one time', async ({ page }) => {
  await page.goto('/?db=sub-tick');
  await type(page, '+ Task today', 'Report');
  await page.getByRole('button', { name: 'Report', exact: true }).click();
  await type(page, '+ Sub-task', 'Draft intro');
  await type(page, '+ Sub-task', 'Proofread');
  await page.getByRole('button', { name: 'Cancel' }).click();

  await page.getByRole('button', { name: 'Tick off Report › Draft intro' }).click();
  await expect(page.getByTestId('anytime-count')).toHaveText('1');
  await expect(page.getByText('1 of 2 done')).toBeVisible();

  // unticking reopens it
  await page.getByRole('button', { name: 'Untick Report › Draft intro' }).click();
  await expect(page.getByTestId('anytime-count')).toHaveText('2');

  await page.getByRole('button', { name: 'Report › Proofread', exact: true }).click();
  await page.getByRole('button', { name: 'Tick all of “Report”' }).click();

  await expect(page.getByTestId('anytime-count')).toHaveText('0');
  // both with the same Completion time (their order is not defined)
  await expect(done(page).getByRole('listitem')).toHaveCount(2);
  await expect(done(page).getByRole('listitem').filter({ hasText: 'Report › Draft intro' })).toContainText('10:15');
  await expect(done(page).getByRole('listitem').filter({ hasText: 'Report › Proofread' })).toContainText('10:15');
  await expect(page.getByText('2 of 2 done')).toBeVisible();
});

test('ticking a Task in Someday dates it to today, so it shows in Done today', async ({ page }) => {
  await page.goto('/?db=sub-someday');
  await somedayTab(page).click();
  await type(page, '+ Someday Task', 'Learn Welsh');
  await expect(somedayCount(page)).toHaveText('1');

  await panel(page).getByRole('button', { name: 'Tick off Learn Welsh' }).click();

  await expect(somedayCount(page)).toHaveText('0');
  await expect(done(page).getByRole('listitem')).toHaveText([/Learn Welsh.*10:15/]);
  await expect(page.getByText('1 of 1 done')).toBeVisible();
});

test('a Someday Task with a Sub-task placed in an Event stays in Someday, with its progress; ticking it dates it', async ({
  page,
}) => {
  await page.goto('/?db=sub-someday-parent');
  await type(page, '+ Event, e.g. Gym 18-19', 'Deep work 10-11');
  await somedayTab(page).click();
  await type(page, '+ Someday Task', 'Paint shed');
  await panel(page).getByRole('button', { name: 'Paint shed', exact: true }).click();
  await type(page, '+ Sub-task', 'Buy paint');
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(panel(page).getByRole('listitem')).toHaveText([/Paint shed.*0\/1/]);

  // the Sub-task is on no day until it is placed
  await expect(page.getByTestId('anytime-count')).toHaveText('0');
  await page.getByRole('button', { name: 'Paint shed', exact: true }).click();
  await page.getByRole('button', { name: 'Cancel' }).click();

  await panel(page).getByRole('button', { name: 'Tick off Paint shed' }).click();

  await expect(somedayCount(page)).toHaveText('0');
  await expect(done(page).getByRole('listitem')).toHaveText([/Paint shed › Buy paint.*10:15/]);
});
