import { describe, expect, it } from 'vitest';
import { apply, applyChanges, dayView, occurrenceId, type Command, type RecurrenceRule, type State } from '../src/index.ts';
import { MON_10_15, TODAY, aState, aTask, anEvent } from './helpers.ts';

const run = (state: State, command: Command) => applyChanges(state, apply(state, command, MON_10_15));
const repeat = (state: State, id: string, recurrence: RecurrenceRule) => run(state, { type: 'setRecurrence', id, seriesId: 's1', recurrence });
const NOTHING = { inserts: [], updates: [], deletes: [] };

// 2026-11-16 is a Monday
describe('"Repeat…" on a Task', () => {
  it('stores the rule as a series and makes the Task its first Occurrence on its own day', () => {
    const after = repeat(aState({ tasks: [aTask({ id: 't', title: 'Water plants' })] }), 't', { rule: 'every_n_days', interval: 3 });

    expect(after.series).toEqual([
      expect.objectContaining({
        id: 's1',
        lineage_id: 's1',
        kind: 'task',
        rule: 'every_n_days',
        interval_n: 3,
        anchor_date: TODAY,
        starts_on: TODAY,
        ends_on: null,
      }),
    ]);
    expect(JSON.parse(after.series[0]!.template)).toEqual({ title: 'Water plants', subtasks: [] });
    expect(after.tasks[0]).toMatchObject({ id: 't', date: TODAY, series_id: 's1', occurrence_date: TODAY });
  });

  it('does not make a second Occurrence on the day the Task already covers', () => {
    const after = repeat(aState({ tasks: [aTask({ id: 't' })] }), 't', { rule: 'every_n_days', interval: 1 });

    const more = run(after, { type: 'materialise', dates: [TODAY, '2026-11-17'] });

    expect(more.tasks.map((t) => [t.id, t.date])).toEqual([
      ['t', TODAY],
      [occurrenceId('s1', '2026-11-17'), '2026-11-17'],
    ]);
  });

  it('keeps the rhythm of the later days independent of the Task: it repeats on chosen weekdays', () => {
    const after = repeat(aState({ tasks: [aTask({ id: 't' })] }), 't', { rule: 'weekdays', weekdays: [1, 3] });
    const more = run(after, { type: 'materialise', dates: ['2026-11-17', '2026-11-18', '2026-11-23'] });

    expect(more.tasks.map((t) => t.date).sort()).toEqual([TODAY, '2026-11-18', '2026-11-23']);
    expect(after.series[0]).toMatchObject({ rule: 'weekdays', weekdays: '[1,3]', interval_n: 1 });
  });

  it('supports every N weeks on chosen weekdays', () => {
    const after = repeat(aState({ tasks: [aTask({ id: 't' })] }), 't', { rule: 'weekdays', weekdays: [1], everyWeeks: 2 });
    const more = run(after, { type: 'materialise', dates: ['2026-11-23', '2026-11-30'] });

    expect(more.tasks.map((t) => t.date).sort()).toEqual([TODAY, '2026-11-30']);
  });

  it('moves a Task on a day the rule skips to the first matching day, unplaced', () => {
    const state = aState({
      events: [anEvent({ id: 'work' })],
      tasks: [aTask({ id: 't', event_id: 'work' })],
    });
    const after = repeat(state, 't', { rule: 'weekdays', weekdays: [5] });

    expect(after.tasks[0]).toMatchObject({ date: '2026-11-20', event_id: null, series_id: 's1', occurrence_date: '2026-11-20' });
    expect(after.series[0]).toMatchObject({ starts_on: '2026-11-20' });
  });

  it('works with a day of the month, falling back in short months', () => {
    const after = repeat(aState({ tasks: [aTask({ id: 't' })] }), 't', { rule: 'day_of_month', day: 31 });

    expect(after.tasks[0]).toMatchObject({ date: '2026-11-30', occurrence_date: '2026-11-30' });
    expect(after.series[0]).toMatchObject({ rule: 'day_of_month', day_of_month: 31 });
  });

  it('puts the first Occurrence of a Someday Task on the first matching day from today, so it leaves Someday', () => {
    const state = aState({ tasks: [aTask({ id: 't', title: 'Clean oven', date: null })] });
    const after = repeat(state, 't', { rule: 'weekdays', weekdays: [3] });

    expect(after.tasks[0]).toMatchObject({ date: '2026-11-18', series_id: 's1', occurrence_date: '2026-11-18' });
    const view = dayView(after, TODAY, MON_10_15);
    expect(view.someday.items).toEqual([]);
    expect(dayView(after, '2026-11-18', MON_10_15).anytime.items.map((i) => i.title)).toEqual(['Clean oven']);
  });

  it('puts a Someday Task on today when today matches', () => {
    const after = repeat(aState({ tasks: [aTask({ id: 't', date: null })] }), 't', { rule: 'every_n_days', interval: 2 });

    expect(after.tasks[0]).toMatchObject({ date: TODAY });
    expect(after.series[0]).toMatchObject({ anchor_date: TODAY, starts_on: TODAY });
  });

  it('a Task with Sub-tasks: the series keeps their titles with keys, and each new Occurrence brings them unticked', () => {
    const state = aState({
      tasks: [
        aTask({ id: 't', title: 'Clean flat' }),
        aTask({ id: 'a', parent_id: 't', title: 'Hoover', date: null, completed_at: MON_10_15 }),
        aTask({ id: 'b', parent_id: 't', title: 'Bins', date: null }),
      ],
    });
    const after = repeat(state, 't', { rule: 'every_n_days', interval: 1 });

    expect(JSON.parse(after.series[0]!.template).subtasks).toEqual([
      { key: 'a', title: 'Hoover' },
      { key: 'b', title: 'Bins' },
    ]);
    expect(after.tasks.filter((t) => t.parent_id === 't').map((t) => t.series_subtask_key)).toEqual(['a', 'b']);

    const next = run(after, { type: 'materialise', dates: ['2026-11-17'] });
    const subs = next.tasks.filter((t) => t.parent_id === occurrenceId('s1', '2026-11-17'));
    expect(subs.map((s) => [s.title, s.completed_at])).toEqual([['Hoover', null], ['Bins', null]]);
  });

  it('refuses a Sub-task, a done Task, a Task that already repeats, a missing item and a bad rule', () => {
    const state = aState({
      tasks: [
        aTask({ id: 't' }),
        aTask({ id: 'sub', parent_id: 't', date: null }),
        aTask({ id: 'done', completed_at: MON_10_15 }),
        aTask({ id: 'rec', series_id: 'x', occurrence_date: TODAY }),
      ],
    });
    const every3: RecurrenceRule = { rule: 'every_n_days', interval: 3 };

    for (const id of ['sub', 'done', 'rec', 'nope']) {
      expect(apply(state, { type: 'setRecurrence', id, seriesId: 's1', recurrence: every3 }, MON_10_15), id).toEqual(NOTHING);
    }
    const bad: RecurrenceRule[] = [
      { rule: 'every_n_days', interval: 0 },
      { rule: 'every_n_days', interval: 1.5 },
      { rule: 'weekdays', weekdays: [] },
      { rule: 'weekdays', weekdays: [8] },
      { rule: 'weekdays', weekdays: [1], everyWeeks: 0 },
      { rule: 'day_of_month', day: 0 },
      { rule: 'day_of_month', day: 32 },
    ];
    for (const recurrence of bad) {
      expect(apply(state, { type: 'setRecurrence', id: 't', seriesId: 's1', recurrence }, MON_10_15), JSON.stringify(recurrence)).toEqual(NOTHING);
    }
  });
});

