import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

/**
 * Schema migrations: numbered SQL files in apps/api/migrations, applied in name order, each in its own transaction and
 * recorded in schema_migrations. The files are written to be re-runnable (IF NOT EXISTS), so a database that was made
 * before migrations existed (the #28 volume) is adopted by running them: the first one finds its tables already there.
 * Postgres's init scripts only run on an empty volume, so this is the only thing that changes the schema afterwards.
 */
export const MIGRATIONS_DIR = fileURLToPath(new URL('../migrations/', import.meta.url));

/** Any number; held for the whole run so two starts at once do not race. */
const LOCK_ID = 7_281_428;

/** Apply the migrations that are not recorded yet. Returns the names it applied. */
export async function migrate(pool: pg.Pool, dir: string = MIGRATIONS_DIR): Promise<string[]> {
  const files = readdirSync(dir)
    .filter((f) => /^\d{4}_.+\.sql$/.test(f))
    .sort();
  const client = await pool.connect();
  const applied: string[] = [];
  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_ID]);
    await client.query(
      'CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())',
    );
    const done = new Set((await client.query<{ name: string }>('SELECT name FROM schema_migrations')).rows.map((r) => r.name));
    for (const file of files) {
      if (done.has(file)) continue;
      try {
        await client.query('BEGIN');
        await client.query(readFileSync(join(dir, file), 'utf8'));
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw new Error(`migration ${file} failed: ${(err as Error).message}`, { cause: err });
      }
      applied.push(file);
    }
    return applied;
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_ID]).catch(() => {});
    client.release();
  }
}

/** `node src/migrate.ts`: the compose project runs this once before the API starts, as the database owner. */
async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  const pool = new pg.Pool({ connectionString: url, max: 1 });
  try {
    const applied = await migrate(pool);
    console.log(applied.length ? `applied ${applied.join(', ')}` : 'schema up to date');
  } finally {
    await pool.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
