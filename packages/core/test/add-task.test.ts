import { describe, expect, it } from 'vitest';
import { apply, applyChanges, dayView } from '../src/index.ts';
import { MON_10_15, TODAY, aState, aTask, anEvent } from './helpers.ts';

describe('adding a Task from the "+ …" field under Anytime today', () => {
  it('shows an unplaced Task dated today in Anytime today, with the count updated', () => {
    const state = aState();

    const changes = apply(
      state,
      { type: 'addTask', id: 't1', title: 'Buy stamps', date: TODAY },
      MON_10_15,
    );
    const after = applyChanges(state, changes);

    const view = dayView(after, TODAY, MON_10_15);
    expect(view.anytime.count).toBe(1);
    expect(view.anytime.items.map((i) => i.title)).toEqual(['Buy stamps']);
    expect(view.anytime.items[0]).toMatchObject({ id: 't1', carriedOver: false, recurring: false });
  });

  it('returns the new Task as a single inserted row, Unplaced, with timestamps from "now"', () => {
    const changes = apply(
      aState(),
      { type: 'addTask', id: 't1', title: 'Buy stamps', date: TODAY },
      MON_10_15,
    );

    expect(changes.updates).toEqual([]);
    expect(changes.deletes).toEqual([]);
    expect(changes.inserts).toHaveLength(1);
    expect(changes.inserts[0]).toMatchObject({
      table: 'tasks',
      row: {
        id: 't1',
        title: 'Buy stamps',
        date: TODAY,
        event_id: null,
        parent_id: null,
        completed_at: null,
        created_at: MON_10_15,
        updated_at: MON_10_15,
      },
    });
  });

  it('trims the title and ignores an empty one', () => {
    const state = aState();
    const empty = apply(state, { type: 'addTask', id: 't1', title: '   ', date: TODAY }, MON_10_15);
    expect(empty.inserts).toEqual([]);

    const padded = apply(state, { type: 'addTask', id: 't2', title: '  Call Ann ', date: TODAY }, MON_10_15);
    expect(padded.inserts[0]).toMatchObject({ row: { title: 'Call Ann' } });
  });
});

describe('Anytime today', () => {
  it('holds only open, Unplaced Tasks of that day', () => {
    const state = aState({
      events: [anEvent({ id: 'e1' })],
      tasks: [
        aTask({ id: 'open', title: 'Open' }),
        aTask({ id: 'placed', title: 'Placed', event_id: 'e1' }),
        aTask({ id: 'done', title: 'Done', completed_at: '2026-11-16T08:00:00+01:00' }),
        aTask({ id: 'tomorrow', title: 'Tomorrow', date: '2026-11-17' }),
        aTask({ id: 'someday', title: 'Someday', date: null }),
        aTask({ id: 'gone', title: 'Gone', deleted_at: '2026-11-16T08:00:00+01:00' }),
      ],
    });

    const view = dayView(state, TODAY, MON_10_15);

    expect(view.anytime.items.map((i) => i.title)).toEqual(['Open']);
    expect(view.anytime.count).toBe(1);
  });

  it('lists carried-over items first', () => {
    const state = aState({
      tasks: [
        aTask({ id: 'a', title: 'Fresh', position: 1 }),
        aTask({ id: 'b', title: 'Left over', carried_over: true, position: 2 }),
      ],
    });

    const view = dayView(state, TODAY, MON_10_15);

    expect(view.anytime.items.map((i) => i.title)).toEqual(['Left over', 'Fresh']);
    expect(view.anytime.items[0]?.carriedOver).toBe(true);
  });

  it('keeps Someday Tasks out of Anytime and lists them under Someday', () => {
    const state = aState({ tasks: [aTask({ id: 's', title: 'Learn Welsh', date: null })] });

    const view = dayView(state, TODAY, MON_10_15);

    expect(view.anytime.count).toBe(0);
    expect(view.someday.count).toBe(1);
    expect(view.someday.items.map((i) => i.title)).toEqual(['Learn Welsh']);
  });
});

describe('Done today', () => {
  it('counts done against all of the day, newest first', () => {
    const state = aState({
      tasks: [
        aTask({ id: 'a', title: 'First', completed_at: '2026-11-16T08:00:00+01:00' }),
        aTask({ id: 'b', title: 'Second', completed_at: '2026-11-16T09:40:00+01:00' }),
        aTask({ id: 'c', title: 'Still open' }),
      ],
    });

    const view = dayView(state, TODAY, MON_10_15);

    expect(view.done.total).toBe(3);
    expect(view.done.count).toBe(2);
    expect(view.done.items.map((i) => i.title)).toEqual(['Second', 'First']);
    expect(view.done.items[0]?.completedTime).toBe('09:40');
  });
});

describe('the strip of days', () => {
  it('covers today and the next 7 days with a dot count of Events and open Tasks', () => {
    const state = aState({
      events: [anEvent({ id: 'e1', date: '2026-11-18' })],
      tasks: [
        aTask({ id: 'a', date: '2026-11-16' }),
        aTask({ id: 'b', date: '2026-11-18' }),
        aTask({ id: 'c', date: '2026-11-18', completed_at: '2026-11-16T07:00:00+01:00' }),
      ],
    });

    const view = dayView(state, TODAY, MON_10_15);

    expect(view.strip).toHaveLength(8);
    expect(view.strip[0]).toEqual({ date: '2026-11-16', events: 0, tasks: 1 });
    expect(view.strip[2]).toEqual({ date: '2026-11-18', events: 1, tasks: 1 });
    expect(view.strip[7]?.date).toBe('2026-11-23');
  });
});