describe('"Repeat…" on an Event', () => {
  it('makes the Event the first Occurrence, with its times in the series', () => {
    const state = aState({ events: [anEvent({ id: 'e', title: 'Gym', start_time: '18:00', end_time: '19:00' })] });
    const after = repeat(state, 'e', { rule: 'weekdays', weekdays: [1, 4] });

    expect(after.series[0]).toMatchObject({ kind: 'event', rule: 'weekdays', starts_on: TODAY });
    expect(JSON.parse(after.series[0]!.template)).toEqual({ title: 'Gym', start: '18:00', end: '19:00' });
    expect(after.events[0]).toMatchObject({ id: 'e', series_id: 's1', occurrence_date: TODAY });
  });

  it('later Occurrences start with nothing placed, whatever was placed in the first', () => {
    const state = aState({
      events: [anEvent({ id: 'e', title: 'Gym' })],
      tasks: [aTask({ id: 'bag', event_id: 'e' })],
    });
    const after = run(repeat(state, 'e', { rule: 'every_n_days', interval: 1 }), { type: 'materialise', dates: ['2026-11-17'] });

    const next = after.events.find((e) => e.id === occurrenceId('s1', '2026-11-17'))!;
    expect(next).toBeDefined();
    expect(after.tasks.filter((t) => t.event_id === next.id)).toEqual([]);
    expect(after.tasks.find((t) => t.id === 'bag')?.event_id).toBe('e');
  });

  it('moves an Event on a day the rule skips to the first matching day, taking its placed Tasks along', () => {
    const state = aState({
      events: [anEvent({ id: 'e', title: 'Gym' })],
      tasks: [aTask({ id: 'bag', event_id: 'e' })],
    });
    const after = repeat(state, 'e', { rule: 'weekdays', weekdays: [5] });

    expect(after.events[0]).toMatchObject({ date: '2026-11-20', occurrence_date: '2026-11-20' });
    expect(after.tasks[0]).toMatchObject({ date: '2026-11-20', event_id: 'e' });
  });
});

