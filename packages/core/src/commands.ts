import type { Changes, Command, Now, State, TaskRow } from './types.ts';
import { noChanges } from './types.ts';

/** Run one command against the current state. Pure: returns the changed rows, never mutates `state`. */
export function apply(state: State, command: Command, now: Now): Changes {
  switch (command.type) {
    case 'addTask':
      return addTask(state, command, now);
  }
}

function addTask(state: State, cmd: Extract<Command, { type: 'addTask' }>, now: Now): Changes {
  const title = cmd.title.trim();
  if (!title) return noChanges();
  const position = Math.max(0, ...state.tasks.map((t) => t.position)) + 1;
  const row: TaskRow = {
    id: cmd.id,
    parent_id: null,
    title,
    date: cmd.date,
    event_id: null,
    completed_at: null,
    skipped_at: null,
    carried_over: false,
    position,
    series_id: null,
    occurrence_date: null,
    series_subtask_key: null,
    deleted_at: null,
    created_at: now,
    updated_at: now,
  };
  return { inserts: [{ table: 'tasks', row }], updates: [], deletes: [] };
}

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
