import { expect, test, type Page } from '@playwright/test';

// Fixed clock: Monday 16 November 2026, 10:15 in Berlin. The time is frozen, so the Completion time is always 10:15.
const NOW = new Date('2026-11-16T10:15:00+01:00');

test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: NOW });
  await page.clock.setFixedTime(NOW);
});

async function addTasks(page: Page, ...titles: string[]) {
  const field = page.getByPlaceholder('+ Task today');
  for (const [i, title] of titles.entries()) {
    await field.fill(title);
    await field.press('Enter');
    // the list collapses after 6, so wait on the count rather than on the pill (each test starts on an empty database)
    await expect(page.getByTestId('anytime-count')).toHaveText(String(i + 1));
  }
}

const anytime = (page: Page) => page.getByRole('region', { name: /Anytime today/ });
const done = (page: Page) => page.getByRole('region', { name: /Done today/ });

test('ticking a Task moves it to Done today as its Completion time and moves the bar', async ({ page }) => {
  await page.goto('/?db=tick');
  await addTasks(page, 'Buy stamps', 'Call Ann');

  await page.getByRole('button', { name: 'Tick off Buy stamps' }).click();

  await expect(anytime(page).getByRole('listitem').filter({ hasText: 'Buy stamps' })).toHaveCount(0);
  await expect(page.getByTestId('anytime-count')).toHaveText('1');
  const chip = done(page).getByRole('listitem').first();
  await expect(chip).toContainText('10:15');
  await expect(chip).toContainText('Buy stamps');
  await expect(page.getByText('1 of 2 done')).toBeVisible();

  // greyed with a green tick, never struck through, and no chip says "done"
  await expect(chip).toHaveCSS('text-decoration-line', 'none');
  await expect(chip.locator('.label')).toHaveCSS('text-decoration-line', 'none');
  await expect(chip.locator('.tick')).toHaveClass(/on/);
  await expect(chip).not.toContainText(/done/i);
});

test('unticking returns the Task to Anytime today and clears the Completion time', async ({ page }) => {
  await page.goto('/?db=untick');
  await addTasks(page, 'Buy stamps');
  await page.getByRole('button', { name: 'Tick off Buy stamps' }).click();
  await expect(page.getByTestId('anytime-count')).toHaveText('0');

  await page.getByRole('button', { name: 'Untick Buy stamps' }).click();

  await expect(anytime(page).getByRole('listitem').filter({ hasText: 'Buy stamps' })).toBeVisible();
  await expect(page.getByTestId('anytime-count')).toHaveText('1');
  await expect(page.getByText('0 of 1 done')).toBeVisible();
  await expect(done(page).getByRole('listitem')).toHaveCount(0);
  const completed = await page.evaluate(async () => {
    const app = (window as unknown as { __app: { db: { getAll: (q: string) => Promise<{ completed_at: string | null }[]> } } }).__app;
    return (await app.db.getAll('SELECT completed_at FROM tasks'))[0]?.completed_at;
  });
  expect(completed).toBeNull();
});

test('the tap menu of a done item edits its Completion time and the chip follows', async ({ page }) => {
  await page.goto('/?db=edit-time');
  await addTasks(page, 'Buy stamps', 'Call Ann');
  await page.getByRole('button', { name: 'Tick off Buy stamps' }).click();
  await page.getByRole('button', { name: 'Tick off Call Ann' }).click();
  await expect(done(page).getByRole('listitem').first()).toContainText('Call Ann');

  await done(page).getByRole('button', { name: 'Buy stamps', exact: true }).click();
  await page.getByLabel('Completion time').fill('09:05');
  await page.getByRole('button', { name: 'Save' }).click();

  await expect(page.getByRole('dialog')).toHaveCount(0);
  const chips = done(page).getByRole('listitem');
  await expect(chips.nth(0)).toContainText('Call Ann');
  await expect(chips.nth(1)).toContainText('09:05');
  await expect(chips.nth(1)).toContainText('Buy stamps');
});

test('the tap menu renames a Task and deletes one', async ({ page }) => {
  await page.goto('/?db=rename-delete');
  await addTasks(page, 'Buy stmps', 'Call Ann');

  await anytime(page).getByRole('button', { name: 'Buy stmps', exact: true }).click();
  await expect(page.getByLabel('Completion time')).toHaveCount(0); // only done items have one
  await page.getByLabel('Title').fill('Buy stamps');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(anytime(page).getByRole('listitem').filter({ hasText: 'Buy stamps' })).toBeVisible();

  await anytime(page).getByRole('button', { name: 'Call Ann', exact: true }).click();
  await page.getByRole('button', { name: 'Delete' }).click();

  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('listitem').filter({ hasText: 'Call Ann' })).toHaveCount(0);
  await expect(page.getByTestId('anytime-count')).toHaveText('1');
});

test('Anytime today shows 6 and Done today shows 4, each with "+N more" / "Show less"', async ({ page }) => {
  await page.goto('/?db=collapse');
  await addTasks(page, 'T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8');

  await expect(anytime(page).locator('.pills > li').filter({ hasNot: page.locator('.more') })).toHaveCount(6);
  await anytime(page).getByRole('button', { name: '+2 more' }).click();
  await expect(anytime(page).getByRole('listitem').filter({ hasText: /^T\d/ })).toHaveCount(8);
  await anytime(page).getByRole('button', { name: 'Show less' }).click();
  await expect(anytime(page).getByRole('button', { name: '+2 more' })).toBeVisible();

  for (const t of ['T1', 'T2', 'T3', 'T4', 'T5', 'T6']) {
    await page.getByRole('button', { name: `Tick off ${t}` }).click();
  }
  await expect(page.getByText('6 of 8 done')).toBeVisible();
  await expect(done(page).locator('.pills > li').filter({ hasNot: page.locator('.more') })).toHaveCount(4);
  await done(page).getByRole('button', { name: '+2 more' }).click();
  await expect(done(page).getByRole('listitem').filter({ hasText: '10:15' })).toHaveCount(6);
  await done(page).getByRole('button', { name: 'Show less' }).click();
  await expect(done(page).getByRole('button', { name: '+2 more' })).toBeVisible();
});
