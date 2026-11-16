import { dateOf, type Now } from '@dayplanner/core';

/**
 * The single source of "now" for the UI (and later the midnight jobs).
 * It reads the page's Date, so tests control it with page.clock; the planner core never sees a real clock.
 */
export interface Clock {
  /** Local date-time with UTC offset, e.g. 2026-11-16T10:15:00+01:00 */
  now(): Now;
  /** Called at the start of every minute, and whenever the tab becomes visible again. Returns an unsubscribe. */
  subscribe(listener: () => void): () => void;
  /**
   * Called right away, which is the first start after any midnight missed while the app was closed, and then
   * whenever the local date changes (at local midnight, or when the tab wakes up on a later day).
   * This is what drives the midnight jobs. Returns an unsubscribe.
   */
  onNewDay(listener: () => void): () => void;
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

export function formatLocal(d: Date): Now {
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const abs = Math.abs(off);
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  );
}

export function createClock(): Clock {
  const clock: Clock = {
    now: () => formatLocal(new Date()),
    subscribe(listener) {
      let timer: ReturnType<typeof setTimeout>;
      const schedule = () => {
        const ms = 60_000 - (Date.now() % 60_000);
        timer = setTimeout(() => {
          listener();
          schedule();
        }, ms + 50);
      };
      const onVisible = () => {
        if (document.visibilityState === 'visible') listener();
      };
      document.addEventListener('visibilitychange', onVisible);
      schedule();
      return () => {
        clearTimeout(timer);
        document.removeEventListener('visibilitychange', onVisible);
      };
    },
    onNewDay(listener) {
      let last: string | null = null;
      const check = () => {
        const day = dateOf(clock.now());
        if (day === last) return;
        last = day;
        listener();
      };
      check();
      return clock.subscribe(check);
    },
  };
  return clock;
}
