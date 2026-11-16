import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SCHEMA } from '@dayplanner/core';
import { startApp, taskRow, upload } from './support.ts';

let app: FastifyInstance;
let pool: pg.Pool;

beforeAll(async () => {
  ({ app, pool } = await startApp());
});
afterAll(async () => {
  await app.close();
  await pool.end();
});
beforeEach(async () => {
  await pool.query('TRUNCATE events, tasks, series, routines');
});

const task = async (id: string) => (await pool.query('SELECT * FROM tasks WHERE id = $1', [id])).rows[0];

describe('the upload endpoint', () => {
  describe('PUT', () => {
    it('inserts a row, converting the client types (0/1 to boolean, text kept as text)', async () => {
      const res = await upload(app, [{ op: 'PUT', table: 'tasks', id: 't1', data: taskRow({ carried_over: 1 }) }]);

      expect(res.statusCode).toBe(200);
      expect(await task('t1')).toMatchObject({
        id: 't1',
        title: 'Buy stamps',
        date: '2026-11-16',
        event_id: null,
        carried_over: true,
        position: 1,
        created_at: '2026-11-16T10:15:00+01:00',
      });
    });

    it('stores JSON text columns as jsonb', async () => {
      const res = await upload(app, [
        {
          op: 'PUT',
          table: 'routines',
          id: 'r1',
          data: { name: 'Morning', body: '{"events":[]}', created_at: 'x', updated_at: 'x' },
        },
      ]);

      expect(res.statusCode).toBe(200);
      const { rows } = await pool.query('SELECT body FROM routines WHERE id = $1', ['r1']);
      expect(rows[0].body).toEqual({ events: [] });
    });

    it('on an existing row writes only the columns it carries, so another device\'s other columns survive', async () => {
      await upload(app, [{ op: 'PUT', table: 'tasks', id: 't1', data: taskRow() }]);
      await upload(app, [{ op: 'PATCH', table: 'tasks', id: 't1', data: { completed_at: '2026-11-16T11:00:00+01:00' } }]);

      // a second device materialises the same Occurrence id and PUTs its own columns, not carrying completed_at
      await upload(app, [{ op: 'PUT', table: 'tasks', id: 't1', data: { title: 'Renamed', created_at: 'a', updated_at: 'a' } }]);

      expect(await task('t1')).toMatchObject({ title: 'Renamed', completed_at: '2026-11-16T11:00:00+01:00', date: '2026-11-16' });
    });
  });

  describe('PATCH', () => {
    it('changes only the carried columns', async () => {
      await upload(app, [{ op: 'PUT', table: 'tasks', id: 't1', data: taskRow() }]);

      await upload(app, [{ op: 'PATCH', table: 'tasks', id: 't1', data: { title: 'Buy two stamps' } }]);

      expect(await task('t1')).toMatchObject({ title: 'Buy two stamps', date: '2026-11-16', position: 1 });
    });

    it('keeps both changes when two devices changed different columns of one row', async () => {
      await upload(app, [{ op: 'PUT', table: 'tasks', id: 't1', data: taskRow() }]);

      await upload(app, [{ op: 'PATCH', table: 'tasks', id: 't1', data: { title: 'From phone' } }]);
      await upload(app, [{ op: 'PATCH', table: 'tasks', id: 't1', data: { date: '2026-11-17' } }]);

      expect(await task('t1')).toMatchObject({ title: 'From phone', date: '2026-11-17' });
    });

    it('lets the later upload win when two devices changed the same column', async () => {
      await upload(app, [{ op: 'PUT', table: 'tasks', id: 't1', data: taskRow() }]);

      await upload(app, [{ op: 'PATCH', table: 'tasks', id: 't1', data: { title: 'Phone title' } }]);
      await upload(app, [{ op: 'PATCH', table: 'tasks', id: 't1', data: { title: 'Desktop title' } }]);

      expect((await task('t1')).title).toBe('Desktop title');
    });

    it('can set a column to null', async () => {
      await upload(app, [{ op: 'PUT', table: 'tasks', id: 't1', data: taskRow({ event_id: 'e1' }) }]);

      await upload(app, [{ op: 'PATCH', table: 'tasks', id: 't1', data: { event_id: null } }]);

      expect((await task('t1')).event_id).toBeNull();
    });
  });

  describe('DELETE', () => {
    it('removes the row', async () => {
      await upload(app, [{ op: 'PUT', table: 'tasks', id: 't1', data: taskRow() }]);

      const res = await upload(app, [{ op: 'DELETE', table: 'tasks', id: 't1' }]);

      expect(res.statusCode).toBe(200);
      expect(await task('t1')).toBeUndefined();
    });

    it('wins over a later update to the same row', async () => {
      await upload(app, [{ op: 'PUT', table: 'tasks', id: 't1', data: taskRow() }]);
      await upload(app, [{ op: 'DELETE', table: 'tasks', id: 't1' }]);

      const res = await upload(app, [{ op: 'PATCH', table: 'tasks', id: 't1', data: { title: 'Too late' } }]);

      expect(res.statusCode).toBe(200);
      expect(await task('t1')).toBeUndefined();
    });
  });

  describe('resent operations', () => {
    it('leave the same result as uploading once', async () => {
      const batch = [
        { op: 'PUT' as const, table: 'tasks', id: 't1', data: taskRow() },
        { op: 'PATCH' as const, table: 'tasks', id: 't1', data: { title: 'Edited' } },
        { op: 'PUT' as const, table: 'tasks', id: 't2', data: taskRow({ title: 'Other' }) },
        { op: 'DELETE' as const, table: 'tasks', id: 't2' },
      ];

      await upload(app, batch);
      const once = (await pool.query('SELECT * FROM tasks ORDER BY id')).rows;
      const again = await upload(app, batch);
      await upload(app, batch);
      const thrice = (await pool.query('SELECT * FROM tasks ORDER BY id')).rows;

      expect(again.statusCode).toBe(200);
      expect(thrice).toEqual(once);
      expect(once.map((r) => [r.id, r.title])).toEqual([['t1', 'Edited']]);
    });
  });

  describe('a batch', () => {
    it('is applied atomically: one bad operation rolls the whole batch back', async () => {
      const res = await upload(app, [
        { op: 'PUT', table: 'tasks', id: 't1', data: taskRow() },
        { op: 'PUT', table: 'tasks', id: 't2', data: { ...taskRow(), title: null } }, // title is NOT NULL
      ]);

      expect(res.statusCode).toBe(400);
      expect(await task('t1')).toBeUndefined();
    });

    it('rejects an unknown table with 400 and applies nothing', async () => {
      const res = await upload(app, [
        { op: 'PUT', table: 'tasks', id: 't1', data: taskRow() },
        { op: 'PUT', table: 'pg_user', id: 'x', data: { title: 'x' } },
      ]);

      expect(res.statusCode).toBe(400);
      expect(await task('t1')).toBeUndefined();
    });

    it('rejects the internal schema_migrations table: only the four synced tables take uploads', async () => {
      const res = await upload(app, [{ op: 'PUT', table: 'schema_migrations', id: 'x', data: { applied_at: '2026-01-01' } }]);

      expect(res.statusCode).toBe(400);
    });

    it('rejects an unknown column with 400', async () => {
      const res = await upload(app, [{ op: 'PATCH', table: 'tasks', id: 't1', data: { 'title = 1; --': 'x' } }]);

      expect(res.statusCode).toBe(400);
    });

    it('rejects a malformed body with 400', async () => {
      const res = await app.inject({ method: 'POST', url: '/api/upload', payload: { nope: true } });
      expect(res.statusCode).toBe(400);
    });
  });
});

describe('the DDL and the client schema', () => {
  it('list the same columns for all four tables', async () => {
    for (const [table, columns] of Object.entries(SCHEMA)) {
      const { rows } = await pool.query(
        `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 AND column_name <> 'id'`,
        [table],
      );
      expect(rows.map((r) => r.column_name).sort(), table).toEqual(Object.keys(columns).sort());
    }
  });
});
