import { recurrenceLabel } from './recurrence.ts';
import { addDays, dateOf, minutesOf, timeOf, today } from './dates.ts';
import type { DateStr, EventRow, Now, State, TaskRow } from './types.ts';

export interface ItemView {
  id: string;
  title: string;
  parentTitle: string | null;
  parentId: string | null;
  /** For a Task with Sub-tasks: how many are done, out of how many. null for any other item. */
  subtasks: { done: number; total: number } | null;
  carriedOver: boolean;
  recurring: boolean;
  /** The short name of its Recurrence, shown after ↻ ("daily", "Mon/Wed"); null when it does not recur. */
  recurrence: string | null;
  /** A Task with no date: it is in Someday. */
  someday: boolean;
  /** 'HH:MM' of the Completion time, for done items. */
  completedTime: string | null;
  /** The Event it is placed in; null when Unplaced. */
  placement: { eventId: string; title: string } | null;
  /** The title of the Event it was done in (worked out from the Completion time); null when done outside every Event. */
  doneIn: string | null;
}

export interface StripDay {
  date: DateStr;
  /** Dot count: Events that day. */
  events: number;
  /** Dot count: open Tasks that day. */
  tasks: number;
}

/** An Event as listed in Next, Later today and Earlier today. */
export interface EventCard {
  id: string;
  title: string;
  /** Short name of its Recurrence, null for a one-off Event. */
  recurrence: string | null;
  start: string;
  end: string;
  durationMinutes: number;
  /** Minutes until it starts; null on any day but today. */
  startsInMinutes: number | null;
  /** Minutes since it ended; null on any day but today. */
  endedMinutesAgo: number | null;
  /** The Tasks and Sub-tasks placed in it, done ones included. */
  tasks: ItemView[];
  /** How many of the placed items are done, out of how many are placed ("1/3 done"). */
  placedDone: number;
  placedTotal: number;
  /** The slot ended with unfinished placed items. They stay in the Event; nothing moves yet. */
  slotMissed: boolean;
  /** The items done in this Event (from their Completion time), whether or not they were placed in it. */
  doneHere: ItemView[];
}

/** A live Event on the Now card. */
export interface NowCard {
  id: string;
  title: string;
  recurrence: string | null;
  start: string;
  end: string;
  minutesLeft: number;
  /** 0 to 1 */
  progress: number;
  tasks: ItemView[];
  placedDone: number;
  placedTotal: number;
}

export interface DayView {
  date: DateStr;
  isToday: boolean;
  /** The live Events, most recently started first. No cards means "Free". */
  now: { cards: NowCard[] };
  /** The Events that start soonest after now, all those starting at that same time. Today only. */
  next: { start: string; startsInMinutes: number; events: EventCard[] } | null;
  later: { count: number; events: EventCard[] };
  earlier: { count: number; events: EventCard[] };
  anytime: { count: number; items: ItemView[] };
  done: { count: number; total: number; items: ItemView[] };
  someday: { count: number; items: ItemView[] };
  strip: StripDay[];
}

const STRIP_DAYS = 8; // today and the next 7

const isDate = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d) && addDays(d, 0) === d;

/** Whether a day can be picked onto the strip: a real date after the 7 days it already shows. */
export const canPickDay = (now: Now, date: string): boolean => isDate(date) && date >= addDays(today(now), STRIP_DAYS);

const placedCounts = (tasks: ItemView[]) => ({
  tasks,
  placedDone: tasks.filter((t) => t.completedTime).length,
  placedTotal: tasks.length,
});

