import { describe, expect, it } from 'vitest';
import { apply, applyChanges, dayView, type State } from '../src/index.ts';
import { aState, aTask, anEvent } from './helpers.ts';

const TUE_00_00 = '2026-11-17T00:00:00+01:00';
const MON = '2026-11-16';
const TUE = '2026-11-17';
const NOTHING = { inserts: [], updates: [], deletes: [] };

const midnight = (state: State, now = TUE_00_00) => applyChanges(state, apply(state, { type: 'runMidnight' }, now));
const task = (state: State, id: string) => state.tasks.find((t) => t.id === id)!;

describe('Carry-over after several missed days', () => {
  it('moves unfinished items from every one of the days straight to today', () => {
    const state = aState({
      events: [anEvent({ id: 'old', title: 'Planning', date: '2026-11-14', start_time: '09:00', end_time: '10:00' })],
      tasks: [
        aTask({ id: 'sat', title: 'From Saturday', date: '2026-11-14', event_id: 'old', position: 1 }),
        aTask({ id: 'sun', title: 'From Sunday', date: '2026-11-15', position: 2 }),
        aTask({ id: 'mon', title: 'From Monday', date: MON, position: 3 }),
      ],
    });

    const after = midnight(state, '2026-11-17T08:30:00+01:00');

    expect(after.tasks.map((t) => [t.id, t.date, t.event_id, t.carried_over])).toEqual([
      ['sat', TUE, null, true],
      ['sun', TUE, null, true],
      ['mon', TUE, null, true],
    ]);
  });

  it('carries an item again the next midnight, and it stays marked as carried over', () => {
    const once = midnight(aState({ tasks: [aTask({ id: 'a', date: MON })] }));

    const twice = midnight(once, '2026-11-18T00:00:00+01:00');

    expect(task(twice, 'a')).toMatchObject({ date: '2026-11-18', carried_over: true });
  });

  it('does not touch an item on today or a later day', () => {
    const state = aState({ tasks: [aTask({ id: 'today', date: TUE }), aTask({ id: 'later', date: '2026-11-20' })] });

    expect(apply(state, { type: 'runMidnight' }, TUE_00_00)).toEqual(NOTHING);
  });
});

describe('Carry-over leaves these alone', () => {
  it('Someday Tasks, finished, Skipped and deleted items, and items placed in a later Event', () => {
    const state = aState({
      events: [anEvent({ id: 'e', date: MON }), anEvent({ id: 'later', date: '2026-11-20', title: 'Later' })],
      tasks: [
        aTask({ id: 'someday', title: 'Idea', date: null }),
        aTask({ id: 'finished', date: MON, completed_at: '2026-11-16T09:30:00+01:00', event_id: 'e' }),
        aTask({ id: 'skipped', date: MON, skipped_at: '2026-11-16T00:00:00+01:00' }),
        aTask({ id: 'deleted', date: MON, deleted_at: '2026-11-16T12:00:00+01:00' }),
        aTask({ id: 'future-event', date: '2026-11-20', event_id: 'later' }),
      ],
    });

    expect(apply(state, { type: 'runMidnight' }, TUE_00_00)).toEqual(NOTHING);
  });

  it('Events: they are never written, even a past Event with open items', () => {
    const state = aState({
      events: [anEvent({ id: 'e', date: '2026-11-10' })],
      tasks: [aTask({ id: 'a', date: '2026-11-10', event_id: 'e' })],
    });

    const changes = apply(state, { type: 'runMidnight' }, TUE_00_00);

    expect(changes.updates.length).toBe(1);
    expect(changes.updates.every((u) => u.table === 'tasks')).toBe(true);
    expect(changes.inserts).toEqual([]);
    expect(changes.deletes).toEqual([]);
    expect(midnight(state).events).toEqual(state.events);
  });

  it('a finished item stays in the day it was finished', () => {
    const state = aState({ tasks: [aTask({ id: 'finished', date: MON, completed_at: '2026-11-16T09:30:00+01:00' })] });

    const view = dayView(midnight(state), MON, TUE_00_00);

    expect(view.done.items.map((i) => i.id)).toEqual(['finished']);
  });
});

