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

describe('"Do today" on a Someday Task (date)', () => {
  const base = () =>
    aState({
      tasks: [
        aTask({ id: 'idea', title: 'Learn Welsh', date: null, position: 1 }),
        aTask({ id: 'open', title: 'Buy stamps', position: 2 }),
      ],
    });

  it('dates it to today and shows it in Anytime today, out of Someday', () => {
    const view = dayView(run(base(), { type: 'dateTask', id: 'idea', date: TODAY }), TODAY, MON_10_15);

    expect(view.anytime.items.map((t) => t.title)).toEqual(['Learn Welsh', 'Buy stamps']);
    expect(view.anytime.count).toBe(2);
    expect(view.someday.count).toBe(0);
  });

  it('changes only the date and updated-at', () => {
    expect(apply(base(), { type: 'dateTask', id: 'idea', date: TODAY }, MON_10_15).updates).toEqual([
      { table: 'tasks', id: 'idea', set: { date: TODAY, updated_at: MON_10_15 } },
    ]);
  });

  it('clears the Placement of a dated Task that is dated to another day', () => {
    const state = aState({
      events: [anEvent({ id: 'work' })],
      tasks: [aTask({ id: 'placed', event_id: 'work' })],
    });

    expect(apply(state, { type: 'dateTask', id: 'placed', date: '2026-11-17' }, MON_10_15).updates).toEqual([
      { table: 'tasks', id: 'placed', set: { date: '2026-11-17', event_id: null, updated_at: MON_10_15 } },
    ]);
  });

  it('does nothing for a Task that already has that day and no Placement, or for a Sub-task', () => {
    const state = aState({ tasks: [aTask({ id: 'open' }), aTask({ id: 'sub', parent_id: 'open' })] });

    expect(apply(state, { type: 'dateTask', id: 'open', date: TODAY }, MON_10_15)).toEqual(NOTHING);
    expect(apply(state, { type: 'dateTask', id: 'sub', date: '2026-11-17' }, MON_10_15)).toEqual(NOTHING);
  });
});

describe('Someday stays out of the day', () => {
  const state = () =>
    aState({
      events: [anEvent({ id: 'work', start_time: '09:00', end_time: '11:00' })],
      tasks: [
        aTask({ id: 'idea', title: 'Learn Welsh', date: null }),
        aTask({ id: 'project', title: 'Paint shed', date: null }),
        aTask({ id: 'first-coat', title: 'First coat', parent_id: 'project' }),
        aTask({ id: 'today', title: 'Buy stamps', date: TODAY }),
      ],
    });

  it("keeps Someday Tasks, and the Sub-tasks that follow them, out of Today's sections", () => {
    const view = dayView(state(), TODAY, MON_10_15);

    expect(view.anytime.items.map((t) => t.title)).toEqual(['Buy stamps']);
    expect(view.done.total).toBe(1);
    expect(view.now.cards[0]?.tasks).toEqual([]);
  });

  it("keeps them out of the strip's dot counts on every day", () => {
    const view = dayView(state(), TODAY, MON_10_15);

    expect(view.strip.map((d) => d.tasks)).toEqual([1, 0, 0, 0, 0, 0, 0, 0]);
  });

  it('keeps them out of the day view of any other day too', () => {
    const view = dayView(state(), '2026-11-18', MON_10_15);

    expect(view.anytime.count).toBe(0);
    expect(view.someday.count).toBe(2); // Someday is the same on every day
  });

  it("drops a Task from the strip's dot count when it is sent to Someday, and brings it back with \"Do today\"", () => {
    const sent = run(state(), { type: 'undateTask', id: 'today' });
    expect(dayView(sent, TODAY, MON_10_15).strip[0]?.tasks).toBe(0);

    const back = run(sent, { type: 'dateTask', id: 'today', date: TODAY });
    expect(dayView(back, TODAY, MON_10_15).strip[0]?.tasks).toBe(1);
  });

  it('marks the Tasks listed in Someday so the menu can offer "Do today"', () => {
    const view = dayView(state(), TODAY, MON_10_15);

    expect(view.someday.items.every((i) => i.someday)).toBe(true);
    expect(view.anytime.items.every((i) => !i.someday)).toBe(true);
  });
});
