import { checkEventTimes, normaliseTime } from './event-input.ts';
import { dateOf } from './dates.ts';
import type { Changes, Command, DateStr, EventRow, Now, State, TaskRow } from './types.ts';
import { noChanges } from './types.ts';
import { materialise, setRecurrence } from './series.ts';

/** Run one command against the current state. Pure: returns the changed rows, never mutates `state`. */
export function apply(state: State, command: Command, now: Now): Changes {
  switch (command.type) {
    case 'addTask':
      return addTask(state, command, now);
    case 'addSubtask':
      return addSubtask(state, command, now);
    case 'addEvent':
      return addEvent(command, now);
    case 'renameEvent':
      return renameEvent(state, command, now);
    case 'setEventTimes':
      return setEventTimes(state, command, now);
    case 'deleteEvent':
      return deleteEvent(state, command, now);
    case 'moveEvent':
      return moveEvent(state, command.id, command.date, now);
    case 'placeTask':
      return placeTask(state, command.id, command.eventId, now);
    case 'unplaceTask':
      return unplaceTask(state, command.id, now);
    case 'undateTask':
      return undateTask(state, command.id, now);
    case 'dateTask':
      return dateTask(state, command.id, command.date, now);
    case 'tickTask':
      return tickTask(state, command.id, now);
    case 'untickTask':
      return untickTask(state, command.id, now);
    case 'setCompletionTime':
      return setCompletionTime(state, command.id, command.time, now);
    case 'renameTask':
      return renameTask(state, command.id, command.title, now);
    case 'deleteTask':
      return deleteTask(state, command.id, now);
    case 'setRecurrence':
      return setRecurrence(state, command, now);
    case 'materialise':
      return materialise(state, command.dates, now);
  }
}

