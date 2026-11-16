import { PowerSyncDatabase } from '@powersync/web';
import { Connector } from './connector.ts';
import { AppSchema } from './schema.ts';

/** The local SQLite database. Every read and write goes here first. */
export const db = new PowerSyncDatabase({
  schema: AppSchema,
  // tests pick their own file via ?db=… so a run never sees another run's data
  database: { dbFilename: new URLSearchParams(location.search).get('db') ?? 'dayplanner.db' },
});

/** Start syncing. Does not block: the local database is usable immediately, online or not. */
export function startSync() {
  if (import.meta.env.VITE_SYNC === 'off') return;
  void db.connect(new Connector());
}
