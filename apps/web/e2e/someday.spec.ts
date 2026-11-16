import { expect, test, type Page } from '@playwright/test';

// Fixed clock: Monday 16 November 2026, 10:15 in Berlin. The rules are unit-tested in the core;
// these tests only check that the "+ …" field, the drag and the menu reach them.
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

const anytime = (page: Page) => page.getByRole('region', { name: /Anytime today/ });
const panel = (page: Page) => page.getByTestId('tab-panel');
const somedayTab = (page: Page) => page.getByRole('tab', { name: /Someday/ });
const somedayCount = (page: Page) => somedayTab(page).locator('.tabcount');
const todayDots = (page: Page) => page.locator('.strip .chip').first().locator('.dots');

test('the Someday tab lists undated Tasks, set apart from the day; "+ …" adds one', async ({ page }) => {
  await expect(somedayCount(page)).toHaveText('0');

  await somedayTab(page).click();
  await expect(somedayTab(page)).toHaveCSS('font-style', 'italic');
  await expect(panel(page)).toContainText('Tasks with no date');
  await expect(panel(page)).toHaveCSS('border-top-style', 'dashed');

  await type(page, '+ Someday Task', 'Learn Welsh');
  await type(page, '+ Someday Task', 'Paint shed');

  await expect(panel(page).getByRole('listitem')).toHaveText([/Learn Welsh/, /Paint shed/]);
  await expect(page.getByPlaceholder('+ Someday Task')).toHaveValue('');
  await expect(somedayCount(page)).toHaveText('2');
  // never in Today or in the strip
  await expect(page.getByTestId('anytime-count')).toHaveText('0');
  await expect(todayDots(page)).toHaveAttribute('aria-label', '0 events, 0 tasks');
});

test('dragging a Task onto the Someday tab removes its date and Placement; "Do today" brings it back to Anytime', async ({
  page,
}) => {
  await type(page, '+ Event, e.g. Gym 18-19', 'Deep work 10-11');
  await type(page, '+ Task in Deep work', 'Write intro');
  await type(page, '+ Task today', 'Buy stamps');
  await expect(page.getByTestId('anytime-count')).toHaveText('1');

  // an Unplaced Task from Anytime
  await anytime(page).getByRole('button', { name: 'Buy stamps', exact: true }).dragTo(somedayTab(page));
  await expect(page.getByTestId('anytime-count')).toHaveText('0');
  await expect(somedayCount(page)).toHaveText('1');
  await expect(page.locator('.toast')).toContainText('Sent “Buy stamps” to Someday');

  // a placed Task from its Event card
  await page.getByTestId('now').getByRole('button', { name: 'Write intro', exact: true }).dragTo(somedayTab(page));
  await expect(page.getByTestId('now').getByRole('listitem')).toHaveCount(0);
  await expect(somedayCount(page)).toHaveText('2');
  await expect(todayDots(page)).toHaveAttribute('aria-label', '1 events, 0 tasks');

  await somedayTab(page).click();
  await panel(page).getByRole('button', { name: 'Buy stamps', exact: true }).click();
  await page.getByRole('button', { name: 'Do today' }).click();

  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(anytime(page).getByRole('listitem')).toHaveText([/Buy stamps/]);
  await expect(page.getByTestId('anytime-count')).toHaveText('1');
  await expect(somedayCount(page)).toHaveText('1');
  await expect(todayDots(page)).toHaveAttribute('aria-label', '1 events, 1 tasks');
});

test('"Send to Someday" in a Task\'s menu undates it', async ({ page }) => {
  await type(page, '+ Task today', 'Buy stamps');
  await anytime(page).getByRole('button', { name: 'Buy stamps', exact: true }).click();

  await page.getByRole('button', { name: 'Send to Someday' }).click();

  await expect(page.getByTestId('anytime-count')).toHaveText('0');
  await expect(somedayCount(page)).toHaveText('1');
});
