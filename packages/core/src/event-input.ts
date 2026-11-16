import type { TimeStr } from './types.ts';

const TIME = /^([01]?\d|2[0-3])(?::([0-5]\d))?$/;
const TYPED = /^(.*?)\s*\b(\d{1,2}(?::\d{2})?)\s*-\s*(\d{1,2}(?::\d{2})?)$/;

export type ParsedEvent = { ok: true; title: string; start: TimeStr; end: TimeStr } | { ok: false; error: string };

/** 'H', 'HH' or 'H:MM' to 'HH:MM'; null when it is not a clock time of one day (00:00 to 23:59). */
function clock(text: string): TimeStr | null {
  const m = TIME.exec(text.trim());
  if (!m) return null;
  return `${m[1]!.padStart(2, '0')}:${m[2] ?? '00'}`;
}

/** The rule every Event obeys (spec assumption A2): it ends after it starts, on the same day. Null when fine. */
export function checkEventTimes(start: string, end: string): string | null {
  const s = clock(start);
  const e = clock(end);
  if (!s || !e) return 'Times must be between 00:00 and 23:59, like 18:30.';
  if (e <= s) return 'An Event must end after it starts, on the same day.';
  return null;
}

/** Reads what is typed at the end of Later today: "Gym 18-19" or "Gym 18:30-19:15". */
export function parseEventInput(text: string): ParsedEvent {
  const typed = text.trim();
  const m = TYPED.exec(typed);
  if (!m) return { ok: false, error: 'Add a start and end time, like Gym 18-19.' };
  const title = m[1]!.trim();
  if (!title) return { ok: false, error: 'Give the Event a name, like Gym 18-19.' };
  const start = clock(m[2]!);
  const end = clock(m[3]!);
  if (!start || !end) return { ok: false, error: 'Times must be between 00:00 and 23:59, like 18:30.' };
  const error = checkEventTimes(start, end);
  return error ? { ok: false, error } : { ok: true, title, start, end };
}
