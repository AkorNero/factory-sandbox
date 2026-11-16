import { mergeChanges } from './changes.ts';
import { addDays } from './dates.ts';
import { splitSeriesId } from './ids.ts';
import type { Changes, Command, DateStr, EventRow, Now, SeriesRow, SeriesTemplate, State, TaskRow, Update } from './types.ts';
import { noChanges } from './types.ts';
import { isDone } from './commands.ts';
import { checkEventTimes, normaliseTime } from './event-input.ts';
import { parseTemplate } from './series.ts';

/**
 * Editing a repeating Task or Event: the "This and following" scope, series splitting, Change schedule and Stop repeating.
 *
 * A Recurrence is a lineage of segments (series rows with one lineage id). A "this and following" edit splits the segment
 * that covers the opened Occurrence's day: the old one ends the day before, a new one starts that day with the change.
 * Occurrences are never re-linked to a new segment: a day belongs to the whole lineage, whichever segment made it.
 */

/** An Occurrence the edit is about: a top-level Task or an Event that is linked to a series and has an occurrence day. */
type Occurrence = { kind: 'task'; row: TaskRow } | { kind: 'event'; row: EventRow };

const isOccurrenceTask = (t: TaskRow) => !t.parent_id && t.series_id !== null && t.occurrence_date !== null;
const isOccurrenceEvent = (e: EventRow) => e.series_id !== null && e.occurrence_date !== null;

/** The Occurrence the id is, or for a Sub-task the Occurrence it belongs to. Deleted rows are not found. */
function occurrenceOf(state: State, id: string): Occurrence | undefined {
  const task = state.tasks.find((t) => t.id === id && !t.deleted_at);
  if (task) {
    const top = task.parent_id ? state.tasks.find((t) => t.id === task.parent_id && !t.deleted_at) : task;
    return top && isOccurrenceTask(top) ? { kind: 'task', row: top } : undefined;
  }
  const event = state.events.find((e) => e.id === id && !e.deleted_at);
  return event && isOccurrenceEvent(event) ? { kind: 'event', row: event } : undefined;
}

/** Whether a menu edit of the item must ask "Just this one" or "This and following": it is an Occurrence or a Sub-task of one. */
export const asksScope = (state: State, id: string): boolean => {
  const occ = occurrenceOf(state, id);
  return !!occ && state.series.some((s) => s.id === occ.row.series_id);
};

/** A series edit never changes a Task that is done or Skipped. */
const frozen = (state: State, t: TaskRow) => !!t.skipped_at || isDone(state, t);

function lineageOf(state: State, occ: Occurrence) {
  const own = state.series.find((s) => s.id === occ.row.series_id);
  if (!own) return undefined;
  const segments = state.series.filter((s) => s.lineage_id === own.lineage_id);
  return { id: own.lineage_id, own, segments, ids: new Set(segments.map((s) => s.id)), from: occ.row.occurrence_date! };
}
type Lineage = NonNullable<ReturnType<typeof lineageOf>>;

/** The Task Occurrences of the lineage from the opened one's day on, that a series edit may change. The opened one always is. */
function laterTasks(state: State, l: Lineage, openedId: string): TaskRow[] {
  return state.tasks.filter(
    (t) =>
      !t.deleted_at &&
      isOccurrenceTask(t) &&
      l.ids.has(t.series_id!) &&
      t.occurrence_date! >= l.from &&
      (t.id === openedId || !frozen(state, t)),
  );
}

function laterEvents(state: State, l: Lineage): EventRow[] {
  return state.events.filter((e) => !e.deleted_at && isOccurrenceEvent(e) && l.ids.has(e.series_id!) && e.occurrence_date! >= l.from);
}

const updateRow = (table: 'tasks' | 'events', id: string, set: Record<string, unknown>, now: Now): Update => ({ table, id, set: { ...set, updated_at: now } });

/**
 * Change the series template from the opened Occurrence's day on: the segment that covers the day is split there (or
 * changed in place when it starts there), and every later segment of the lineage is changed too.
 */
