import { describe, expect, it } from 'vitest';
import { apply, applyChanges, dayView, formatDuration } from '../src/index.ts';
import { MON_10_15, TODAY, aState, anEvent } from './helpers.ts';

/** Monday 16 November 2026 at the given local time. */
const at = (hhmm: string) => `2026-11-16T${hhmm}:00+01:00`;
const ev = (id: string, title: string, start_time: string, end_time: string, over = {}) =>
  anEvent({ id, title, start_time, end_time, ...over });

describe('Now', () => {
  it('shows "Free" when no Event is live', () => {
    const view = dayView(aState({ events: [ev('a', 'Gym', '18:00', '19:00')] }), TODAY, MON_10_15);

    expect(view.now.cards).toEqual([]);
  });

  it('shows the live Event with its time range, time left and progress', () => {
    const state = aState({ events: [ev('a', 'Deep work', '09:30', '11:30')] });

    const [card, ...rest] = dayView(state, TODAY, at('10:30')).now.cards;

    expect(rest).toEqual([]);
    expect(card).toMatchObject({ id: 'a', title: 'Deep work', start: '09:30', end: '11:30', minutesLeft: 60, progress: 0.5 });
  });

  it('counts an Event as live from its start minute until just before its end minute', () => {
    const state = aState({ events: [ev('a', 'Call', '10:00', '10:30')] });

    expect(dayView(state, TODAY, at('09:59')).now.cards).toHaveLength(0);
    expect(dayView(state, TODAY, at('10:00')).now.cards).toHaveLength(1);
    expect(dayView(state, TODAY, at('10:29')).now.cards).toHaveLength(1);
    expect(dayView(state, TODAY, at('10:30')).now.cards).toHaveLength(0);
  });

  it('puts the most recently started Event first when several are live', () => {
    const state = aState({
      events: [ev('a', 'Long block', '09:00', '12:00'), ev('b', 'Quick call', '10:00', '10:30'), ev('c', 'Admin', '08:00', '11:00')],
    });

    const view = dayView(state, TODAY, at('10:15'));

    expect(view.now.cards.map((c) => c.title)).toEqual(['Quick call', 'Long block', 'Admin']);
  });

  it('ignores deleted Events and Events on other days', () => {
    const state = aState({
      events: [
        ev('a', 'Gone', '10:00', '11:00', { deleted_at: at('08:00') }),
        ev('b', 'Tomorrow', '10:00', '11:00', { date: '2026-11-17' }),
      ],
    });

    expect(dayView(state, TODAY, at('10:15')).now.cards).toEqual([]);
  });
});

describe('Next', () => {
  it('is empty when nothing else starts today', () => {
    expect(dayView(aState(), TODAY, MON_10_15).next).toBeNull();
    expect(dayView(aState({ events: [ev('a', 'Done', '08:00', '09:00')] }), TODAY, MON_10_15).next).toBeNull();
  });

  it('shows the next Event and how long until it starts', () => {
    const state = aState({ events: [ev('a', 'Gym', '12:35', '13:35'), ev('b', 'Dinner', '19:00', '20:00')] });

    const next = dayView(state, TODAY, MON_10_15).next;

    expect(next).toMatchObject({ start: '12:35', startsInMinutes: 140 });
    expect(next?.events.map((e) => e.title)).toEqual(['Gym']);
  });

  it('lists every Event starting at that same time', () => {
    const state = aState({
      events: [ev('a', 'Gym', '18:00', '19:00'), ev('b', 'Dentist', '18:00', '18:30'), ev('c', 'Dinner', '19:30', '20:30')],
    });

    const next = dayView(state, TODAY, MON_10_15).next;

    expect(next?.events.map((e) => e.title)).toEqual(['Dentist', 'Gym']);
  });

  it('does not count an Event that is already live', () => {
    const state = aState({ events: [ev('a', 'Deep work', '10:00', '11:00')] });

    expect(dayView(state, TODAY, MON_10_15).next).toBeNull();
  });
});

describe('Later today', () => {
  it('lists the remaining Events (after Next) in start order, with time range and minutes until they start', () => {
    const state = aState({
      events: [
        ev('a', 'Gym', '18:00', '19:00'),
        ev('b', 'Lunch', '12:00', '12:45'),
        ev('c', 'Dinner', '19:30', '20:30'),
        ev('d', 'Run', '18:00', '18:20'),
      ],
    });

    const later = dayView(state, TODAY, MON_10_15).later;

    expect(later.count).toBe(3);
    expect(later.events.map((e) => ({ t: e.title, s: e.start, e: e.end, in: e.startsInMinutes }))).toEqual([
      { t: 'Run', s: '18:00', e: '18:20', in: 465 },
      { t: 'Gym', s: '18:00', e: '19:00', in: 465 },
      { t: 'Dinner', s: '19:30', e: '20:30', in: 555 },
    ]);
  });

  it('is empty when only the Next Event is left', () => {
    const state = aState({ events: [ev('a', 'Gym', '18:00', '19:00')] });

    expect(dayView(state, TODAY, MON_10_15).later).toEqual({ count: 0, events: [] });
  });
});

