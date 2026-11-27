import { SCHEMA } from '@dayplanner/core';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildServer } from '../src/server.ts';
import { generateKey } from '../src/auth.ts';
import { migrate } from '../src/migrate.ts';
import { taskRow, upload } from './support.ts';

/**
 * Schema migrations against a real Postgres. "Fresh" is an empty database that the migrations build; "upgraded" is a
 * database made from the schema as ticket #28 shipped it (the live volume's schema, before Carry-over added columns),
 * holding data, which the migrations must bring up to date without losing a row.
 */
const LEGACY = readFileSync(new URL('./fixtures/schema-28.sql', import.meta.url), 'utf8');

let admin: pg.Pool;
const pools: pg.Pool[] = [];

function poolFor(database: string): pg.Pool {
  const url = new URL(process.env.TEST_DATABASE_URL!);
  url.pathname = `/${database}`;
  const pool = new pg.Pool({ connectionString: url.toString() });
  pools.push(pool);
  return pool;
}

async function newDatabase(name: string): Promise<pg.Pool> {
  await admin.query(`DROP DATABASE IF EXISTS ${name}`);
  await admin.query(`CREATE DATABASE ${name}`);
  return poolFor(name);
}

/** Everything about the tables a client or the API could observe, independent of column order. */
async function shape(pool: pg.Pool) {
  const columns = await pool.query(
    `SELECT table_name, column_name, data_type, udt_name, is_nullable, column_default
       FROM information_schema.columns WHERE table_schema = 'public' ORDER BY table_name, column_name`,
  );
  const indexes = await pool.query(`SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' ORDER BY indexname`);
  const constraints = await pool.query(
    `SELECT conrelid::regclass::text AS table_name, conname, pg_get_constraintdef(oid) AS def
       FROM pg_constraint WHERE connamespace = 'public'::regnamespace ORDER BY 1, 2`,
  );
  return { columns: columns.rows, indexes: indexes.rows, constraints: constraints.rows };
}

beforeAll(() => {
  admin = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL });
});
afterAll(async () => {
  await Promise.all(pools.map((p) => p.end()));
  await admin.end();
});

describe('migrations', () => {
  it('build every table on an empty database, and a second run changes nothing', async () => {
    const pool = await newDatabase('mig_fresh');

    const first = await migrate(pool);
    const before = await shape(pool);
    const second = await migrate(pool);

    expect(first.length).toBeGreaterThan(0);
    expect(second).toEqual([]);
    expect(await shape(pool)).toEqual(before);
    expect(before.columns.map((c) => c.table_name)).toContain('tasks');
  });

  it('bring a database made from the #28 schema up to date without losing data, and leave it identical to a fresh one', async () => {
    const old = await newDatabase('mig_upgraded');
    await old.query(LEGACY);
    await old.query(`INSERT INTO events (id, title, date, start_time, end_time, created_at, updated_at)
                     VALUES ('e1', 'Gym', '2026-11-16', '18:00', '19:00', 'x', 'x')`);
    await old.query(`INSERT INTO tasks (id, title, date, event_id, carried_over, position, created_at, updated_at)
                     VALUES ('t1', 'Buy stamps', '2026-11-16', 'e1', true, 3, 'x', 'x'), ('t2', 'Someday thing', NULL, NULL, false, 4, 'x', 'x')`);
    await old.query(`INSERT INTO series (id, lineage_id, kind, rule, interval_n, anchor_date, starts_on, template, created_at, updated_at)
                     VALUES ('s1', 's1', 'task', 'every_n_days', 2, '2026-11-16', '2026-11-16', '{"title":"Water"}', 'x', 'x')`);
    await old.query(`INSERT INTO routines (id, name, body, created_at, updated_at) VALUES ('r1', 'Morning', '{"events":[]}', 'x', 'x')`);

    const applied = await migrate(old);

    expect(applied.length).toBeGreaterThan(0);
    const { rows } = await old.query('SELECT id, title, event_id, carried_over, position, carried_on, carried_from_event_id FROM tasks ORDER BY id');
    expect(rows).toEqual([
      { id: 't1', title: 'Buy stamps', event_id: 'e1', carried_over: true, position: 3, carried_on: null, carried_from_event_id: null },
      { id: 't2', title: 'Someday thing', event_id: null, carried_over: false, position: 4, carried_on: null, carried_from_event_id: null },
    ]);
    expect((await old.query('SELECT title FROM events')).rows).toEqual([{ title: 'Gym' }]);
    expect((await old.query('SELECT template FROM series')).rows).toEqual([{ template: { title: 'Water' } }]);
    expect((await old.query('SELECT name FROM routines')).rows).toEqual([{ name: 'Morning' }]);

    const fresh = await newDatabase('mig_fresh_twin');
    await migrate(fresh);
    expect(await shape(old)).toEqual(await shape(fresh));
    expect(await migrate(old)).toEqual([]);
  });

  it('give the same columns as the client schema, with matching types', async () => {
    const pool = await newDatabase('mig_client');
    await migrate(pool);

    // what a PowerSync client column is for each Postgres type (json and boolean travel as text and 0/1)
    const clientType = (udt: string) => (udt === 'bool' || udt === 'int4' ? 'integer' : udt === 'float8' ? 'real' : 'text');
    for (const [table, columns] of Object.entries(SCHEMA)) {
      const { rows } = await pool.query(
        `SELECT column_name, udt_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 AND column_name <> 'id'`,
        [table],
      );
      const actual = Object.fromEntries(rows.map((r) => [r.column_name, clientType(r.udt_name)]));
      expect(actual, table).toEqual(columns);
    }
  });

  it('are applied one at a time: a failing one is rolled back and not recorded, and earlier ones stay', async () => {
    const pool = await newDatabase('mig_failing');
    const dir = mkdtempSync(join(tmpdir(), 'migrations-'));
    writeFileSync(join(dir, '0001_ok.sql'), 'CREATE TABLE IF NOT EXISTS a (id text PRIMARY KEY);');
    writeFileSync(join(dir, '0002_bad.sql'), 'CREATE TABLE b (id text PRIMARY KEY); SELECT nope FROM nowhere;');

    await expect(migrate(pool, dir)).rejects.toThrow();

    const recorded = await pool.query('SELECT name FROM schema_migrations');
    expect(recorded.rows).toEqual([{ name: '0001_ok.sql' }]);
    expect((await pool.query(`SELECT to_regclass('b') AS b`)).rows[0].b).toBeNull();
  });

  it('leave an upgraded database serving uploads: carried_on and carried_from_event_id can be written', async () => {
    const pool = await newDatabase('mig_serving');
    await pool.query(LEGACY);
    await migrate(pool);
    const app = await buildServer({ pool, key: await generateKey() });

    const res = await upload(app, [
      { op: 'PUT', table: 'tasks', id: 't1', data: taskRow({ carried_on: '2026-11-17', carried_from_event_id: 'e1' }) },
    ]);

    expect(res.statusCode).toBe(200);
    expect((await pool.query('SELECT carried_on, carried_from_event_id FROM tasks WHERE id = $1', ['t1'])).rows).toEqual([
      { carried_on: '2026-11-17', carried_from_event_id: 'e1' },
    ]);
    await app.close();
  });
});
