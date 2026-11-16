import { checkEventTimes, normaliseTime } from './event-input.ts';
import type { Changes, Command, EventRow, Now, State, TaskRow } from './types.ts';
import { noChanges } from './types.ts';

/** Run one command against the current state. Pure: returns the changed rows, never mutates `state`. */
export function apply(state: State, command: Command, now: Now): Changes {
  switch (command.type) {
    case 'addTask':
      return addTask(state, command, now);
    case 'addEvent':
      return addEvent(command, now);
    case 'renameEvent':
      return renameEvent(state, command, now);
    case 'setEventTimes':
      return setEventTimes(state, command, now);
    case 'deleteEvent':
      return deleteEvent(state, command);
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

function addEvent(cmd: Extract<Command, { type: 'addEvent' }>, now: Now): Changes {
  const title = cmd.title.trim();
  if (!title || checkEventTimes(cmd.start, cmd.end)) return noChanges();
  const row: EventRow = {
    id: cmd.id,
    title,
    date: cmd.date,
    start_time: normaliseTime(cmd.start)!,
    end_time: normaliseTime(cmd.end)!,
    series_id: null,
    occurrence_date: null,
    deleted_at: null,
    created_at: now,
    updated_at: now,
  };
  return { inserts: [{ table: 'events', row }], updates: [], deletes: [] };
}

const findEvent = (state: State, id: string) => state.events.find((e) => e.id === id && !e.deleted_at);

function updateEvent(id: string, set: Record<string, unknown>, now: Now): Changes {
  if (Object.keys(set).length === 0) return noChanges();
  return { inserts: [], updates: [{ table: 'events', id, set: { ...set, updated_at: now } }], deletes: [] };
}

function renameEvent(state: State, cmd: Extract<Command, { type: 'renameEvent' }>, now: Now): Changes {
  const event = findEvent(state, cmd.id);
  const title = cmd.title.trim();
  if (!event || !title || title === event.title) return noChanges();
  return updateEvent(event.id, { title }, now);
}

function setEventTimes(state: State, cmd: Extract<Command, { type: 'setEventTimes' }>, now: Now): Changes {
  const event = findEvent(state, cmd.id);
  if (!event || checkEventTimes(cmd.start, cmd.end)) return noChanges();
  const start = normaliseTime(cmd.start)!;
  const end = normaliseTime(cmd.end)!;
  const set: Record<string, unknown> = {};
  if (start !== event.start_time) set.start_time = start;
  if (end !== event.end_time) set.end_time = end;
  return updateEvent(event.id, set, now);
}

function deleteEvent(state: State, cmd: Extract<Command, { type: 'deleteEvent' }>): Changes {
  if (!findEvent(state, cmd.id)) return noChanges();
  return { inserts: [], updates: [], deletes: [{ table: 'events', id: cmd.id }] };
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
