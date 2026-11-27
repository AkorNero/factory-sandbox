import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import { migrate } from '../src/migrate.ts';

/**
 * Seam 2 runs against a real Postgres in docker, built by the same migrations production runs.
 * One container for the whole run; tests truncate between cases.
 */
let container: StartedPostgreSqlContainer | undefined;

export default async function setup() {
  container = await new PostgreSqlContainer('postgres:17').start();
  const pool = new pg.Pool({ connectionString: container.getConnectionUri() });
  await migrate(pool);
  await pool.end();
  process.env.TEST_DATABASE_URL = container.getConnectionUri();
  return async () => {
    await container?.stop();
  };
}
