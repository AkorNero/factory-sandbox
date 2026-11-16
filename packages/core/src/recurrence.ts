import { addDays, daysBetween, daysInMonth, isoWeekday } from './dates.ts';
import type { DateStr, SeriesRow } from './types.ts';

/** The chosen weekdays of a weekdays rule, ISO numbered (1 = Monday ... 7 = Sunday). */
export function weekdaysOf(series: Pick<SeriesRow, 'weekdays'>): number[] {
  try {
    const parsed: unknown = JSON.parse(series.weekdays ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((n): n is number => Number.isInteger(n) && n >= 1 && n <= 7) : [];
  } catch {
    return [];
  }
}

/**
 * Whether the rule lands on the day, judged only by the rule and the calendar: never by when anything was
 * completed, so ticking late shifts nothing. starts-on / ends-on are not checked here.
 */
function fallsOn(series: SeriesRow, date: DateStr): boolean {
  switch (series.rule) {
    case 'every_n_days': {
      const n = Math.max(1, series.interval_n ?? 1);
      return daysBetween(series.anchor_date, date) % n === 0;
    }
    case 'weekdays': {
      if (!weekdaysOf(series).includes(isoWeekday(date))) return false;
      const n = Math.max(1, series.interval_n ?? 1);
      // weeks run Monday to Sunday; the anchor date's week is week 0
      const monday = (d: DateStr) => addDays(d, 1 - isoWeekday(d));
      return (daysBetween(monday(series.anchor_date), monday(date)) / 7) % n === 0;
    }
    case 'day_of_month': {
      // the 31st means the last day of shorter months
      const want = Math.min(series.day_of_month ?? 1, daysInMonth(date));
      return Number(date.slice(8, 10)) === want;
    }
  }
}

/** The days in [from, to] the series falls on, within its starts-on and ends-on. */
export function occurrenceDates(series: SeriesRow, from: DateStr, to: DateStr): DateStr[] {
  const first = from > series.starts_on ? from : series.starts_on;
  const last = series.ends_on && series.ends_on < to ? series.ends_on : to;
  const dates: DateStr[] = [];
  for (let d = first; d <= last; d = addDays(d, 1)) if (fallsOn(series, d)) dates.push(d);
  return dates;
}

/**
 * Whether the next Occurrence of a Task's series arrives in (after, upTo]: the schedule lands on some day in that
 * range. Judged by the schedule alone, whether or not that Occurrence has been made yet, so every device agrees.
 * All segments of the series' lineage count, since a split hands the schedule over to the next segment.
 */
export function nextArrivesBy(all: SeriesRow[], seriesId: string, after: DateStr, upTo: DateStr): boolean {
  const own = all.find((s) => s.id === seriesId);
  if (!own || upTo <= after) return false;
  return all.filter((s) => s.lineage_id === own.lineage_id).some((s) => occurrenceDates(s, addDays(after, 1), upTo).length > 0);
}

const DAY_NAMES =['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;

/** The short name shown after ↻: "daily", "every 3 days", "weekdays", "Mon/Wed", "every 2 weeks · Mon", "monthly on the 31st". */
export function recurrenceLabel(series: SeriesRow): string {
  switch (series.rule) {
    case 'every_n_days': {
      const n = series.interval_n ?? 1;
      return n === 1 ? 'daily' : `every ${n} days`;
    }
    case 'weekdays': {
      const days = [...new Set(weekdaysOf(series))].sort();
      const weeks = series.interval_n ?? 1;
      const names = days.map((d) => DAY_NAMES[d - 1]).join('/');
      if (weeks > 1) return `every ${weeks} weeks · ${names}`;
      if (days.length === 7) return 'daily';
      return days.join() === '1,2,3,4,5' ? 'weekdays' : names;
    }
    case 'day_of_month':
      return `monthly on the ${ordinal(series.day_of_month ?? 1)}`;
  }
}
