import fastifyStatic from '@fastify/static';
import fastifyProxy from '@fastify/http-proxy';
import Fastify, { type FastifyInstance } from 'fastify';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import pg from 'pg';
import { jwks, loadOrCreateKey, signDeviceToken, type Key } from './auth.ts';
import { applyOps, BadUpload, loadCatalog, parseOps } from './upload.ts';

export interface ServerOptions {
  pool: pg.Pool;
  key: Key;
  /** Built PWA to serve (apps/web/dist). Omitted in API tests. */
  webDist?: string;
  /** PowerSync service to proxy under /powersync. Omitted in API tests. */
  powersyncUpstream?: string;
}

/** The only PowerSync paths a client needs. Probes and everything else stay inside the compose network. */
const POWERSYNC_ALLOWED = new Set(['/sync/stream', '/write-checkpoint2.json']);

export async function buildServer(opts: ServerOptions): Promise<FastifyInstance> {
  // Sync streams stay open for minutes to hours: no request or connection timeouts.
  const app = Fastify({ logger: process.env.LOG === '1', connectionTimeout: 0, requestTimeout: 0, bodyLimit: 10 * 1024 * 1024 });
  const catalog = await loadCatalog(opts.pool);

  app.get('/healthz', async () => ({ ok: true }));

  app.get('/.well-known/jwks.json', async (_req, reply) => {
    reply.header('cache-control', 'public, max-age=60');
    return jwks(opts.key);
  });

  app.post('/api/device-token', async (req, reply) => {
    const deviceId = (req.body as { deviceId?: unknown } | null)?.deviceId;
    if (typeof deviceId !== 'string' || deviceId.length === 0 || deviceId.length > 100) {
      return reply.code(400).send({ error: 'deviceId required' });
    }
    reply.header('cache-control', 'no-store');
    return { token: await signDeviceToken(opts.key, deviceId) };
  });

  app.post('/api/upload', async (req, reply) => {
    try {
      await applyOps(opts.pool, parseOps(req.body, catalog), catalog);
      return { ok: true };
    } catch (err) {
      if (err instanceof BadUpload) return reply.code(400).send({ error: err.message });
      throw err;
    }
  });

  if (opts.powersyncUpstream) {
    await app.register(fastifyProxy, {
      upstream: opts.powersyncUpstream,
      prefix: '/powersync',
      rewritePrefix: '/',
      http2: false,
      // streaming: never time out a long-lived sync response
      undici: { bodyTimeout: 0, headersTimeout: 0 },
      preHandler: async (req, reply) => {
        const path = req.url.slice('/powersync'.length).split('?')[0] ?? '';
        if (!POWERSYNC_ALLOWED.has(path)) await reply.code(404).send({ error: 'not found' });
      },
    });
  }

  if (opts.webDist && existsSync(opts.webDist)) {
    const root = resolve(opts.webDist);
    await app.register(fastifyStatic, {
      root,
      setHeaders(res, path) {
        // The shell and the service worker must always revalidate; hashed assets never change.
        if (/(index\.html|sw\.js|registerSW\.js|manifest\.webmanifest)$/.test(path)) res.header('cache-control', 'no-cache');
        else if (path.includes('/assets/')) res.header('cache-control', 'public, max-age=31536000, immutable');
      },
    });
    app.setNotFoundHandler((req, reply) => {
      const isApi = /^\/(api|powersync|\.well-known)\//.test(req.url);
      if (req.method === 'GET' && !isApi) return reply.header('cache-control', 'no-cache').sendFile('index.html');
      return reply.code(404).send({ error: 'not found' });
    });
  }

  return app;
}

async function main() {
  const need = (name: string) => {
    const v = process.env[name];
    if (!v) throw new Error(`${name} is required`);
    return v;
  };
  const pool = new pg.Pool({ connectionString: need('DATABASE_URL') });
  const key = await loadOrCreateKey(process.env.JWT_KEY_FILE ?? '/data/jwt-key.json');
  const app = await buildServer({
    pool,
    key,
    webDist: process.env.WEB_DIST,
    powersyncUpstream: process.env.POWERSYNC_UPSTREAM,
  });
  const port = Number(process.env.PORT ?? 8080);
  await app.listen({ port, host: process.env.HOST ?? '0.0.0.0' });
  console.log(`api listening on ${port}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
