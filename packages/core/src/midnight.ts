import { applyChanges, mergeChanges } from './changes.ts';
import { today } from './dates.ts';
import type { Changes, Now, State, TaskRow, Update } from './types.ts';

/**
 * The midnight jobs. Every device runs them, at local midnight and on its first start after a missed one, so they
 * are deterministic: the rows they write have no random ids, and their timestamps come from the date of "now" alone
 * (never its time of day), so two devices that run them on the same data write identical column values.
 * Running them again changes nothing.
 */
type Step = (state: State, now: Now) => Changes;

/**
 * In order. Each step sees the rows the one before it changed. Skipped (an Occurrence left undone when the next one
 * arrives, #31) goes first, so it is closed before Carry-over would move it on.
 */
const STEPS: Step[] = [carryOver];

export function runMidnight(state: State, now: Now): Changes {
  let current = state;
  const done: Changes[] = [];
  for (const step of STEPS) {
    const changes = step(current, now);
    current = applyChanges(current, changes);
    done.push(changes);
  }
  return mergeChanges(...done);
}

/** The timestamp the midnight jobs write: today's midnight, with the UTC offset of "now". */
export const midnightStamp = (now: Now): string => `${today(now)}T00:00:00${now.slice(19)}`;

const byId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * Carry-over: every unfinished dated Task and Sub-task from an earlier day moves to today, however many days
 * ago that was, loses its Placement and is marked as carried over. Someday Tasks, finished and Skipped items and
 * Events stay where they are.
 *
 * An item's day is its Event's date when placed; otherwise its own date (Task) or its parent's day (Sub-task).
 * So a Sub-task moves to today by losing its Placement and following its parent, and its parent, which is never
 * listed on a day itself, takes today's date. An unplaced Sub-task of a Someday parent has no day to be before today.
 */
function carryOver(state: State, now: Now): Changes {
  const day = today(now);
  const stamp = midnightStamp(now);
  const tasks = state.tasks.filter((t) => !t.deleted_at);
  const taskById = new Map(tasks.map((t) => [t.id, t]));
  const events = new Map(state.events.filter((e) => !e.deleted_at).map((e) => [e.id, e]));
  const subtasksOf = (id: string) => tasks.filter((t) => t.parent_id === id);
  const isOpen = (t: TaskRow) => !t.completed_at && !t.skipped_at;

  const placedIn = (t: TaskRow) => (t.event_id ? events.get(t.event_id) : undefined);
  const dayOf = (t: TaskRow) => placedIn(t)?.date ?? (t.parent_id ? (taskById.get(t.parent_id)?.date ?? null) : t.date);
  const before = (d: string | null) => d !== null && d < day;

  const updates: Update[] = [];
  for (const t of [...tasks].sort(byId)) {
    const subs = subtasksOf(t.id);
    if (subs.length) {
      // a parent is never listed itself: it just keeps up with its open Sub-tasks
      if (!t.skipped_at && before(t.date) && subs.some(isOpen)) updates.push({ table: 'tasks', id: t.id, set: { date: day, updated_at: stamp } });
      continue;
    }
    if (!isOpen(t) || !before(dayOf(t))) continue;

    const set: Record<string, unknown> = {};
    if (!t.parent_id) set.date = day;
    if (t.event_id) {
      set.event_id = null;
      // yesterday's Event remembers it as a missed slot, even though the item has left it
      if (placedIn(t)) set.carried_from_event_id = t.event_id;
    }
    if (!t.carried_over) set.carried_over = true;
    set.carried_on = day;
    updates.push({ table: 'tasks', id: t.id, set: { ...set, updated_at: stamp } });
  }
  return { inserts: [], updates, deletes: [] };
}