function patchTemplates(state: State, l: Lineage, patch: (t: SeriesTemplate) => SeriesTemplate, now: Now): Changes {
  const covering = l.segments.find((s) => s.starts_on <= l.from && (s.ends_on === null || s.ends_on >= l.from)) ?? l.own;
  const patched = (s: SeriesRow) => JSON.stringify(patch(parseTemplate(s)));
  const changes: Changes = noChanges();
  for (const s of l.segments) {
    if (s.id === covering.id && s.starts_on < l.from && (s.ends_on === null || s.ends_on >= l.from)) {
      changes.inserts.push({
        table: 'series',
        row: { ...s, id: splitSeriesId(s.id, l.from), starts_on: l.from, template: patched(s), created_at: now, updated_at: now },
      });
      changes.updates.push({ table: 'series', id: s.id, set: { ends_on: addDays(l.from, -1), updated_at: now } });
    } else if (s.starts_on >= l.from) {
      changes.updates.push({ table: 'series', id: s.id, set: { template: patched(s), updated_at: now } });
    }
  }
  return changes;
}

type FollowingCommand = Extract<Command, { scope?: unknown }>;

/**
 * An edit with the "This and following" scope. Returns nothing when the item is not an Occurrence of a known series,
 * so the plain edit applies.
 */
export function editFollowing(state: State, cmd: FollowingCommand, now: Now): Changes | undefined {
  const occ = occurrenceOf(state, cmd.type === 'addSubtask' ? cmd.parentId : cmd.id);
  const l = occ && lineageOf(state, occ);
  if (!occ || !l) return undefined;
  switch (cmd.type) {
    case 'renameTask': {
      const title = cmd.title.trim();
      if (occ.kind !== 'task' || occ.row.id !== cmd.id) return undefined;
      if (!title || title === occ.row.title) return noChanges();
      const updates = laterTasks(state, l, occ.row.id).filter((t) => t.title !== title).map((t) => updateRow('tasks', t.id, { title }, now));
      return mergeChanges({ inserts: [], updates, deletes: [] }, patchTemplates(state, l, (t) => ({ ...t, title }), now));
    }
    case 'renameEvent': {
      const title = cmd.title.trim();
      if (occ.kind !== 'event' || occ.row.id !== cmd.id) return undefined;
      if (!title || title === occ.row.title) return noChanges();
      const updates = laterEvents(state, l).filter((e) => e.title !== title).map((e) => updateRow('events', e.id, { title }, now));
      return mergeChanges({ inserts: [], updates, deletes: [] }, patchTemplates(state, l, (t) => ({ ...t, title }), now));
    }
    case 'setEventTimes': {
      if (occ.kind !== 'event' || occ.row.id !== cmd.id || checkEventTimes(cmd.start, cmd.end)) return undefined;
      // only the time that was edited is overwritten: a hand-moved other time on a later Event survives
      const edit: { start_time?: string; end_time?: string } = {};
      if (normaliseTime(cmd.start) !== occ.row.start_time) edit.start_time = normaliseTime(cmd.start)!;
      if (normaliseTime(cmd.end) !== occ.row.end_time) edit.end_time = normaliseTime(cmd.end)!;
      if (!edit.start_time && !edit.end_time) return noChanges();
      const updates = laterEvents(state, l)
        .map((e) => ({ e, set: Object.fromEntries(Object.entries(edit).filter(([k, v]) => e[k as keyof typeof edit] !== v)) }))
        .filter(({ set }) => Object.keys(set).length > 0)
        .map(({ e, set }) => updateRow('events', e.id, set, now));
      const patch = (t: SeriesTemplate): SeriesTemplate => ({
        ...t,
        ...(edit.start_time ? { start: edit.start_time } : {}),
        ...(edit.end_time ? { end: edit.end_time } : {}),
      });
      return mergeChanges({ inserts: [], updates, deletes: [] }, patchTemplates(state, l, patch, now));
    }
    default:
      return undefined;
  }
}

export function changeSchedule(_state: State, _cmd: Extract<Command, { type: 'changeSchedule' }>, _now: Now): Changes {
  return noChanges();
}

export function stopRepeating(_state: State, _id: string, _now: Now): Changes {
  return noChanges();
}

export type { DateStr };
