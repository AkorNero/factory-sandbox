import { expect, test, type Browser, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';

const COMPOSE_FILE = new URL('../../../infra/compose.yaml', import.meta.url).pathname;

/** What Postgres holds right now: asks the compose project's database container. */
function titlesInPostgres(): string[] {
  const out = execFileSync(
    'docker',
    ['compose', '-p', process.env.COMPOSE_PROJECT_NAME ?? 'dayplanner', '-f', COMPOSE_FILE, 'exec', '-T', 'postgres', 'psql', '-U', 'postgres', '-d', 'dayplanner', '-At', '-c', 'SELECT title FROM tasks'],
    { encoding: 'utf8' },
  );
  return out.split('\n').filter(Boolean);
}

async function newDevice(browser: Browser): Promise<{ page: Page; setOffline: (v: boolean) => Promise<void> }> {
  const context = await browser.newContext(); // own storage, so its own local database and device id
  const page = await context.newPage();
  await page.goto('/');
  // a device JWT with no login screen: the page reaches "Synced" without anyone signing in
  await expect(page.getByTestId('sync-status')).toHaveText('Synced', { timeout: 30_000 });
  return { page, setOffline: (v) => context.setOffline(v) };
}

const add = async (page: Page, title: string) => {
  await page.getByPlaceholder('+ Task today').fill(title);
  await page.getByPlaceholder('+ Task today').press('Enter');
};
const seen = (page: Page, title: string) => expect(page.getByRole('listitem').filter({ hasText: title })).toBeVisible({ timeout: 20_000 });

test('a Task added on one device appears on the other within seconds', async ({ browser }) => {
  const phone = await newDevice(browser);
  const desktop = await newDevice(browser);
  const title = `Sync ${Date.now()}`;

  await add(phone.page, title);

  await seen(desktop.page, title);
  expect(titlesInPostgres()).toContain(title);
});

test('a Task added while offline reaches Postgres and the other device after reconnecting', async ({ browser }) => {
  const phone = await newDevice(browser);
  const desktop = await newDevice(browser);
  const title = `Offline ${Date.now()}`;

  await phone.setOffline(true);
  await add(phone.page, title);
  await seen(phone.page, title); // local database first
  await phone.page.waitForTimeout(3_000); // time enough for an upload, were it not offline
  expect(titlesInPostgres()).not.toContain(title);

  await phone.setOffline(false);

  await seen(desktop.page, title);
  expect(titlesInPostgres()).toContain(title);
});
