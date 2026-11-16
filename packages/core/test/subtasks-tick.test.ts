import { describe, expect, it } from 'vitest';
import { apply, applyChanges, dayView, type Command, type State } from '../src/index.ts';
import { MON_10_15, TODAY, aState, aTask } from './helpers.ts';

const run = (state: State, command: Command, now = MON_10_15) => applyChanges(state, apply(state, command, now));
const NOTHING = { inserts: [], updates: [], deletes: [] };
const task = (state: State, id: string) => state.tasks.find((t) => t.id === id);

describe('ticking a parent', () => {
  const EARLIER = '2026-11-16T09:00:00+01:00';
  const parent = () =>
    aState({
      tasks: [
        aTask({ id: 'rep', title: 'Report' }),
        aTask({ id: 's1', parent_id: 'rep', date: null, completed_at: EARLIER }),
        aTask({ id: 's2', parent_id: 'rep', date: null }),
        aTask({ id: 's3', parent_id: 'rep', date: null }),
      ],
    });

  it('ticks all its remaining Sub-tasks with the same Completion time and keeps the earlier one', () => {
    const changes = apply(parent(), { type: 'tickTask', id: 'rep' }, MON_10_15);

    expect(changes.updates).toEqual([
      { table: 'tasks', id: 's2', set: { completed_at: MON_10_15, updated_at: MON_10_15 } },
      { table: 'tasks', id: 's3', set: { completed_at: MON_10_15, updated_at: MON_10_15 } },
    ]);
  });

  it('leaves all the Sub-tasks in Done today, and the parent itself unlisted', () => {
    const view = dayView(run(parent(), { type: 'tickTask', id: 'rep' }), TODAY, MON_10_15);

    expect(view.done.items.map((i) => i.id).sort()).toEqual(['s1', 's2', 's3']);
    expect(view.anytime.items).toEqual([]);
    expect([view.done.count, view.done.total]).toEqual([3, 3]);
  });

  it('does nothing when every Sub-task is already done', () => {
    const state = run(parent(), { type: 'tickTask', id: 'rep' });

    expect(apply(state, { type: 'tickTask', id: 'rep' }, '2026-11-16T11:00:00+01:00')).toEqual(NOTHING);
  });
});

describe('ticking in Someday dates the Task to the day it was ticked', () => {
  const NEXT_DAY = '2026-11-17T00:30:00+01:00';

  it('dates a Someday Task to the local date of its Completion time, so it shows in that day Done today', () => {
    const state = aState({ tasks: [aTask({ id: 'a', title: 'Idea', date: null })] });

    const changes = apply(state, { type: 'tickTask', id: 'a' }, NEXT_DAY);

    expect(changes.updates).toEqual([
      { table: 'tasks', id: 'a', set: { completed_at: NEXT_DAY, date: '2026-11-17', updated_at: NEXT_DAY } },
    ]);
    const view = dayView(applyChanges(state, changes), '2026-11-17', NEXT_DAY);
    expect(view.done.items.map((i) => i.title)).toEqual(['Idea']);
    expect(view.someday.count).toBe(0);
  });

  it('keeps the date of a Task that already has one', () => {
    const state = aState({ tasks: [aTask({ id: 'a', date: '2026-11-18' })] });

    expect(apply(state, { type: 'tickTask', id: 'a' }, MON_10_15).updates[0]?.set).not.toHaveProperty('date');
  });

  it('does not date a Someday parent when ticking one Sub-task leaves the parent open', () => {
    const state = aState({
      tasks: [aTask({ id: 'rep', date: null }), aTask({ id: 's1', parent_id: 'rep', date: null }), aTask({ id: 's2', parent_id: 'rep', date: null })],
    });

    expect(task(run(state, { type: 'tickTask', id: 's1' }), 'rep')?.date).toBeNull();
  });

  it('dates a Someday parent when ticking the last Sub-task makes it done, and the Sub-tasks show in Done today', () => {
    const state = aState({
      tasks: [
        aTask({ id: 'rep', title: 'Report', date: null }),
        aTask({ id: 's1', parent_id: 'rep', date: null, completed_at: '2026-11-16T09:00:00+01:00' }),
        aTask({ id: 's2', parent_id: 'rep', date: null }),
      ],
    });

    const changes = apply(state, { type: 'tickTask', id: 's2' }, MON_10_15);

    expect(changes.updates).toContainEqual({ table: 'tasks', id: 'rep', set: { date: TODAY, updated_at: MON_10_15 } });
    const view = dayView(applyChanges(state, changes), TODAY, MON_10_15);
    expect(view.done.items.map((i) => i.id).sort()).toEqual(['s1', 's2']);
  });

  it('dates a Someday parent when the parent itself is ticked', () => {
    const state = aState({
      tasks: [aTask({ id: 'rep', date: null }), aTask({ id: 's1', parent_id: 'rep', date: null }), aTask({ id: 's2', parent_id: 'rep', date: null })],
    });

    const after = run(state, { type: 'tickTask', id: 'rep' });

    expect(task(after, 'rep')?.date).toBe(TODAY);
    expect(dayView(after, TODAY, MON_10_15).done.count).toBe(2);
  });

  it('does not date a dated parent', () => {
    const state = aState({ tasks: [aTask({ id: 'rep', date: '2026-11-20' }), aTask({ id: 's1', parent_id: 'rep', date: null })] });

    expect(task(run(state, { type: 'tickTask', id: 's1' }), 'rep')?.date).toBe('2026-11-20');
  });
});