/** Where the day's Events stand against the clock. */
function eventSections(
  events: EventRow[],
  date: DateStr,
  now: Now,
  placed: (eventId: string) => ItemView[],
  doneIn: (eventId: string) => ItemView[],
  recurrence: (seriesId: string | null) => string | null,
) {
  const day = events.filter((e) => !e.deleted_at && e.date === date);
  const isToday = date === dateOf(now);
  const nowMin = minutesOf(timeOf(now));
  const phase = (e: EventRow): 'earlier' | 'live' | 'upcoming' => {
    if (date < dateOf(now)) return 'earlier';
    if (date > dateOf(now)) return 'upcoming';
    return minutesOf(e.end_time) <= nowMin ? 'earlier' : minutesOf(e.start_time) <= nowMin ? 'live' : 'upcoming';
  };
  const card = (e: EventRow): EventCard => ({
    id: e.id,
    title: e.title,
    recurrence: recurrence(e.series_id),
    start: e.start_time,
    end: e.end_time,
    durationMinutes: minutesOf(e.end_time) - minutesOf(e.start_time),
    startsInMinutes: isToday ? minutesOf(e.start_time) - nowMin : null,
    endedMinutesAgo: isToday ? nowMin - minutesOf(e.end_time) : null,
    ...placedCounts(placed(e.id)),
    slotMissed: phase(e) === 'earlier' && placed(e.id).some((t) => !t.completedTime),
    doneHere: doneIn(e.id),
  });
  const byStart = (a: EventRow, b: EventRow) =>
    a.start_time.localeCompare(b.start_time) || a.end_time.localeCompare(b.end_time) || a.id.localeCompare(b.id);

  const live = day.filter((e) => phase(e) === 'live').sort((a, b) => byStart(b, a) || 0);
  const upcoming = day.filter((e) => phase(e) === 'upcoming').sort(byStart);
  const earlier = day.filter((e) => phase(e) === 'earlier').sort((a, b) => b.end_time.localeCompare(a.end_time) || byStart(b, a));

  const nextStart = isToday ? upcoming[0]?.start_time : undefined;
  const next = upcoming.filter((e) => e.start_time === nextStart);
  const later = upcoming.filter((e) => !next.includes(e));

  return {
    now: {
      cards: live.map((e): NowCard => {
        const left = minutesOf(e.end_time) - nowMin;
        const length = minutesOf(e.end_time) - minutesOf(e.start_time);
        return { id: e.id, title: e.title, recurrence: recurrence(e.series_id), start: e.start_time, end: e.end_time, minutesLeft: left, progress: 1 - left / length, ...placedCounts(placed(e.id)) };
      }),
    },
    next: nextStart ? { start: nextStart, startsInMinutes: minutesOf(nextStart) - nowMin, events: next.map(card) } : null,
    later: { count: later.length, events: later.map(card) },
    earlier: { count: earlier.length, events: earlier.map(card) },
  };
}

const covers = (e: EventRow, time: string) => e.start_time <= time && time < e.end_time;

/**
 * The Event a done item was done in, worked out from its Completion time: the Event it is placed in if that
 * covers the time, else the most recently started Event covering it, else none.
 */
function doneInEvent(task: TaskRow, events: Map<string, EventRow>): EventRow | undefined {
  const date = dateOf(task.completed_at!);
  const time = timeOf(task.completed_at!);
  const placed = task.event_id ? events.get(task.event_id) : undefined;
  if (placed && placed.date === date && covers(placed, time)) return placed;
  return [...events.values()]
    .filter((e) => e.date === date && covers(e, time))
    .sort((a, b) => b.start_time.localeCompare(a.start_time) || b.end_time.localeCompare(a.end_time) || b.id.localeCompare(a.id))[0];
}

/**
 * Everything the screen shows for one day. State, a date and "now" in; a view out. Nothing here is stored.
 * `pickedDays` are the later days the user added to the strip with "Pick a day".
 */
