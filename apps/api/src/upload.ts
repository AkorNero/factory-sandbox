import type pg from 'pg';

/** The tables the API keeps for itself. They are never reachable through an upload. */
const INTERNAL_TABLES = ['schema_migrations', 'deleted_rows'];

/** What the upload endpoint knows about the tables: names and Postgres types, read from the DDL itself. */
export type Catalog = Map<string, Map<string, string>>;

export async function loadCatalog(pool: pg.Pool): Promise<Catalog> {
  const { rows } = await pool.query<{ table_name: string; column_name: string; udt_name: string }>(
    `SELECT table_name, column_name, udt_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name <> ALL($1)`,
    [INTERNAL_TABLES],
  );
  const catalog: Catalog = new Map();
  for (const r of rows) {
    if (!catalog.has(r.table_name)) catalog.set(r.table_name, new Map());
    catalog.get(r.table_name)!.set(r.column_name, r.udt_name);
  }
  return catalog;
}

export interface Op {
  op: 'PUT' | 'PATCH' | 'DELETE';
  table: string;
  id: string;
  data: Record<string, unknown> | null;
}

/** Thrown for anything the client can never fix by retrying; the endpoint answers 400. */
export class BadUpload extends Error {}

/** Check the body's shape and names against the catalog. Table and column names never reach SQL unchecked. */
export function parseOps(body: unknown, catalog: Catalog): Op[] {
  const ops = (body as { ops?: unknown } | null)?.ops;
  if (!Array.isArray(ops)) throw new BadUpload('body must be { ops: [...] }');
  return ops.map((raw, i): Op => {
    const o = raw as Partial<Op> | null;
    if (!o || typeof o !== 'object') throw new BadUpload(`op ${i}: not an object`);
    if (o.op !== 'PUT' && o.op !== 'PATCH' && o.op !== 'DELETE') throw new BadUpload(`op ${i}: unknown op`);
    const columns = typeof o.table === 'string' ? catalog.get(o.table) : undefined;
    if (!columns) throw new BadUpload(`op ${i}: unknown table`);
    if (typeof o.id !== 'string' || !o.id) throw new BadUpload(`op ${i}: missing id`);
    const data = o.data ?? null;
    if (data !== null && (typeof data !== 'object' || Array.isArray(data))) throw new BadUpload(`op ${i}: bad data`);
    for (const col of Object.keys(data ?? {})) {
      if (col === 'id' || !columns.has(col)) throw new BadUpload(`op ${i}: unknown column ${col}`);
    }
    return { op: o.op, table: o.table!, id: o.id, data };
  });
}

/** Convert a value PowerSync's client SQLite holds into what Postgres wants. */
function toPg(value: unknown, udt: string, where: string): unknown {
  if (value === null || value === undefined) return null;
  switch (udt) {
    case 'bool':
      if (value === 0 || value === false) return false;
      if (value === 1 || value === true) return true;
      throw new BadUpload(`${where}: expected 0/1`);
    case 'int4':
    case 'int8':
    case 'float8':
      if (typeof value !== 'number') throw new BadUpload(`${where}: expected a number`);
      return value;
    case 'jsonb':
    case 'json':
      if (typeof value !== 'string') throw new BadUpload(`${where}: expected JSON text`);
      try {
        JSON.parse(value);
      } catch {
        throw new BadUpload(`${where}: invalid JSON`);
      }
      return value;
    default:
      if (typeof value !== 'string') throw new BadUpload(`${where}: expected text`);
      return value;
  }
}

const q = (ident: string) => `"${ident.replaceAll('"', '""')}"`;

/** Held for the length of a batch, so a DELETE and a replayed PUT can never interleave. One user: uploads are small and rare. */
const UPLOAD_LOCK = 7_281_429;

/**
 * Apply a batch in one transaction. Every operation is idempotent, so a resent batch changes nothing.
 *  - PUT   upserts by id and writes only the columns it carries.
 *  - PATCH updates only the columns it carries; on a row that no longer exists it does nothing (a delete wins).
 *  - DELETE hard-deletes by id and leaves a tombstone (deleted_rows), so a PUT or PATCH that is resent or arrives late
 *    for that id is skipped instead of bringing the row back: deletes win over updates.
 * Per-column last write wins by arrival: each statement writes just its own columns.
 */
export async function applyOps(pool: pg.Pool, ops: Op[], catalog: Catalog): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [UPLOAD_LOCK]);
    for (const [i, op] of ops.entries()) {
      const types = catalog.get(op.table)!;
      const cols = Object.keys(op.data ?? {});
      const values = cols.map((c) => toPg(op.data![c], types.get(c)!, `op ${i} ${c}`));
      const table = q(op.table);
      if (op.op === 'DELETE') {
        await client.query('INSERT INTO deleted_rows (table_name, id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [op.table, op.id]);
        await client.query(`DELETE FROM ${table} WHERE id = $1`, [op.id]);
        continue;
      }
      const tombstone = await client.query('SELECT 1 FROM deleted_rows WHERE table_name = $1 AND id = $2', [op.table, op.id]);
      if (tombstone.rowCount) continue;
      if (op.op === 'PATCH') {
        if (cols.length === 0) continue;
        const sets = cols.map((c, k) => `${q(c)} = $${k + 2}::${types.get(c)}`).join(', ');
        await client.query(`UPDATE ${table} SET ${sets} WHERE id = $1`, [op.id, ...values]);
      } else {
        const names = ['id', ...cols].map(q).join(', ');
        const params = ['$1', ...cols.map((c, k) => `$${k + 2}::${types.get(c)}`)].join(', ');
        const onConflict = cols.length
          ? `DO UPDATE SET ${cols.map((c) => `${q(c)} = EXCLUDED.${q(c)}`).join(', ')}`
          : 'DO NOTHING';
        await client.query(
          `INSERT INTO ${table} (${names}) VALUES (${params}) ON CONFLICT (id) ${onConflict}`,
          [op.id, ...values],
        );
      }
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    // 22xxx data exceptions and 23xxx constraint violations can never succeed on retry
    const code = (err as { code?: string }).code ?? '';
    if (code.startsWith('22') || code.startsWith('23')) throw new BadUpload((err as Error).message);
    throw err;
  } finally {
    client.release();
  }
}
