import { describe, expect, it } from 'vitest';
import { apply, applyChanges, canMoveEvent, dayView, type Command, type State } from '../src/index.ts';
import { MON_10_15, TODAY, aState, aTask, anEvent } from './helpers.ts';

const run = (state: State, command: Command, now = MON_10_15) => applyChanges(state, apply(state, command, now));
const NOTHING = { inserts: [], updates: [], deletes: [] };
const TUE = '2026-11-17';

describe('moving an Event to another day', () => {
  const base = () =>
    aState({
      events: [
        anEvent({ id: 'work', title: 'Deep work', start_time: '09:00', end_time: '11:00' }),
        anEvent({ id: 'gym', title: 'Gym', start_time: '18:00', end_time: '19:00' }),
      ],
      tasks: [
        aTask({ id: 'a', title: 'Write intro', event_id: 'work', position: 1 }),
        aTask({ id: 'b', title: 'Outline talk', event_id: 'work', position: 2, completed_at: '2026-11-16T09:40:00+01:00' }),
        aTask({ id: 'c', title: 'Buy stamps', position: 3 }),
        aTask({ id: 'd', title: 'Pack bag', event_id: 'gym', position: 4 }),
      ],
    });

  it('moves the Event, keeping its times', () => {
    const after = run(base(), { type: 'moveEvent', id: 'work', date: TUE });

    expect(after.events.find((e) => e.id === 'work')).toMatchObject({ date: TUE, start_time: '09:00', end_time: '11:00' });
    expect(dayView(after, TODAY, MON_10_15).now.cards).toEqual([]);
    expect(dayView(after, TUE, MON_10_15).later.events.map((e) => e.title)).toEqual(['Deep work']);
  });

  it('brings its placed Tasks along, still placed (done ones too)', () => {
    const after = run(base(), { type: 'moveEvent', id: 'work', date: TUE });

    expect(after.tasks.filter((t) => t.event_id === 'work')).toHaveLength(2);
    expect(after.tasks.filter((t) => t.event_id === 'work').map((t) => t.date)).toEqual([TUE, TUE]);
    expect(dayView(after, TUE, MON_10_15).later.events[0]?.tasks.map((t) => t.title)).toEqual(['Write intro', 'Outline talk']);
  });

  it('leaves the unplaced Tasks and the other Events alone', () => {
    const after = run(base(), { type: 'moveEvent', id: 'work', date: TUE });

    expect(after.tasks.find((t) => t.id === 'c')).toEqual(base().tasks.find((t) => t.id === 'c'));
    expect(after.tasks.find((t) => t.id === 'd')).toEqual(base().tasks.find((t) => t.id === 'd'));
    expect(after.events.find((e) => e.id === 'gym')?.date).toBe(TODAY);
  });

  it('changes only the day and updated-at of the Event and the days of its Tasks', () => {
    const changes = apply(base(), { type: 'moveEvent', id: 'work', date: TUE }, MON_10_15);

    expect(changes.inserts).toEqual([]);
    expect(changes.deletes).toEqual([]);
    expect(changes.updates).toEqual([
      { table: 'events', id: 'work', set: { date: TUE, updated_at: MON_10_15 } },
      { table: 'tasks', id: 'a', set: { date: TUE, updated_at: MON_10_15 } },
      { table: 'tasks', id: 'b', set: { date: TUE, updated_at: MON_10_15 } },
    ]);
  });

  it('keeps a placed Sub-task without a day of its own, still placed', () => {
    const state = aState({
      events: [anEvent({ id: 'work' })],
      tasks: [aTask({ id: 'p', title: 'Project', date: null }), aTask({ id: 'st', title: 'Step', parent_id: 'p', date: null, event_id: 'work' })],
    });

    const after = run(state, { type: 'moveEvent', id: 'work', date: TUE });

    expect(after.tasks.find((t) => t.id === 'st')).toMatchObject({ date: null, event_id: 'work' });
    expect(dayView(after, TUE, MON_10_15).later.events[0]?.tasks.map((t) => t.title)).toEqual(['Step']);
  });

  it('does nothing for an Event that does not exist, is deleted, or is already on that day', () => {
    const state = aState({ events: [anEvent({ id: 'gone', deleted_at: MON_10_15 }), anEvent({ id: 'here' })] });

    for (const id of ['nope', 'gone']) expect(apply(state, { type: 'moveEvent', id, date: TUE }, MON_10_15)).toEqual(NOTHING);
    expect(apply(state, { type: 'moveEvent', id: 'here', date: TODAY }, MON_10_15)).toEqual(NOTHING);
  });

  it('tells a drag whether a drop onto a day is allowed', () => {
    const state = base();

    expect(canMoveEvent(state, 'work', TUE)).toBe(true);
    expect(canMoveEvent(state, 'work', TODAY)).toBe(false);
    expect(canMoveEvent(state, 'nope', TUE)).toBe(false);
  });
});