describe('Carry-over of Sub-tasks', () => {
  const parentOn = (date: string | null) => aTask({ id: 'p', title: 'Report', date, position: 1 });
  const sub = (id: string, over = {}) => aTask({ id, parent_id: 'p', title: id, date: null, position: 2, ...over });

  it('an unplaced Sub-task follows its parent to today and is marked as carried over', () => {
    const after = midnight(aState({ tasks: [parentOn(MON), sub('s1')] }));

    expect(task(after, 'p')).toMatchObject({ date: TUE });
    expect(task(after, 's1')).toMatchObject({ date: null, event_id: null, carried_over: true });
    expect(dayView(after, TUE, TUE_00_00).anytime.items.map((i) => [i.title, i.parentTitle, i.carriedOver])).toEqual([['s1', 'Report', true]]);
  });

  it("a placed Sub-task loses its Placement and follows its parent's day", () => {
    const state = aState({ events: [anEvent({ id: 'e', date: MON })], tasks: [parentOn(MON), sub('s1', { event_id: 'e' })] });

    const after = midnight(state);

    expect(task(after, 's1')).toMatchObject({ event_id: null, carried_over: true });
    expect(dayView(after, TUE, TUE_00_00).anytime.items.map((i) => i.title)).toEqual(['s1']);
  });

  it('an unplaced Sub-task whose parent is in Someday stays in Someday', () => {
    const state = aState({ tasks: [parentOn(null), sub('s1')] });

    expect(apply(state, { type: 'runMidnight' }, TUE_00_00)).toEqual(NOTHING);
    expect(dayView(state, TUE, TUE_00_00).someday.items.map((i) => i.title)).toEqual(['Report']);
  });

  it('a placed Sub-task of a Someday parent loses its Placement and follows the parent back to Someday', () => {
    const state = aState({ events: [anEvent({ id: 'e', date: MON })], tasks: [parentOn(null), sub('s1', { event_id: 'e' })] });

    const after = midnight(state);

    expect(task(after, 's1')).toMatchObject({ event_id: null, carried_over: true });
    expect(task(after, 'p').date).toBeNull();
    expect(dayView(after, TUE, TUE_00_00).anytime.items).toEqual([]);
  });

  it('a Sub-task placed in a later Event stays there, while an unplaced sibling moves to today', () => {
    const state = aState({
      events: [anEvent({ id: 'later', date: '2026-11-20' })],
      tasks: [parentOn(MON), sub('s1', { event_id: 'later' }), sub('s2')],
    });

    const after = midnight(state);

    expect(task(after, 's1')).toMatchObject({ event_id: 'later', carried_over: false });
    expect(task(after, 's2')).toMatchObject({ carried_over: true });
  });

  it('done Sub-tasks do not move and stay on the day they were done', () => {
    const state = aState({ tasks: [parentOn(MON), sub('done', { completed_at: '2026-11-16T09:30:00+01:00' }), sub('open')] });

    const after = midnight(state);

    expect(task(after, 'done')).toEqual(task(state, 'done'));
    expect(dayView(after, MON, TUE_00_00).done.items.map((i) => i.title)).toEqual(['done']);
    expect(dayView(after, TUE, TUE_00_00).done.items).toEqual([]);
  });

  it('a parent whose Sub-tasks are all done does not move', () => {
    const state = aState({ tasks: [parentOn(MON), sub('a', { completed_at: '2026-11-16T09:30:00+01:00' })] });

    expect(apply(state, { type: 'runMidnight' }, TUE_00_00)).toEqual(NOTHING);
  });
});

describe('the midnight job is deterministic', () => {
  const state = () =>
    aState({
      events: [anEvent({ id: 'e', date: MON })],
      tasks: [aTask({ id: 'b', date: MON }), aTask({ id: 'a', date: MON, event_id: 'e' }), aTask({ id: 'c', parent_id: 'b', date: null })],
    });

  it('two devices running it at different times of day, on rows in any order, write identical values', () => {
    const early = apply(state(), { type: 'runMidnight' }, '2026-11-17T00:00:00+01:00');
    const reversed = { ...state(), tasks: [...state().tasks].reverse() };
    const late = apply(reversed, { type: 'runMidnight' }, '2026-11-17T19:42:17+01:00');

    expect(late).toEqual(early);
  });

  it("stamps rows with the day's midnight, not the time it happened to run", () => {
    const after = midnight(state(), '2026-11-17T19:42:17+01:00');

    expect(task(after, 'a').updated_at).toBe('2026-11-17T00:00:00+01:00');
  });

  it('changes nothing on a device that already has the other one\'s result', () => {
    const once = midnight(state());

    expect(apply(once, { type: 'runMidnight' }, '2026-11-17T09:00:00+01:00')).toEqual(NOTHING);
  });
});
