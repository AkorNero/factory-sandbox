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
