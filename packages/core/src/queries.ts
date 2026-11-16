import { addDays, dateOf, minutesOf, timeOf, today } from './dates.ts';
import type { DateStr, EventRow, Now, State, TaskRow } from './types.ts';

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

/** An Event as listed in Next, Later today and Earlier today. */
export interface EventCard {
  id: string;
  title: string;
  start: string;
  end: string;
  durationMinutes: number;
  /** Minutes until it starts; null on any day but today. */
  startsInMinutes: number | null;
  /** Minutes since it ended; null on any day but today. */
  endedMinutesAgo: number | null;
}

/** A live Event on the Now card. */
export interface NowCard {
  id: string;
  title: string;
  start: string;
  end: string;
  minutesLeft: number;
  /** 0 to 1 */
  progress: number;
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

/** Where the day's Events stand against the clock. */
function eventSections(events: EventRow[], date: DateStr, now: Now) {
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
    start: e.start_time,
    end: e.end_time,
    durationMinutes: minutesOf(e.end_time) - minutesOf(e.start_time),
    startsInMinutes: isToday ? minutesOf(e.start_time) - nowMin : null,
    endedMinutesAgo: isToday ? nowMin - minutesOf(e.end_time) : null,
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
        return { id: e.id, title: e.title, start: e.start_time, end: e.end_time, minutesLeft: left, progress: 1 - left / length };
      }),
    },
    next: nextStart ? { start: nextStart, startsInMinutes: minutesOf(nextStart) - nowMin, events: next.map(card) } : null,
    later: { count: later.length, events: later.map(card) },
    earlier: { count: earlier.length, events: earlier.map(card) },
  };
}

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
    ...eventSections(state.events, date, now),
    anytime: { count: anytime.length, items: anytime.map(toItem) },
    done: { count: done.length, total: dayTasks.length, items: done.map(toItem) },
    someday: { count: someday.length, items: someday.map(toItem) },
    strip,
  };
}