describe('Earlier today', () => {
  it('lists finished Events newest first, with their duration and how long ago they ended', () => {
    const state = aState({
      events: [ev('a', 'Standup', '08:00', '08:15'), ev('b', 'Deep work', '08:30', '09:30'), ev('c', 'Live', '10:00', '11:00')],
    });

    const earlier = dayView(state, TODAY, MON_10_15).earlier;

    expect(earlier.count).toBe(2);
    expect(earlier.events.map((e) => ({ t: e.title, d: e.durationMinutes, ago: e.endedMinutesAgo }))).toEqual([
      { t: 'Deep work', d: 60, ago: 45 },
      { t: 'Standup', d: 15, ago: 120 },
    ]);
  });

  it('counts an Event as finished from its end minute', () => {
    const state = aState({ events: [ev('a', 'Call', '09:00', '10:15')] });

    expect(dayView(state, TODAY, at('10:14')).earlier.count).toBe(0);
    expect(dayView(state, TODAY, at('10:15')).earlier.count).toBe(1);
  });
});

describe('the day changes as the clock does', () => {
  it('moves an Event from Next to Now to Earlier as time passes', () => {
    const state = aState({ events: [ev('a', 'Gym', '18:00', '19:00')] });
    const where = (hhmm: string) => {
      const v = dayView(state, TODAY, at(hhmm));
      return [v.next?.events.length ?? 0, v.now.cards.length, v.earlier.count];
    };

    expect(where('17:59')).toEqual([1, 0, 0]);
    expect(where('18:00')).toEqual([0, 1, 0]);
    expect(where('19:00')).toEqual([0, 0, 1]);
  });
});

describe('another day', () => {
  it('has no Now or Next, lists a coming day\'s Events under Later and a past day\'s under Earlier', () => {
    const state = aState({
      events: [ev('a', 'Gym', '18:00', '19:00', { date: '2026-11-17' }), ev('b', 'Old', '08:00', '09:00', { date: '2026-11-15' })],
    });

    const tomorrow = dayView(state, '2026-11-17', MON_10_15);
    expect(tomorrow.now.cards).toEqual([]);
    expect(tomorrow.next).toBeNull();
    expect(tomorrow.later.events.map((e) => [e.title, e.startsInMinutes])).toEqual([['Gym', null]]);

    const yesterday = dayView(state, '2026-11-15', MON_10_15);
    expect(yesterday.earlier.events.map((e) => [e.title, e.endedMinutesAgo])).toEqual([['Old', null]]);
  });
});

describe('the Event flow end to end', () => {
  it('adds, retimes and deletes an Event, and the day follows', () => {
    let state = aState();
    const run = (command: Parameters<typeof apply>[1], now = MON_10_15) => {
      state = applyChanges(state, apply(state, command, now));
      return dayView(state, TODAY, now);
    };

    let view = run({ type: 'addEvent', id: 'g', title: 'Gym', date: TODAY, start: '18:30', end: '19:15' });
    expect(view.next?.events.map((e) => e.title)).toEqual(['Gym']);

    view = run({ type: 'setEventTimes', id: 'g', start: '10:00', end: '11:00' });
    expect(view.now.cards.map((c) => c.title)).toEqual(['Gym']);
    expect(view.next).toBeNull();

    view = run({ type: 'renameEvent', id: 'g', title: 'Climbing' });
    expect(view.now.cards.map((c) => c.title)).toEqual(['Climbing']);

    view = run({ type: 'setEventTimes', id: 'g', start: '08:00', end: '09:00' });
    expect(view.earlier.events.map((e) => e.title)).toEqual(['Climbing']);

    view = run({ type: 'deleteEvent', id: 'g' });
    expect([view.now.cards.length, view.next, view.later.count, view.earlier.count]).toEqual([0, null, 0, 0]);
  });
});

describe('formatDuration', () => {
  it('writes minutes as 45m, 2h or 2h 20m', () => {
    expect(formatDuration(45)).toBe('45m');
    expect(formatDuration(120)).toBe('2h');
    expect(formatDuration(140)).toBe('2h 20m');
    expect(formatDuration(0)).toBe('0m');
  });
});
