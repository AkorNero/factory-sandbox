import pg from 'pg';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.ts';
import { generateKey } from '../src/auth.ts';

export async function startApp(): Promise<{ app: FastifyInstance; pool: pg.Pool }> {
  const pool = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL });
  const app = await buildServer({ pool, key: await generateKey() });
  return { app, pool };
}

export type Op = { op: 'PUT' | 'PATCH' | 'DELETE'; table: string; id: string; data?: Record<string, unknown> | null };

export async function upload(app: FastifyInstance, ops: Op[]) {
  return app.inject({ method: 'POST', url: '/api/upload', payload: { ops } });
}

export const taskRow = (over: Record<string, unknown> = {}) => ({
  title: 'Buy stamps',
  date: '2026-11-16',
  event_id: null,
  carried_over: 0,
  position: 1,
  created_at: '2026-11-16T10:15:00+01:00',
  updated_at: '2026-11-16T10:15:00+01:00',
  ...over,
});
