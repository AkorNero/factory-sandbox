import { describe, expect, it } from 'vitest';
import { apply, applyChanges, dayView, type Command, type State } from '../src/index.ts';
import { MON_10_15, TODAY, aState, aTask, anEvent } from './helpers.ts';

const run = (state: State, command: Command, now = MON_10_15) => applyChanges(state, apply(state, command, now));
const NOTHING = { inserts: [], updates: [], deletes: [] };
const task = (state: State, id: string) => state.tasks.find((t) => t.id === id);

const deepWork = anEvent({ id: 'work', title: 'Deep work', start_time: '09:00', end_time: '11:00' });

describe('adding a Sub-task', () => {
  it('adds a Sub-task to a Task, with no day of its own, and it shows in Anytime as "Parent › Sub-task"', () => {
    const state = aState({ tasks: [aTask({ id: 'rep', title: 'Report' })] });

    const after = run(state, { type: 'addSubtask', id: 's1', parentId: 'rep', title: ' Draft intro ' });

    expect(task(after, 's1')).toMatchObject({ parent_id: 'rep', title: 'Draft intro', date: null, event_id: null, completed_at: null });
    const items = dayView(after, TODAY, MON_10_15).anytime.items;
    expect(items.map((i) => [i.title, i.parentTitle])).toEqual([['Draft intro', 'Report']]);
  });

  it('never gives a Sub-task Sub-tasks', () => {
    const state = aState({ tasks: [aTask({ id: 'rep' }), aTask({ id: 's1', parent_id: 'rep', date: null })] });

    expect(apply(state, { type: 'addSubtask', id: 's2', parentId: 's1', title: 'Nested' }, MON_10_15)).toEqual(NOTHING);
  });

  it.each([
    ['an empty title', 'rep', '  '],
    ['a missing parent', 'nope', 'Step'],
  ])('ignores %s', (_, parentId, title) => {
    const state = aState({ tasks: [aTask({ id: 'rep' })] });

    expect(apply(state, { type: 'addSubtask', id: 's1', parentId, title }, MON_10_15)).toEqual(NOTHING);
  });
});

describe('the first Sub-task taking over the Placement', () => {
  const placedParent = () =>
    aState({
      events: [deepWork],
      tasks: [aTask({ id: 'rep', title: 'Report', date: TODAY, event_id: 'work' })],
    });

  it('is placed where its parent was, and the parent is no longer placed', () => {
    const after = run(placedParent(), { type: 'addSubtask', id: 's1', parentId: 'rep', title: 'Draft intro' });

    expect(task(after, 'rep')?.event_id).toBeNull();
    expect(task(after, 's1')?.event_id).toBe('work');
    const card = dayView(after, TODAY, MON_10_15).now.cards[0];
    expect(card?.tasks.map((t) => [t.title, t.parentTitle])).toEqual([['Draft intro', 'Report']]);
  });

  it('leaves a second Sub-task unplaced, in Anytime', () => {
    let state = run(placedParent(), { type: 'addSubtask', id: 's1', parentId: 'rep', title: 'Draft intro' });
    state = run(state, { type: 'addSubtask', id: 's2', parentId: 'rep', title: 'Proofread' });

    expect(task(state, 's2')?.event_id).toBeNull();
    const view = dayView(state, TODAY, MON_10_15);
    expect(view.anytime.items.map((t) => t.title)).toEqual(['Proofread']);
    expect(view.now.cards[0]?.tasks.map((t) => t.title)).toEqual(['Draft intro']);
  });

  it('changes only the Placement and updated-at on the parent', () => {
    const changes = apply(placedParent(), { type: 'addSubtask', id: 's1', parentId: 'rep', title: 'Draft intro' }, MON_10_15);

    expect(changes.updates).toEqual([{ table: 'tasks', id: 'rep', set: { event_id: null, updated_at: MON_10_15 } }]);
  });
});

describe('a Task being done exactly when all its Sub-tasks are', () => {
  const somedayParent = (subs: { id: string; done?: boolean }[]) =>
    aState({
      tasks: [
        aTask({ id: 'rep', title: 'Report', date: null }),
        ...subs.map((s) => aTask({ id: s.id, parent_id: 'rep', date: null, completed_at: s.done ? '2026-11-16T09:00:00+01:00' : null })),
      ],
    });
  const parentRow = (state: State) => dayView(state, TODAY, MON_10_15).someday.items.find((i) => i.id === 'rep');

  it('shows its progress while some Sub-tasks are open', () => {
    const state = somedayParent([{ id: 's1', done: true }, { id: 's2' }, { id: 's3' }]);

    expect(parentRow(state)?.subtasks).toEqual({ done: 1, total: 3 });
  });

  it('is done when the last Sub-task is ticked, and leaves Someday', () => {
    let state = somedayParent([{ id: 's1', done: true }, { id: 's2' }]);
    state = run(state, { type: 'tickTask', id: 's2' });

    expect(parentRow(state)).toBeUndefined();
    expect(dayView(state, TODAY, MON_10_15).someday.count).toBe(0);
  });

  it('never stores a Completion time on the parent', () => {
    let state = somedayParent([{ id: 's1' }]);
    state = run(state, { type: 'tickTask', id: 's1' });

    expect(task(state, 'rep')?.completed_at).toBeNull();
  });

  it('is open again when a Sub-task is unticked', () => {
    let state = somedayParent([{ id: 's1', done: true }, { id: 's2', done: true }]);
    expect(parentRow(state)).toBeUndefined();

    state = run(state, { type: 'untickTask', id: 's2' });

    expect(parentRow(state)?.subtasks).toEqual({ done: 1, total: 2 });
  });

  it('is open again when a Sub-task is added to it', () => {
    let state = somedayParent([{ id: 's1', done: true }]);
    state = run(state, { type: 'addSubtask', id: 's2', parentId: 'rep', title: 'One more' });

    expect(parentRow(state)?.subtasks).toEqual({ done: 1, total: 2 });
  });

  it('is open again when it was done as a plain Task and then gets a Sub-task', () => {
    const done = aState({ tasks: [aTask({ id: 'rep', title: 'Report', date: null, completed_at: '2026-11-16T09:00:00+01:00' })] });
    expect(dayView(done, TODAY, MON_10_15).someday.count).toBe(0);

    const after = run(done, { type: 'addSubtask', id: 's1', parentId: 'rep', title: 'Draft' });

    expect(task(after, 'rep')?.completed_at).toBeNull();
    expect(parentRow(after)?.subtasks).toEqual({ done: 0, total: 1 });
  });
});