function addTask(state: State, cmd: Extract<Command, { type: 'addTask' }>, now: Now): Changes {
  const title = cmd.title.trim();
  if (!title) return noChanges();
  const event = cmd.eventId ? findEvent(state, cmd.eventId) : undefined;
  if (cmd.eventId && !event) return noChanges();
  const position = nextPosition(state);
  const row: TaskRow = {
    id: cmd.id,
    parent_id: null,
    title,
    date: event ? event.date : cmd.date,
    event_id: event ? event.id : null,
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

export const nextPosition = (state: State) => Math.max(0, ...state.tasks.map((t) => t.position)) + 1;

/** Whether a Sub-task can be added to the Task: it exists and is not a Sub-task itself (Sub-tasks never have Sub-tasks). */
export function canAddSubtask(state: State, id: string): boolean {
  const task = liveTask(state, id);
  return !!task && !task.parent_id;
}

function addSubtask(state: State, cmd: Extract<Command, { type: 'addSubtask' }>, now: Now): Changes {
  const title = cmd.title.trim();
  const parent = liveTask(state, cmd.parentId);
  if (!title || !parent || !canAddSubtask(state, parent.id)) return noChanges();
  const row: TaskRow = {
    id: cmd.id,
    parent_id: parent.id,
    title,
    date: null,
    // the first Sub-task takes over its parent's Placement
    event_id: hasSubtasks(state, parent.id) ? null : parent.event_id,
    completed_at: null,
    skipped_at: null,
    carried_over: false,
    position: nextPosition(state),
    series_id: null,
    occurrence_date: null,
    series_subtask_key: null,
    deleted_at: null,
    created_at: now,
    updated_at: now,
  };
  const first = !hasSubtasks(state, parent.id);
  // a parent has no Placement and no Completion time of its own: the first Sub-task takes over the Placement,
  // and adding one to a done Task reopens it
  const set: Record<string, unknown> = {};
  if (first && parent.event_id) set.event_id = null;
  if (parent.completed_at) set.completed_at = null;
  const updates = Object.keys(set).length ? updateTask(parent.id, { ...set, updated_at: now }).updates : [];
  return { inserts: [{ table: 'tasks', row }], updates, deletes: [] };
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

export const findEvent = (state: State, id: string) => state.events.find((e) => e.id === id && !e.deleted_at);

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

/** Deleting an Event deletes only the Event: its items are left Unplaced, on the day the Event was on. */
function deleteEvent(state: State, cmd: Extract<Command, { type: 'deleteEvent' }>, now: Now): Changes {
  const event = findEvent(state, cmd.id);
  if (!event) return noChanges();
  const updates = state.tasks
    .filter((t) => t.event_id === event.id && !t.deleted_at)
    .map((t) => ({
      table: 'tasks' as const,
      id: t.id,
      // a Sub-task has no day of its own: it follows its parent
      set: { event_id: null, ...(t.parent_id || t.date === event.date ? {} : { date: event.date }), updated_at: now },
    }));
  // an Occurrence is kept, marked deleted, so no device makes it again; a one-off Event is removed
  if (event.series_id) return { inserts: [], updates: [...updates, ...updateEvent(event.id, { deleted_at: now }, now).updates], deletes: [] };
  return { inserts: [], updates, deletes: [{ table: 'events', id: cmd.id }] };
}

/** Whether a drop of the Event onto the day is allowed: it exists and is on another day. */
export function canMoveEvent(state: State, id: string, date: DateStr): boolean {
  const event = findEvent(state, id);
  return !!event && event.date !== date;
}

/**
 * The Event takes the new day and its placed Tasks come along: they keep their Placement and, like any placed
 * Task, take the Event's day. A placed Sub-task has no day of its own, so it stays as it is.
 */
export function moveEvent(state: State, id: string, date: DateStr, now: Now): Changes {
  if (!canMoveEvent(state, id, date)) return noChanges();
  const tasks = state.tasks
    .filter((t) => t.event_id === id && !t.deleted_at && !t.parent_id && t.date !== date)
    .map((t) => ({ table: 'tasks' as const, id: t.id, set: { date, updated_at: now } }));
  return { inserts: [], updates: [...updateEvent(id, { date }, now).updates, ...tasks], deletes: [] };
}

export const subtasksOf = (state: State, id: string) => state.tasks.filter((t) => t.parent_id === id && !t.deleted_at);
/** A Task with Sub-tasks is done exactly when all of them are; any other Task when it has a Completion time. */
export const isDone = (state: State, task: TaskRow) => {
  const subs = subtasksOf(state, task.id);
  return subs.length ? subs.every((s) => s.completed_at) : !!task.completed_at;
};
export const hasSubtasks = (state: State, id: string) => subtasksOf(state, id).length > 0;

export function liveTask(state: State, id: string): TaskRow | undefined {
  return state.tasks.find((t) => t.id === id && !t.deleted_at);
}

function updateTask(id: string, set: Record<string, unknown>): Changes {
  return { inserts: [], updates: [{ table: 'tasks', id, set }], deletes: [] };
}

/**
 * Whether the Task or Sub-task can be placed into the Event: both exist, the Task has no Sub-tasks
 * (only its Sub-tasks are placed) and it is not already there. A drag asks this before offering a drop.
 */
export function canPlace(state: State, id: string, eventId: string): boolean {
  const task = liveTask(state, id);
  if (!task || !findEvent(state, eventId) || task.event_id === eventId) return false;
  return !hasSubtasks(state, id);
}

/** A Task takes the Event's day; a Sub-task keeps its own and follows the Event through its Placement. */
function placeTask(state: State, id: string, eventId: string, now: Now): Changes {
  if (!canPlace(state, id, eventId)) return noChanges();
  const task = liveTask(state, id)!;
  const event = findEvent(state, eventId)!;
  const set: Record<string, unknown> = { event_id: eventId };
  if (!task.parent_id && task.date !== event.date) set.date = event.date;
  return updateTask(id, { ...set, updated_at: now });
}

/** The Task stays on the day it has (the Event's day), so it is back in Anytime that day. */
function unplaceTask(state: State, id: string, now: Now): Changes {
  const task = liveTask(state, id);
  if (!task?.event_id) return noChanges();
  return updateTask(id, { event_id: null, updated_at: now });
}

/**
 * Whether the Task can be sent to Someday: it is a live Task with a date that is still open and not recurring.
 * A Sub-task follows its parent and cannot go on its own, and a recurring Task is always dated.
 * A drag asks this before offering the Someday tab as a drop.
 */
export function canUndate(state: State, id: string): boolean {
  const task = liveTask(state, id);
  return !!task && !task.parent_id && task.date !== null && !isDone(state, task) && !task.series_id;
}

/** The Task is left with no date and no Placement. */
function undateTask(state: State, id: string, now: Now): Changes {
  if (!canUndate(state, id)) return noChanges();
  const task = liveTask(state, id)!;
  return updateTask(id, { date: null, ...(task.event_id ? { event_id: null } : {}), updated_at: now });
}

/**
 * Whether the Task can be dated to the day: it exists, is not a Sub-task (a Sub-task follows its parent's day),
 * and the change would do something: another day, or the same day but with a Placement to clear.
 * A drop on a day chip or on Anytime asks this before offering the target.
 */
export function canDateTask(state: State, id: string, date: DateStr): boolean {
  const task = liveTask(state, id);
  if (!task || task.parent_id) return false;
  return task.date !== date || task.event_id !== null || placedOpenSubtasks(state, id).length > 0;
}

/** The open Sub-tasks of a Task that have a Placement: re-dating the Task clears those. */
const placedOpenSubtasks = (state: State, id: string) => subtasksOf(state, id).filter((s) => !s.completed_at && s.event_id !== null);

/**
 * The Task takes the day and loses its Placement, so it is in Anytime on that day. A parent brings its open Sub-tasks
 * along: their Placements are cleared, so they follow it. Done Sub-tasks keep theirs.
 */
export function dateTask(state: State, id: string, date: DateStr, now: Now): Changes {
  if (!canDateTask(state, id, date)) return noChanges();
  const task = liveTask(state, id)!;
  const set: Record<string, unknown> = {};
  if (task.date !== date) set.date = date;
  if (task.event_id !== null) set.event_id = null;
  const own = Object.keys(set).length ? updateTask(id, { ...set, updated_at: now }).updates : [];
  const subs = placedOpenSubtasks(state, id).flatMap((s) => updateTask(s.id, { event_id: null, updated_at: now }).updates);
  return { inserts: [], updates: [...own, ...subs], deletes: [] };
}

/**
 * Ticking records the Completion time; a Task that is already done keeps the time it has. A Someday Task is also
 * dated to the day it was ticked, so it shows in that day's Done today. Ticking a Task with Sub-tasks ticks all its
 * remaining Sub-tasks with the same time; a Someday parent is dated when it becomes done, by either way.
 */
function tickTask(state: State, id: string, now: Now): Changes {
  const task = liveTask(state, id);
  if (!task) return noChanges();
  const subs = state.tasks.filter((t) => t.parent_id === id && !t.deleted_at);
  const day = { date: dateOf(now) };
  if (subs.length) {
    const open = subs.filter((s) => !s.completed_at);
    if (!open.length) return noChanges();
    const ticks = open.flatMap((s) => updateTask(s.id, { completed_at: now, updated_at: now }).updates);
    const dating = task.date === null ? updateTask(id, { ...day, updated_at: now }).updates : [];
    return { inserts: [], updates: [...ticks, ...dating], deletes: [] };
  }
  if (task.completed_at) return noChanges();
  const set: Record<string, unknown> = { completed_at: now };
  if (!task.parent_id && task.date === null) set.date = day.date;
  const parent = task.parent_id ? liveTask(state, task.parent_id) : undefined;
  const siblings = parent ? state.tasks.filter((t) => t.parent_id === parent.id && !t.deleted_at && t.id !== id) : [];
  const completesParent = !!parent && parent.date === null && siblings.every((t) => t.completed_at);
  const dating = completesParent ? updateTask(parent!.id, { ...day, updated_at: now }).updates : [];
  return { inserts: [], updates: [...updateTask(id, { ...set, updated_at: now }).updates, ...dating], deletes: [] };
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

function renameTask(state: State, id: string, title: string, now: Now): Changes {
  const task = liveTask(state, id);
  const trimmed = title.trim();
  if (!task || !trimmed || trimmed === task.title) return noChanges();
  return updateTask(id, { title: trimmed, updated_at: now });
}

/**
 * A one-off Task is hard-deleted, and its Sub-tasks with it. An Occurrence is kept, marked deleted (with its Sub-tasks),
 * so it leaves no trace on screen but no device makes it again.
 */
function deleteTask(state: State, id: string, now: Now): Changes {
  const task = liveTask(state, id);
  if (!task) return noChanges();
  const subs = subtasksOf(state, id);
  if (task.series_id) {
    const updates = [task, ...subs].flatMap((t) => updateTask(t.id, { deleted_at: now, updated_at: now }).updates);
    return { inserts: [], updates, deletes: [] };
  }
  return { inserts: [], updates: [], deletes: [{ table: 'tasks', id }, ...subs.map((s) => ({ table: 'tasks' as const, id: s.id }))] };
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
