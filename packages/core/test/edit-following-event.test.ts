import { describe, expect, it } from 'vitest';
import { apply, applyChanges, dayView, type State } from '../src/index.ts';
import { MON_10_15, aTask } from './helpers.ts';
import { DAYS, NOTHING, dailyEvent, idOn, lineageOf, run } from './series-fixtures.ts';

const gym = (date: string) => idOn('gym', date);
const times = (state: State) =>
  Object.fromEntries(state.events.filter((e) => !e.deleted_at).map((e) => [e.occurrence_date, `${e.title} ${e.start_time}-${e.end_time}`]));

describe('Rename an Event Occurrence', () => {
  it('"Just this one" changes only that Event', () => {
    const after = run(dailyEvent(), { type: 'renameEvent', id: gym('2026-11-18'), title: 'Swim', scope: 'one' });

    expect(times(after)['2026-11-18']).toBe('Swim 18:00-19:00');
    expect(times(after)['2026-11-19']).toBe('Gym 18:00-19:00');
    expect(after.series).toHaveLength(1);
    expect(after.events.find((e) => e.id === gym('2026-11-18'))).toMatchObject({ series_id: 'gym', occurrence_date: '2026-11-18' });
  });

  it('"This and following" renames it and every later one, but keeps a hand-moved time on a later one', () => {
    let state = run(dailyEvent(), { type: 'setEventTimes', id: gym('2026-11-19'), start: '07:00', end: '08:00', scope: 'one' });

    state = run(state, { type: 'renameEvent', id: gym('2026-11-17'), title: 'Swim', scope: 'following' });

    expect(times(state)).toEqual({
      '2026-11-16': 'Gym 18:00-19:00',
      '2026-11-17': 'Swim 18:00-19:00',
      '2026-11-18': 'Swim 18:00-19:00',
      '2026-11-19': 'Swim 07:00-08:00',
      '2026-11-20': 'Swim 18:00-19:00',
    });
  });

  it('makes later Events with the new name and the old times, and splits the lineage there', () => {
    const after = run(dailyEvent(), { type: 'renameEvent', id: gym('2026-11-18'), title: 'Swim', scope: 'following' });

    const [old, split] = lineageOf(after, 'gym');
    expect(old).toMatchObject({ ends_on: '2026-11-17' });
    expect(split).toMatchObject({ kind: 'event', starts_on: '2026-11-18', ends_on: null });
    expect(JSON.parse(split!.template)).toEqual({ title: 'Swim', start: '18:00', end: '19:00' });
    expect(times(run(after, { type: 'materialise', dates: [...DAYS, '2026-11-21'] }))['2026-11-21']).toBe('Swim 18:00-19:00');
    expect(run(after, { type: 'materialise', dates: DAYS }).events).toHaveLength(5);
  });

  it('leaves earlier days alone, and the items placed in later Events stay placed', () => {
    const state = applyChanges(dailyEvent(), {
      inserts: [{ table: 'tasks', row: aTask({ id: 'bag', date: '2026-11-19', event_id: gym('2026-11-19') }) }],
      updates: [],
      deletes: [],
    });

    const after = run(state, { type: 'renameEvent', id: gym('2026-11-18'), title: 'Swim', scope: 'following' });

    expect(times(after)['2026-11-17']).toBe('Gym 18:00-19:00');
    expect(after.tasks.find((t) => t.id === 'bag')).toMatchObject({ event_id: gym('2026-11-19'), date: '2026-11-19' });
    expect(dayView(after, '2026-11-19', MON_10_15).later.events[0]).toMatchObject({ title: 'Swim', recurrence: 'daily', placedTotal: 1 });
  });
});

describe('Change the times of an Event Occurrence', () => {
  it('"This and following" overwrites only the time that was edited on later Events', () => {
    let state = run(dailyEvent(), { type: 'setEventTimes', id: gym('2026-11-19'), start: '18:00', end: '19:30', scope: 'one' });
    state = run(state, { type: 'setEventTimes', id: gym('2026-11-18'), start: '17:00', end: '19:00', scope: 'following' });

    expect(times(state)).toEqual({
      '2026-11-16': 'Gym 18:00-19:00',
      '2026-11-17': 'Gym 18:00-19:00',
      '2026-11-18': 'Gym 17:00-19:00',
      '2026-11-19': 'Gym 17:00-19:30',
      '2026-11-20': 'Gym 17:00-19:00',
    });
    const split = lineageOf(state, 'gym').at(-1)!;
    expect(JSON.parse(split.template)).toEqual({ title: 'Gym', start: '17:00', end: '19:00' });
  });

  it('"Just this one" changes only that Event', () => {
    const after = run(dailyEvent(), { type: 'setEventTimes', id: gym('2026-11-18'), start: '17:00', end: '19:00', scope: 'one' });

    expect(times(after)['2026-11-18']).toBe('Gym 17:00-19:00');
    expect(times(after)['2026-11-19']).toBe('Gym 18:00-19:00');
    expect(after.series).toHaveLength(1);
  });

  it('refuses bad times and changes nothing when the times are the same', () => {
    const state = dailyEvent();

    expect(apply(state, { type: 'setEventTimes', id: gym('2026-11-18'), start: '19:00', end: '18:00', scope: 'following' }, MON_10_15)).toEqual(NOTHING);
    expect(apply(state, { type: 'setEventTimes', id: gym('2026-11-18'), start: '18:00', end: '19:00', scope: 'following' }, MON_10_15)).toEqual(NOTHING);
  });
});
