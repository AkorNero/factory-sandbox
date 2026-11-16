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
