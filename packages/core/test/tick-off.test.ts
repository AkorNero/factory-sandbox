import { describe, expect, it } from 'vitest';
import { apply, applyChanges, dayView } from '../src/index.ts';
import { MON_10_15, TODAY, aState, aTask } from './helpers.ts';

describe('ticking a Task off', () => {
  it('records the Completion time, moves it out of Anytime today into Done today, and counts it', () => {
    const state = aState({
      tasks: [aTask({ id: 'a', title: 'Buy stamps', position: 1 }), aTask({ id: 'b', title: 'Call Ann', position: 2 })],
    });

    const after = applyChanges(state, apply(state, { type: 'tickTask', id: 'a' }, MON_10_15));

    const view = dayView(after, TODAY, MON_10_15);
    expect(view.anytime.items.map((i) => i.title)).toEqual(['Call Ann']);
    expect(view.done.items.map((i) => i.title)).toEqual(['Buy stamps']);
    expect(view.done.items[0]?.completedTime).toBe('10:15');
    expect([view.done.count, view.done.total]).toEqual([1, 2]);
  });

  it('changes only the Completion time and updated-at columns', () => {
    const state = aState({ tasks: [aTask({ id: 'a' })] });

    const changes = apply(state, { type: 'tickTask', id: 'a' }, MON_10_15);

    expect(changes.inserts).toEqual([]);
    expect(changes.deletes).toEqual([]);
    expect(changes.updates).toEqual([
      { table: 'tasks', id: 'a', set: { completed_at: MON_10_15, updated_at: MON_10_15 } },
    ]);
  });

  it('lists the newest tick first among the done items', () => {
    let state = aState({ tasks: [aTask({ id: 'a', title: 'First' }), aTask({ id: 'b', title: 'Second' })] });
    state = applyChanges(state, apply(state, { type: 'tickTask', id: 'a' }, '2026-11-16T09:40:00+01:00'));
    state = applyChanges(state, apply(state, { type: 'tickTask', id: 'b' }, MON_10_15));

    expect(dayView(state, TODAY, MON_10_15).done.items.map((i) => i.title)).toEqual(['Second', 'First']);
  });

  it('keeps the first Completion time when an already done Task is ticked again', () => {
    const state = aState({ tasks: [aTask({ id: 'a', completed_at: '2026-11-16T08:00:00+01:00' })] });

    expect(apply(state, { type: 'tickTask', id: 'a' }, MON_10_15)).toEqual({ inserts: [], updates: [], deletes: [] });
  });

  it('ignores a Task that does not exist', () => {
    expect(apply(aState(), { type: 'tickTask', id: 'nope' }, MON_10_15).updates).toEqual([]);
  });
});

describe('editing a Completion time', () => {
  const DONE_AT = '2026-11-16T09:40:00+01:00';

  it('moves the done item to the new time on the same day, keeping the date and offset', () => {
    const state = aState({
      tasks: [
        aTask({ id: 'a', title: 'Late tick', completed_at: '2026-11-16T10:10:00+01:00' }),
        aTask({ id: 'b', title: 'Earlier', completed_at: DONE_AT }),
      ],
    });

    const changes = apply(state, { type: 'setCompletionTime', id: 'a', time: '07:30' }, MON_10_15);
    const after = applyChanges(state, changes);

    expect(changes.updates).toEqual([
      { table: 'tasks', id: 'a', set: { completed_at: '2026-11-16T07:30:00+01:00', updated_at: MON_10_15 } },
    ]);
    const done = dayView(after, TODAY, MON_10_15).done.items;
    expect(done.map((i) => [i.title, i.completedTime])).toEqual([
      ['Earlier', '09:40'],
      ['Late tick', '07:30'],
    ]);
  });

  it.each(['', '7:30', '25:00', '09:61', 'noon'])('rejects the invalid time %j', (time) => {
    const state = aState({ tasks: [aTask({ id: 'a', completed_at: DONE_AT })] });

    expect(apply(state, { type: 'setCompletionTime', id: 'a', time }, MON_10_15).updates).toEqual([]);
  });

  it('does not tick a Task that is not done', () => {
    const state = aState({ tasks: [aTask({ id: 'a' })] });

    expect(apply(state, { type: 'setCompletionTime', id: 'a', time: '08:00' }, MON_10_15).updates).toEqual([]);
  });
});

describe('unticking a Task', () => {
  const DONE_AT = '2026-11-16T09:40:00+01:00';

  it('returns it to Anytime today and clears its Completion time', () => {
    const state = aState({ tasks: [aTask({ id: 'a', title: 'Buy stamps', completed_at: DONE_AT })] });

    const changes = apply(state, { type: 'untickTask', id: 'a' }, MON_10_15);
    const after = applyChanges(state, changes);

    expect(changes.updates).toEqual([
      { table: 'tasks', id: 'a', set: { completed_at: null, updated_at: MON_10_15 } },
    ]);
    const view = dayView(after, TODAY, MON_10_15);
    expect(view.anytime.items.map((i) => i.title)).toEqual(['Buy stamps']);
    expect(view.done.count).toBe(0);
    expect(after.tasks[0]?.completed_at).toBeNull();
  });

  it('does nothing for a Task that is not done', () => {
    const state = aState({ tasks: [aTask({ id: 'a' })] });

    expect(apply(state, { type: 'untickTask', id: 'a' }, MON_10_15).updates).toEqual([]);
  });
});
