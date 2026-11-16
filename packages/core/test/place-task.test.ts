import { describe, expect, it } from 'vitest';
import { apply, applyChanges, dayView, type Command, type State } from '../src/index.ts';
import { MON_10_15, TODAY, aState, aTask, anEvent } from './helpers.ts';

const run = (state: State, command: Command, now = MON_10_15) => applyChanges(state, apply(state, command, now));
const NOTHING = { inserts: [], updates: [], deletes: [] };

describe('placing an existing Task into an Event', () => {
  const base = () =>
    aState({
      events: [
        anEvent({ id: 'work', title: 'Deep work', start_time: '09:00', end_time: '11:00' }),
        anEvent({ id: 'gym', title: 'Gym', start_time: '18:00', end_time: '19:00' }),
        anEvent({ id: 'tomorrow', title: 'Planning', date: '2026-11-17', start_time: '09:00', end_time: '10:00' }),
        anEvent({ id: 'early', title: 'Standup', start_time: '08:00', end_time: '08:15' }),
      ],
      tasks: [aTask({ id: 'a', title: 'Buy stamps', position: 1 }), aTask({ id: 'b', title: 'Call Ann', position: 2 })],
    });

  it('moves it from Anytime today into the Event card', () => {
    const view = dayView(run(base(), { type: 'placeTask', id: 'a', eventId: 'work' }), TODAY, MON_10_15);

    expect(view.now.cards[0]?.tasks.map((t) => t.title)).toEqual(['Buy stamps']);
    expect(view.anytime.items.map((t) => t.title)).toEqual(['Call Ann']);
    expect(view.anytime.count).toBe(1);
  });

  it("gives the Task the Event's day, and it leaves the day it was on", () => {
    const after = run(base(), { type: 'placeTask', id: 'a', eventId: 'tomorrow' });

    expect(after.tasks.find((t) => t.id === 'a')).toMatchObject({ event_id: 'tomorrow', date: '2026-11-17' });
    expect(dayView(after, TODAY, MON_10_15).anytime.items.map((t) => t.title)).toEqual(['Call Ann']);
    expect(dayView(after, '2026-11-17', MON_10_15).later.events[0]?.tasks.map((t) => t.title)).toEqual(['Buy stamps']);
  });

  it('changes only the Placement, the day and updated-at', () => {
    const changes = apply(base(), { type: 'placeTask', id: 'a', eventId: 'tomorrow' }, MON_10_15);

    expect(changes.updates).toEqual([
      { table: 'tasks', id: 'a', set: { event_id: 'tomorrow', date: '2026-11-17', updated_at: MON_10_15 } },
    ]);
  });

  it('is in at most one Event: placing it elsewhere moves it', () => {
    let state = run(base(), { type: 'placeTask', id: 'a', eventId: 'work' });
    state = run(state, { type: 'placeTask', id: 'a', eventId: 'gym' });

    const view = dayView(state, TODAY, MON_10_15);
    expect(view.now.cards[0]?.tasks).toEqual([]);
    expect(view.next?.events[0]?.tasks.map((t) => t.title)).toEqual(['Buy stamps']);
  });

  it('lets one Event hold any number of Tasks', () => {
    let state = run(base(), { type: 'placeTask', id: 'a', eventId: 'work' });
    state = run(state, { type: 'placeTask', id: 'b', eventId: 'work' });
    state = run(state, { type: 'addTask', id: 'c', title: 'Write intro', date: TODAY, eventId: 'work' });

    expect(dayView(state, TODAY, MON_10_15).now.cards[0]?.tasks.map((t) => t.title)).toEqual([
      'Buy stamps',
      'Call Ann',
      'Write intro',
    ]);
  });

  it('is allowed into a past Event', () => {
    const view = dayView(run(base(), { type: 'placeTask', id: 'a', eventId: 'early' }), TODAY, MON_10_15);

    expect(view.earlier.events[0]?.tasks.map((t) => t.title)).toEqual(['Buy stamps']);
  });

  it('does nothing for a Task or Event that does not exist, or when it is already there', () => {
    const state = run(base(), { type: 'placeTask', id: 'a', eventId: 'work' });

    for (const [id, eventId] of [['nope', 'work'], ['a', 'nope'], ['a', 'work']] as const) {
      expect(apply(state, { type: 'placeTask', id, eventId }, MON_10_15)).toEqual(NOTHING);
    }
  });

  it('refuses a Task that has Sub-tasks: only its Sub-tasks are placed', () => {
    const state = aState({
      events: [anEvent({ id: 'work' })],
      tasks: [aTask({ id: 'p', title: 'Project' }), aTask({ id: 's', title: 'Step', parent_id: 'p', date: null })],
    });

    expect(apply(state, { type: 'placeTask', id: 'p', eventId: 'work' }, MON_10_15)).toEqual(NOTHING);
  });

  it("places a Sub-task without dating it: its day becomes the Event's", () => {
    const state = aState({
      events: [anEvent({ id: 'tomorrow', date: '2026-11-17' })],
      tasks: [aTask({ id: 'p', title: 'Project', date: null }), aTask({ id: 's', title: 'Step', parent_id: 'p', date: null })],
    });

    const after = run(state, { type: 'placeTask', id: 's', eventId: 'tomorrow' });

    expect(after.tasks.find((t) => t.id === 's')).toMatchObject({ event_id: 'tomorrow', date: null });
    expect(dayView(after, '2026-11-17', MON_10_15).later.events[0]?.tasks.map((t) => [t.title, t.parentTitle])).toEqual([
      ['Step', 'Project'],
    ]);
  });
});

describe('taking a Task out of its Event', () => {
  it('unplaces it onto the same day, so it is back in Anytime today', () => {
    let state = aState({
      events: [anEvent({ id: 'work', title: 'Deep work', start_time: '09:00', end_time: '11:00' })],
      tasks: [aTask({ id: 'a', title: 'Buy stamps' })],
    });
    state = run(state, { type: 'placeTask', id: 'a', eventId: 'work' });

    const after = run(state, { type: 'unplaceTask', id: 'a' });

    const view = dayView(after, TODAY, MON_10_15);
    expect(view.anytime.items.map((t) => t.title)).toEqual(['Buy stamps']);
    expect(view.now.cards[0]?.tasks).toEqual([]);
    expect(after.tasks[0]).toMatchObject({ event_id: null, date: TODAY });
  });

  it('changes only the Placement and updated-at, and ignores a Task that is not placed', () => {
    const state = aState({ events: [anEvent({ id: 'e' })], tasks: [aTask({ id: 'a', event_id: 'e' }), aTask({ id: 'b' })] });

    expect(apply(state, { type: 'unplaceTask', id: 'a' }, MON_10_15).updates).toEqual([
      { table: 'tasks', id: 'a', set: { event_id: null, updated_at: MON_10_15 } },
    ]);
    expect(apply(state, { type: 'unplaceTask', id: 'b' }, MON_10_15)).toEqual(NOTHING);
  });
});
