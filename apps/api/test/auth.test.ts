import { createLocalJWKSet, jwtVerify } from 'jose';
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startApp } from './support.ts';

let app: FastifyInstance;
let pool: pg.Pool;
beforeAll(async () => {
  ({ app, pool } = await startApp());
});
afterAll(async () => {
  await app.close();
  await pool.end();
});

describe('a device getting in with no login', () => {
  it('gets a JWT that the served JWKS verifies, with the claims PowerSync requires', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/device-token', payload: { deviceId: 'device-1' } });
    expect(res.statusCode).toBe(200);
    const { token } = res.json() as { token: string };

    const jwksRes = await app.inject({ method: 'GET', url: '/.well-known/jwks.json' });
    const jwks = jwksRes.json() as { keys: Record<string, unknown>[] };
    const { payload, protectedHeader } = await jwtVerify(token, createLocalJWKSet(jwks as never), {
      audience: 'dayplanner',
    });

    expect(protectedHeader.kid).toBe(jwks.keys[0]!.kid);
    expect(payload.sub).toBe('owner');
    // PowerSync rejects tokens living longer than 24 h; ours is short and re-fetched on every fetchCredentials
    expect(payload.exp! - payload.iat!).toBeLessThanOrEqual(24 * 3600);
    expect(payload.exp! - payload.iat!).toBe(3600);
  });

  it('serves public key parts only', async () => {
    const jwks = (await app.inject({ method: 'GET', url: '/.well-known/jwks.json' })).json() as { keys: Record<string, unknown>[] };

    expect(jwks.keys).toHaveLength(1);
    for (const secret of ['d', 'p', 'q', 'dp', 'dq', 'qi']) expect(jwks.keys[0]).not.toHaveProperty(secret);
    expect(jwks.keys[0]).toMatchObject({ kty: 'RSA', alg: 'RS256', use: 'sig' });
  });

  it('needs a deviceId', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/device-token', payload: {} });
    expect(res.statusCode).toBe(400);
  });
});