describe('how a recurring item looks', () => {
  const tag = (rule: RecurrenceRule) => {
    const after = repeat(aState({ tasks: [aTask({ id: 't' })] }), 't', rule);
    return dayView(after, after.tasks[0]!.date!, MON_10_15).anytime.items[0]!.recurrence;
  };

  it('is tagged with a short name of the rule', () => {
    expect(tag({ rule: 'every_n_days', interval: 1 })).toBe('daily');
    expect(tag({ rule: 'every_n_days', interval: 3 })).toBe('every 3 days');
    expect(tag({ rule: 'weekdays', weekdays: [1, 2, 3, 4, 5] })).toBe('weekdays');
    expect(tag({ rule: 'weekdays', weekdays: [1, 2, 3, 4, 5, 6, 7] })).toBe('daily');
    expect(tag({ rule: 'weekdays', weekdays: [3, 1] })).toBe('Mon/Wed');
    expect(tag({ rule: 'weekdays', weekdays: [5] })).toBe('Fri');
    expect(tag({ rule: 'weekdays', weekdays: [1], everyWeeks: 2 })).toBe('every 2 weeks · Mon');
    expect(tag({ rule: 'day_of_month', day: 31 })).toBe('monthly on the 31st');
    expect(tag({ rule: 'day_of_month', day: 2 })).toBe('monthly on the 2nd');
  });

  it('shows Occurrences in Today and in a later day like any item, not as ghosts', () => {
    const after = run(repeat(aState({ tasks: [aTask({ id: 't', title: 'Water plants' })] }), 't', { rule: 'every_n_days', interval: 1 }), {
      type: 'materialise',
      dates: ['2026-11-17'],
    });

    const today = dayView(after, TODAY, MON_10_15);
    expect(today.anytime.items[0]).toMatchObject({ title: 'Water plants', recurring: true, recurrence: 'daily' });
    const tomorrow = dayView(after, '2026-11-17', MON_10_15);
    expect(tomorrow.anytime.items[0]).toMatchObject({ title: 'Water plants', recurring: true, recurrence: 'daily' });
    expect(today.strip.find((d) => d.date === '2026-11-17')?.tasks).toBe(1);
  });

  it('tags a recurring Event on its card', () => {
    const state = aState({ events: [anEvent({ id: 'e', title: 'Gym', start_time: '18:00', end_time: '19:00' })] });
    const after = repeat(state, 'e', { rule: 'weekdays', weekdays: [1, 4] });

    expect(dayView(after, TODAY, MON_10_15).next?.events[0]?.recurrence).toBe('Mon/Thu');
  });
});
