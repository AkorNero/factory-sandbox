import { addDays, dateOf, timeOf, today } from './dates.ts';
import type { DateStr, Now, State, TaskRow } from './types.ts';

export interface ItemView {
  id: string;
  title: string;
  parentTitle: string | null;
  carriedOver: boolean;
  recurring: boolean;
  /** 'HH:MM' of the Completion time, for done items. */
  completedTime: string | null;
}

export interface StripDay {
  date: DateStr;
  /** Dot count: Events that day. */
  events: number;
  /** Dot count: open Tasks that day. */
  tasks: number;
}

export interface DayView {
  date: DateStr;
  isToday: boolean;
  anytime: { count: number; items: ItemView[] };
  done: { count: number; total: number; items: ItemView[] };
  someday: { count: number; items: ItemView[] };
  strip: StripDay[];
}

const STRIP_DAYS = 8; // today and the next 7

/** Everything the screen shows for one day. State, a date and "now" in; a view out. Nothing here is stored. */
export function dayView(state: State, date: DateStr, now: Now): DayView {
  const live = state.tasks.filter((t) => !t.deleted_at);
  const byId = new Map(live.map((t) => [t.id, t]));

  const toItem = (t: TaskRow): ItemView => ({
    id: t.id,
    title: t.title,
    parentTitle: t.parent_id ? (byId.get(t.parent_id)?.title ?? null) : null,
    carriedOver: t.carried_over,
    recurring: t.series_id !== null,
    completedTime: t.completed_at ? timeOf(t.completed_at) : null,
  });

  const dayTasks = live.filter((t) => t.date === date);
  const open = dayTasks.filter((t) => !t.completed_at && !t.skipped_at);
  const anytime = open
    .filter((t) => !t.event_id)
    .sort((a, b) => Number(b.carried_over) - Number(a.carried_over) || a.position - b.position);
  const done = dayTasks
    .filter((t) => t.completed_at)
    .sort((a, b) => (a.completed_at! < b.completed_at! ? 1 : -1));
  const someday = live.filter((t) => t.date === null && !t.completed_at).sort((a, b) => a.position - b.position);

  const start = today(now);
  const strip: StripDay[] = Array.from({ length: STRIP_DAYS }, (_, i) => {
    const d = addDays(start, i);
    return {
      date: d,
      events: state.events.filter((e) => !e.deleted_at && e.date === d).length,
      tasks: live.filter((t) => t.date === d && !t.completed_at && !t.skipped_at).length,
    };
  });

  return {
    date,
    isToday: date === dateOf(now),
    anytime: { count: anytime.length, items: anytime.map(toItem) },
    done: { count: done.length, total: dayTasks.length, items: done.map(toItem) },
    someday: { count: someday.length, items: someday.map(toItem) },
    strip,
  };
}
