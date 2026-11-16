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
const addEvent = (page: Page, text: string) => type(page, '+ Event, e.g. Gym 18-19', text);
const addAnytime = async (page: Page, title: string, count: number) => {
  await type(page, '+ Task today', title);
  await expect(page.getByTestId('anytime-count')).toHaveText(String(count));
};

const anytime = (page: Page) => page.getByRole('region', { name: /Anytime today/ });
const now = (page: Page) => page.getByTestId('now');
const done = (page: Page) => page.getByRole('region', { name: /Done today/ });

test('the "+ …" field inside an Event card adds a Task placed there, not in Anytime today', async ({ page }) => {
  await addEvent(page, 'Deep work 10-11');
  await expect(now(page)).toContainText('Nothing placed');

  await type(page, '+ Task in Deep work', 'Write intro');
  await type(page, '+ Task in Deep work', 'Outline talk');

  await expect(now(page).getByRole('listitem')).toHaveText([/Write intro/, /Outline talk/]);
  await expect(page.getByPlaceholder('+ Task in Deep work')).toHaveValue(''); // ready for the next one
  await expect(page.getByTestId('anytime-count')).toHaveText('0');
  await expect(anytime(page).getByRole('listitem')).toHaveCount(0);
  await expect(now(page)).not.toContainText('Nothing placed');
});

test('dragging a Task from Anytime onto an Event places it; "Take out of" puts it back in Anytime', async ({ page }) => {
  await addEvent(page, 'Deep work 10-11');
  await addAnytime(page, 'Buy stamps', 1);

  await anytime(page).getByRole('button', { name: 'Buy stamps', exact: true }).dragTo(page.getByTestId('now-card'));

  await expect(now(page).getByRole('listitem')).toHaveText([/Buy stamps/]);
  await expect(page.getByTestId('anytime-count')).toHaveText('0');
  await expect(page.locator('.toast')).toContainText('Placed “Buy stamps” in Deep work');

  await now(page).getByRole('button', { name: 'Buy stamps', exact: true }).click();
  await page.getByRole('button', { name: 'Take out of Deep work' }).click();

  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(anytime(page).getByRole('listitem').filter({ hasText: 'Buy stamps' })).toBeVisible();
  await expect(page.getByTestId('anytime-count')).toHaveText('1');
  await expect(now(page).getByRole('listitem')).toHaveCount(0);
});

test('a Task done in its Event reads "10:15 · Deep work" in Done today', async ({ page }) => {
  await addEvent(page, 'Deep work 10-11');
  await type(page, '+ Task in Deep work', 'Write intro');

  await now(page).getByRole('button', { name: 'Tick off Write intro' }).click();

  const chip = done(page).getByRole('listitem').first();
  await expect(chip).toContainText('10:15 · Deep work');
  await expect(chip).toContainText('Write intro');
  await expect(now(page).getByRole('listitem')).toContainText('Write intro'); // still in the card, greyed
});

test('an Event that ended with unfinished Tasks shows "1/3 done" and "slot missed"; deleting it leaves the Tasks unplaced', async ({
  page,
}) => {
  await addEvent(page, 'Admin 8-9');
  await page.getByRole('tab', { name: /Earlier today/ }).click();
  const row = page.getByTestId('tab-panel').locator('.ev-row');
  for (const title of ['Invoices', 'Emails', 'Filing']) {
    await type(page, '+ Task today', title);
    await expect(anytime(page).getByRole('button', { name: title, exact: true })).toBeVisible();
    await anytime(page).getByRole('button', { name: title, exact: true }).dragTo(row); // placing into a past Event is allowed
    await expect(row.getByRole('listitem').filter({ hasText: title })).toBeVisible();
  }
  await row.getByRole('button', { name: 'Tick off Invoices' }).click();

  await expect(row.locator('.rel')).toHaveText('1/3 done · slot missed');
  await expect(row.locator('.rel')).toHaveCSS('color', 'rgb(181, 86, 13)'); // orange (--warn)
  await expect(row.getByRole('listitem')).toHaveCount(3);

  await row.getByRole('button', { name: 'Admin' }).click();
  await page.getByRole('button', { name: 'Delete' }).click();

  await expect(page.getByTestId('tab-panel').locator('.ev-row')).toHaveCount(0);
  await expect(page.getByTestId('anytime-count')).toHaveText('2'); // Emails and Filing; Invoices was ticked
  await expect(done(page)).toContainText('Invoices');
});

test('press and hold starts a drag on a touch screen; moving first scrolls instead', async ({ page, browserName, isMobile }) => {
  test.skip(!isMobile || browserName !== 'chromium', 'touch only');
  await addEvent(page, 'Deep work 10-11');
  await addAnytime(page, 'Buy stamps', 1);
  const pill = anytime(page).getByRole('button', { name: 'Buy stamps', exact: true });
  const from = (await pill.boundingBox())!;
  const to = (await page.getByTestId('now-card').boundingBox())!;
  const start = { x: from.x + from.width / 2, y: from.y + from.height / 2 };
  const end = { x: to.x + to.width / 2, y: to.y + to.height / 2 };

  const cdp = await page.context().newCDPSession(page);
  const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', p: { x: number; y: number } | null) =>
    cdp.send('Input.dispatchTouchEvent', { type, touchPoints: p ? [{ ...p, id: 1 }] : [] });

  // a quick swipe is a scroll: no drag, nothing placed
  await touch('touchStart', start);
  await touch('touchMove', { x: start.x, y: start.y + 40 });
  await touch('touchEnd', null);
  await expect(page.locator('.ghost')).toHaveCount(0);
  await expect(now(page).getByRole('listitem')).toHaveCount(0);

  // press and hold, then drag onto the Event card
  await touch('touchStart', start);
  await page.waitForTimeout(600);
  await touch('touchMove', { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 });
  await touch('touchMove', end);
  await expect(page.locator('.ghost')).toHaveCount(1);
  await touch('touchEnd', null);

  await expect(now(page).getByRole('listitem')).toHaveText([/Buy stamps/]);
  await expect(page.getByTestId('anytime-count')).toHaveText('0');
});