/** What the views need to turn rows into items. */
function itemContext(state: State, now: Now) {
  const live = state.tasks.filter((t) => !t.deleted_at);
  const byId = new Map(live.map((t) => [t.id, t]));
  const events = new Map(state.events.filter((e) => !e.deleted_at).map((e) => [e.id, e]));
  /** The Event a Task is placed in; a Placement that points at a missing Event counts as Unplaced. */
  const placedIn = (t: TaskRow) => (t.event_id ? events.get(t.event_id) : undefined);
  /** An item's effective day: its Event's date if placed, else its own date (Task) or its parent's day (Sub-task). */
  const effectiveDay = (t: TaskRow): DateStr | null =>
    placedIn(t)?.date ?? (t.parent_id ? (byId.get(t.parent_id)?.date ?? null) : t.date);

  const seriesLabels = new Map(state.series.map((s) => [s.id, recurrenceLabel(s)]));
  const recurrenceOf = (seriesId: string | null) => (seriesId ? (seriesLabels.get(seriesId) ?? null) : null);

  const subtasksOf = (id: string) => live.filter((t) => t.parent_id === id);
  /** A Task with Sub-tasks is done exactly when all of them are; nothing is stored on it. */
  const isDone = (t: TaskRow) => (subtasksOf(t.id).length ? subtasksOf(t.id).every((s) => s.completed_at) : !!t.completed_at);

  const toItem = (t: TaskRow): ItemView => ({
    id: t.id,
    title: t.title,
    parentTitle: t.parent_id ? (byId.get(t.parent_id)?.title ?? null) : null,
    parentId: t.parent_id,
    subtasks: subtasksOf(t.id).length ? { done: subtasksOf(t.id).filter((s) => s.completed_at).length, total: subtasksOf(t.id).length } : null,
    carriedOver: t.carried_over,
    recurring: t.series_id !== null,
    recurrence: recurrenceOf(t.series_id),
    someday: t.parent_id === null && t.date === null,
    completedTime: t.completed_at ? timeOf(t.completed_at) : null,
    placement: placedIn(t) ? { eventId: t.event_id!, title: placedIn(t)!.title } : null,
    doneIn: t.completed_at ? (doneInEvent(t, events)?.title ?? null) : null,
  });
  return { live, byId, events, placedIn, effectiveDay, subtasksOf, isDone, toItem, recurrenceOf };
}

/**
 * One Task or Sub-task as an item, wherever it is on screen (or on no screen: a Task with Sub-tasks is never
 * listed on a day, but its tap menu can still be opened from one of its Sub-tasks).
 */
export function taskItem(state: State, id: string, now: Now): ItemView | undefined {
  const c = itemContext(state, now);
  const t = c.byId.get(id);
  return t && c.toItem(t);
}

export function dayView(state: State, date: DateStr, now: Now, pickedDays: DateStr[] = []): DayView {
  const { live, byId, events, placedIn, effectiveDay, isDone, toItem, recurrenceOf } = itemContext(state, now);
  const placed = (eventId: string) =>
    live
      .filter((t) => t.event_id === eventId && !t.skipped_at)
      .sort((a, b) => a.position - b.position)
      .map(toItem);

  const doneInEventId = (t: TaskRow) => (t.completed_at ? doneInEvent(t, events)?.id : undefined);
  const doneHere = (eventId: string) =>
    live
      .filter((t) => doneInEventId(t) === eventId)
      .sort((a, b) => (a.completed_at! < b.completed_at! ? 1 : -1))
      .map(toItem);

  /** A Task with Sub-tasks is never listed on a day itself: its Sub-tasks are. */
  const hasSubtasks = new Set(live.filter((t) => t.parent_id).map((t) => t.parent_id));
  const dayTasks = live.filter((t) => !hasSubtasks.has(t.id) && effectiveDay(t) === date);
  const open = dayTasks.filter((t) => !t.completed_at && !t.skipped_at);
  const anytime = open
    .filter((t) => !placedIn(t))
    .sort((a, b) => Number(b.carried_over) - Number(a.carried_over) || a.position - b.position);
  const done = dayTasks
    .filter((t) => t.completed_at)
    .sort((a, b) => (a.completed_at! < b.completed_at! ? 1 : -1));
  const someday = live.filter((t) => t.parent_id === null && t.date === null && !isDone(t)).sort((a, b) => a.position - b.position);

  const start = today(now);
  const picked = [...new Set(pickedDays.filter((d) => canPickDay(now, d)))].sort();
  const stripDates = [...Array.from({ length: STRIP_DAYS }, (_, i) => addDays(start, i)), ...picked];
  const strip: StripDay[] = stripDates.map((d) => {
    return {
      date: d,
      events: state.events.filter((e) => !e.deleted_at && e.date === d).length,
      tasks: live.filter((t) => !hasSubtasks.has(t.id) && effectiveDay(t) === d && !t.completed_at && !t.skipped_at).length,
    };
  });

  return {
    date,
    isToday: date === dateOf(now),
    ...eventSections(state.events, date, now, placed, doneHere, recurrenceOf),
    anytime: { count: anytime.length, items: anytime.map(toItem) },
    done: { count: done.length, total: dayTasks.length, items: done.map(toItem) },
    someday: { count: someday.length, items: someday.map(toItem) },
    strip,
  };
}
