import { describe, expect, it } from 'vitest';
import { apply, applyChanges, dayView, type Command, type State } from '../src/index.ts';
import { MON_10_15, TODAY, aState, aTask, anEvent } from './helpers.ts';

const NOTHING = { inserts: [], updates: [], deletes: [] };
const run = (state: State, command: Command, now = MON_10_15) => applyChanges(state, apply(state, command, now));

describe('sending a Task to Someday (undate)', () => {
  const base = () =>
    aState({
      events: [anEvent({ id: 'work', title: 'Deep work', start_time: '09:00', end_time: '11:00' })],
      tasks: [
        aTask({ id: 'placed', title: 'Write intro', event_id: 'work', position: 1 }),
        aTask({ id: 'loose', title: 'Buy stamps', position: 2 }),
      ],
    });

  it('clears the date and the Placement, so it has no date and is Unplaced', () => {
    const after = run(base(), { type: 'undateTask', id: 'placed' });

    expect(after.tasks.find((t) => t.id === 'placed')).toMatchObject({ date: null, event_id: null });
  });

  it('moves it from its Event card into Someday', () => {
    const view = dayView(run(base(), { type: 'undateTask', id: 'placed' }), TODAY, MON_10_15);

    expect(view.now.cards[0]?.tasks).toEqual([]);
    expect(view.someday.items.map((t) => t.title)).toEqual(['Write intro']);
    expect(view.someday.count).toBe(1);
  });

  it('changes only the date, the Placement and updated-at', () => {
    expect(apply(base(), { type: 'undateTask', id: 'placed' }, MON_10_15).updates).toEqual([
      { table: 'tasks', id: 'placed', set: { date: null, event_id: null, updated_at: MON_10_15 } },
    ]);
  });

  it('leaves out the Placement when the Task has none', () => {
    expect(apply(base(), { type: 'undateTask', id: 'loose' }, MON_10_15).updates).toEqual([
      { table: 'tasks', id: 'loose', set: { date: null, updated_at: MON_10_15 } },
    ]);
  });

  it('does nothing for a Task that is already in Someday', () => {
    const state = aState({ tasks: [aTask({ id: 's', date: null })] });

    expect(apply(state, { type: 'undateTask', id: 's' }, MON_10_15)).toEqual(NOTHING);
  });

  it('does nothing for a Sub-task: it follows its parent and cannot go to Someday on its own', () => {
    const state = aState({ tasks: [aTask({ id: 'p' }), aTask({ id: 'sub', parent_id: 'p' })] });

    expect(apply(state, { type: 'undateTask', id: 'sub' }, MON_10_15)).toEqual(NOTHING);
  });

  it('does nothing for a done Task, a recurring Task or a Task that is not there', () => {
    const state = aState({
      tasks: [
        aTask({ id: 'done', completed_at: '2026-11-16T08:00:00+01:00' }),
        aTask({ id: 'daily', series_id: 'series-1', occurrence_date: TODAY }),
        aTask({ id: 'gone', deleted_at: '2026-11-16T08:00:00+01:00' }),
      ],
    });

    for (const id of ['done', 'daily', 'gone', 'nope']) {
      expect(apply(state, { type: 'undateTask', id }, MON_10_15)).toEqual(NOTHING);
    }
  });
});
