import type { DateStr, Now, TimeStr } from './types.ts';

/** Local calendar date of a "now" / local timestamp. */
export const dateOf = (ts: string): DateStr => ts.slice(0, 10);
/** Local clock time 'HH:MM' of a local timestamp. */
export const timeOf = (ts: string): TimeStr => ts.slice(11, 16);
export const today = (now: Now): DateStr => dateOf(now);

/** Calendar arithmetic on 'YYYY-MM-DD' without touching the real clock or the machine's timezone. */
export function addDays(date: DateStr, n: number): DateStr {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}

/** Minutes since midnight of an 'HH:MM' time. */
export const minutesOf = (time: string): number => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));

/** "45m", "2h", "2h 20m". */
export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h === 0 ? `${m}m` : m === 0 ? `${h}h` : `${h}h ${m}m`;
}

const dayNumber = (date: DateStr): number => {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return Math.round(Date.UTC(y, m - 1, d) / 86_400_000);
};

/** Days from `a` to `b` (negative when b is earlier). */
export const daysBetween = (a: DateStr, b: DateStr): number => dayNumber(b) - dayNumber(a);

/** ISO weekday: 1 = Monday ... 7 = Sunday. (Day 0 of the epoch, 1970-01-01, was a Thursday.) */
export const isoWeekday = (date: DateStr): number => ((((dayNumber(date) + 3) % 7) + 7) % 7) + 1;

/** Days in the month of a date. */
export function daysInMonth(date: DateStr): number {
  const [y, m] = date.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}
