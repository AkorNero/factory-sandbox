import type { Changes, Command, Now, State, TaskRow } from './types.ts';
import { noChanges } from './types.ts';

/** Run one command against the current state. Pure: returns the changed rows, never mutates `state`. */
export function apply(state: State, command: Command, now: Now): Changes {
  switch (command.type) {
    case 'addTask':
      return addTask(state, command, now);
    case 'tickTask':
      return tickTask(state, command.id, now);
    case 'untickTask':
      return untickTask(state, command.id, now);
    case 'setCompletionTime':
      return setCompletionTime(state, command.id, command.time, now);
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

function liveTask(state: State, id: string): TaskRow | undefined {
  return state.tasks.find((t) => t.id === id && !t.deleted_at);
}

function updateTask(id: string, set: Record<string, unknown>): Changes {
  return { inserts: [], updates: [{ table: 'tasks', id, set }], deletes: [] };
}

/** Ticking records the Completion time. A Task that is already done keeps the time it has. */
function tickTask(state: State, id: string, now: Now): Changes {
  const task = liveTask(state, id);
  if (!task || task.completed_at) return noChanges();
  return updateTask(id, { completed_at: now, updated_at: now });
}

/** Unticking clears the Completion time. */
function untickTask(state: State, id: string, now: Now): Changes {
  const task = liveTask(state, id);
  if (!task || !task.completed_at) return noChanges();
  return updateTask(id, { completed_at: null, updated_at: now });
}

const CLOCK_TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Editing keeps the Completion time's date and UTC offset; only the clock time changes. */
function setCompletionTime(state: State, id: string, time: string, now: Now): Changes {
  const task = liveTask(state, id);
  if (!task?.completed_at || !CLOCK_TIME.test(time)) return noChanges();
  const completed = `${task.completed_at.slice(0, 11)}${time}:00${task.completed_at.slice(19)}`;
  if (completed === task.completed_at) return noChanges();
  return updateTask(id, { completed_at: completed, updated_at: now });
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
