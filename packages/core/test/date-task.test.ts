import { describe, expect, it } from 'vitest';
import { apply, applyChanges, canDateTask, dayView, type Command, type State } from '../src/index.ts';
import { MON_10_15, TODAY, aState, aTask, anEvent } from './helpers.ts';

const run = (state: State, command: Command, now = MON_10_15) => applyChanges(state, apply(state, command, now));
const NOTHING = { inserts: [], updates: [], deletes: [] };
const TUE = '2026-11-17';

describe('dating a Task to a day', () => {
  const base = () =>
    aState({
      events: [anEvent({ id: 'work', title: 'Deep work', start_time: '09:00', end_time: '11:00' })],
      tasks: [
        aTask({ id: 'a', title: 'Buy stamps', position: 1 }),
        aTask({ id: 'p', title: 'Call Ann', position: 2, event_id: 'work' }),
        aTask({ id: 's', title: 'Someday thing', position: 3, date: null }),
      ],
    });

  it('moves an unplaced Task from Anytime today to that day', () => {
    const after = run(base(), { type: 'dateTask', id: 'a', date: TUE });

    expect(dayView(after, TODAY, MON_10_15).anytime.items.map((t) => t.title)).toEqual([]);
    expect(dayView(after, TUE, MON_10_15).anytime.items.map((t) => t.title)).toEqual(['Buy stamps']);
  });

  it('clears its Placement: a placed Task lands unplaced on the new day', () => {
    const after = run(base(), { type: 'dateTask', id: 'p', date: TUE });

    expect(after.tasks.find((t) => t.id === 'p')).toMatchObject({ date: TUE, event_id: null });
    expect(dayView(after, TODAY, MON_10_15).now.cards[0]?.tasks).toEqual([]);
    expect(dayView(after, TUE, MON_10_15).anytime.items.map((t) => t.title)).toEqual(['Call Ann']);
  });

  it('on the day it is already on, only clears the Placement (a drop on Anytime)', () => {
    const changes = apply(base(), { type: 'dateTask', id: 'p', date: TODAY }, MON_10_15);

    expect(changes.updates).toEqual([{ table: 'tasks', id: 'p', set: { event_id: null, updated_at: MON_10_15 } }]);
  });

  it('changes only the day, the Placement and updated-at', () => {
    const changes = apply(base(), { type: 'dateTask', id: 'p', date: TUE }, MON_10_15);

    expect(changes.updates).toEqual([
      { table: 'tasks', id: 'p', set: { date: TUE, event_id: null, updated_at: MON_10_15 } },
    ]);
  });

  it('gives a Someday Task a day', () => {
    const after = run(base(), { type: 'dateTask', id: 's', date: TUE });

    expect(after.tasks.find((t) => t.id === 's')?.date).toBe(TUE);
  });

  it('keeps the Placements of the Sub-tasks of a Task that is dated', () => {
    const state = aState({
      events: [anEvent({ id: 'work' })],
      tasks: [aTask({ id: 'p', title: 'Project' }), aTask({ id: 'st', title: 'Step', parent_id: 'p', date: null, event_id: 'work' })],
    });

    const after = run(state, { type: 'dateTask', id: 'p', date: TUE });

    expect(after.tasks.find((t) => t.id === 'p')?.date).toBe(TUE);
    expect(after.tasks.find((t) => t.id === 'st')).toMatchObject({ event_id: 'work' });
  });

  it('does nothing when there is nothing to change, or the Task does not exist', () => {
    expect(apply(base(), { type: 'dateTask', id: 'a', date: TODAY }, MON_10_15)).toEqual(NOTHING);
    expect(apply(base(), { type: 'dateTask', id: 'nope', date: TUE }, MON_10_15)).toEqual(NOTHING);
  });

  it('refuses a Sub-task: it follows its parent and cannot be dated on its own', () => {
    const state = aState({
      tasks: [aTask({ id: 'p', title: 'Project' }), aTask({ id: 'st', title: 'Step', parent_id: 'p', date: null })],
    });

    expect(apply(state, { type: 'dateTask', id: 'st', date: TUE }, MON_10_15)).toEqual(NOTHING);
  });

  it('tells a drag whether a drop onto a day is allowed', () => {
    const state = base();

    expect(canDateTask(state, 'a', TUE)).toBe(true);
    expect(canDateTask(state, 'a', TODAY)).toBe(false); // already there, unplaced
    expect(canDateTask(state, 'p', TODAY)).toBe(true); // already there, but placed: the drop unplaces it
    expect(canDateTask(state, 'nope', TUE)).toBe(false);
  });
});
