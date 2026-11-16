import { apply, SCHEMA, emptyState, type Changes, type Command, type Now, type State, type TableName } from '@dayplanner/core';
import { useQuery } from '@powersync/react';
import type { AbstractPowerSyncDatabase } from '@powersync/web';
import { useMemo } from 'react';

/**
 * Store adapter: reads the state snapshot the core needs from local SQLite, and writes the core's
 * changed rows back. No rules in here.
 */

type Raw = Record<string, unknown>;

/** SQLite rows to the core's rows (the only difference: carried_over is 0/1 locally). */
const toState = (raw: Record<TableName, Raw[]>): State =>
  ({
    ...emptyState(),
    events: raw.events,
    tasks: raw.tasks.map((t) => ({ ...t, carried_over: !!t.carried_over })),
    series: raw.series,
    routines: raw.routines,
  }) as unknown as State;

const toSql = (v: unknown) => (typeof v === 'boolean' ? (v ? 1 : 0) : (v ?? null));

/** Reactive state snapshot; null until the first read has completed. */
export function useStoreState(): State | null {
  const events = useQuery<Raw>('SELECT * FROM events');
  const tasks = useQuery<Raw>('SELECT * FROM tasks');
  const series = useQuery<Raw>('SELECT * FROM series');
  const routines = useQuery<Raw>('SELECT * FROM routines');
  const loading = events.isLoading || tasks.isLoading || series.isLoading || routines.isLoading;
  return useMemo(
    () => (loading ? null : toState({ events: events.data, tasks: tasks.data, series: series.data, routines: routines.data })),
    [loading, events.data, tasks.data, series.data, routines.data],
  );
}

async function readState(db: AbstractPowerSyncDatabase): Promise<State> {
  const [events, tasks, series, routines] = await Promise.all(
    (['events', 'tasks', 'series', 'routines'] as const).map((t) => db.getAll<Raw>(`SELECT * FROM ${t}`)),
  );
  return toState({ events: events!, tasks: tasks!, series: series!, routines: routines! });
}

async function writeChanges(db: AbstractPowerSyncDatabase, changes: Changes) {
  await db.writeTransaction(async (tx) => {
    for (const { table, row } of changes.inserts) {
      const cols = ['id', ...Object.keys(SCHEMA[table])];
      const rec = row as unknown as Raw;
      await tx.execute(
        `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
        cols.map((c) => toSql(rec[c])),
      );
    }
    for (const { table, id, set } of changes.updates) {
      // only the changed columns, so the upload is a minimal PATCH
      const cols = Object.keys(set);
      await tx.execute(`UPDATE ${table} SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`, [
        ...cols.map((c) => toSql(set[c])),
        id,
      ]);
    }
    for (const { table, id } of changes.deletes) {
      await tx.execute(`DELETE FROM ${table} WHERE id = ?`, [id]);
    }
  });
}

/** Commands run one after another, so none reads the state while another is still writing. */
let queue: Promise<unknown> = Promise.resolve();

/** Run a command: read the state, let the core decide, write the changed rows in one local transaction. */
export function runCommand(db: AbstractPowerSyncDatabase, command: Command, now: Now): Promise<Changes> {
  const result = queue.then(async () => {
    const changes = apply(await readState(db), command, now);
    const empty = !changes.inserts.length && !changes.updates.length && !changes.deletes.length;
    if (!empty) await writeChanges(db, changes);
    return changes;
  });
  queue = result.catch(() => undefined);
  return result;
}
