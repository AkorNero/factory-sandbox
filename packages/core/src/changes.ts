import type { Changes, State } from './types.ts';

/** Apply changed rows to a state snapshot (used by tests, and by anything that wants the result in memory). */
export function applyChanges(state: State, changes: Changes): State {
  const next: State = {
    events: [...state.events],
    tasks: [...state.tasks],
    series: [...state.series],
    routines: [...state.routines],
  };
  for (const ins of changes.inserts) {
    const list = next[ins.table] as { id: string }[];
    const i = list.findIndex((r) => r.id === ins.row.id);
    if (i >= 0) list[i] = ins.row;
    else list.push(ins.row);
  }
  for (const up of changes.updates) {
    const list = next[up.table] as { id: string }[];
    const i = list.findIndex((r) => r.id === up.id);
    if (i >= 0) list[i] = { ...list[i]!, ...up.set };
  }
  for (const del of changes.deletes) {
    next[del.table] = (next[del.table] as { id: string }[]).filter((r) => r.id !== del.id) as never;
  }
  return next;
}

/** Several change sets as one: updates to the same row are folded together, later ones winning column by column. */
export function mergeChanges(...parts: Changes[]): Changes {
  const merged: Changes = { inserts: [], updates: [], deletes: [] };
  const updates = new Map<string, Changes['updates'][number]>();
  for (const part of parts) {
    merged.inserts.push(...part.inserts);
    merged.deletes.push(...part.deletes);
    for (const up of part.updates) {
      const key = `${up.table}:${up.id}`;
      const before = updates.get(key);
      updates.set(key, before ? { ...before, set: { ...before.set, ...up.set } } : up);
    }
  }
  merged.updates = [...updates.values()];
  return merged;
}
