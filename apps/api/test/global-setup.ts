import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { readFileSync } from 'node:fs';
import pg from 'pg';

/**
 * Seam 2 runs against a real Postgres in docker, loaded with the same DDL production uses.
 * One container for the whole run; tests truncate between cases.
 */
let container: StartedPostgreSqlContainer | undefined;

export default async function setup() {
  container = await new PostgreSqlContainer('postgres:17').start();
  const ddl = readFileSync(new URL('../../../infra/postgres/init/02-schema.sql', import.meta.url), 'utf8');
  const client = new pg.Client({ connectionString: container.getConnectionUri() });
  await client.connect();
  await client.query(ddl);
  await client.end();
  process.env.TEST_DATABASE_URL = container.getConnectionUri();
  return async () => {
    await container?.stop();
  };
}
