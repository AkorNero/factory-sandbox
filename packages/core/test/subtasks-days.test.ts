import { describe, expect, it } from 'vitest';
import { apply, applyChanges, canDateTask, canPlace, canUndate, dayView, type Command, type State } from '../src/index.ts';
import { MON_10_15, TODAY, aState, aTask, anEvent } from './helpers.ts';

const run = (state: State, command: Command, now = MON_10_15) => applyChanges(state, apply(state, command, now));
const NOTHING = { inserts: [], updates: [], deletes: [] };
const task = (state: State, id: string) => state.tasks.find((t) => t.id === id);

const TUE = '2026-11-17';
const WED = '2026-11-18';
const events = [
  anEvent({ id: 'work', title: 'Deep work', start_time: '09:00', end_time: '11:00' }),
  anEvent({ id: 'tue', title: 'Writing', date: TUE, start_time: '14:00', end_time: '16:00' }),
  anEvent({ id: 'wed', title: 'Review', date: WED, start_time: '09:00', end_time: '10:00' }),
];

describe('a Task with Sub-tasks is never placed', () => {
  const state = () =>
    aState({ events, tasks: [aTask({ id: 'rep', title: 'Report' }), aTask({ id: 's1', parent_id: 'rep', date: null })] });

  it('cannot be placed or dragged onto an Event, but its Sub-tasks can', () => {
    expect(canPlace(state(), 'rep', 'work')).toBe(false);
    expect(apply(state(), { type: 'placeTask', id: 'rep', eventId: 'work' }, MON_10_15)).toEqual(NOTHING);
    expect(canPlace(state(), 's1', 'work')).toBe(true);
  });
});

describe('Sub-tasks spread over Events on different days', () => {
  // Report is on today; one piece is placed today, one tomorrow, one on Wednesday, one is not placed
  const spread = () => {
    let s = aState({ events, tasks: [aTask({ id: 'rep', title: 'Report', date: TODAY })] });
    for (const [id, title] of [['s1', 'Outline'], ['s2', 'Draft'], ['s3', 'Review'], ['s4', 'Send']]) {
      s = run(s, { type: 'addSubtask', id: id!, parentId: 'rep', title: title! });
    }
    s = run(s, { type: 'placeTask', id: 's1', eventId: 'work' });
    s = run(s, { type: 'placeTask', id: 's2', eventId: 'tue' });
    s = run(s, { type: 'placeTask', id: 's3', eventId: 'wed' });
    return s;
  };

  it('keeps each Sub-task on its own day, not touching its date, and the parent on its day', () => {
    const state = spread();

    expect([task(state, 's2')?.date, task(state, 's2')?.event_id]).toEqual([null, 'tue']);
    expect(task(state, 'rep')).toMatchObject({ date: TODAY, event_id: null });
  });

  it('shows each day only its own Sub-tasks, labelled with the parent', () => {
    const state = spread();
    const titles = (date: string, pick: (v: ReturnType<typeof dayView>) => { title: string; parentTitle: string | null }[]) =>
      pick(dayView(state, date, MON_10_15)).map((i) => `${i.parentTitle} › ${i.title}`);

    expect(titles(TODAY, (v) => v.now.cards.flatMap((c) => c.tasks))).toEqual(['Report › Outline']);
    expect(titles(TODAY, (v) => v.anytime.items)).toEqual(['Report › Send']);
    expect(titles(TUE, (v) => v.later.events.flatMap((e) => e.tasks))).toEqual(['Report › Draft']);
    expect(titles(WED, (v) => v.later.events.flatMap((e) => e.tasks))).toEqual(['Report › Review']);
    expect(dayView(state, TUE, MON_10_15).anytime.items).toEqual([]);
    expect(dayView(state, WED, MON_10_15).anytime.items).toEqual([]);
  });

  it('counts only the open Sub-tasks of that day on the strip, never the parent', () => {
    const strip = dayView(spread(), TODAY, MON_10_15).strip;

    expect(strip.slice(0, 3).map((d) => [d.date, d.tasks])).toEqual([
      [TODAY, 2],
      [TUE, 1],
      [WED, 1],
    ]);
  });

  it('lets an unplaced Sub-task follow its parent to the parent day when the Event goes', () => {
    const state = run(spread(), { type: 'deleteEvent', id: 'tue' });

    expect(task(state, 's2')).toMatchObject({ event_id: null, date: null });
    expect(dayView(state, TODAY, MON_10_15).anytime.items.map((i) => i.title)).toEqual(['Draft', 'Send']);
    expect(dayView(state, TUE, MON_10_15).anytime.items).toEqual([]);
  });
});

describe('deleting an Event (assumption A1)', () => {
  it('leaves its Sub-tasks unplaced, following their parent day and not the Event day', () => {
    const state = aState({
      events,
      tasks: [
        aTask({ id: 'rep', title: 'Report', date: TODAY }),
        aTask({ id: 's1', parent_id: 'rep', date: null, event_id: 'tue' }),
      ],
    });

    const changes = apply(state, { type: 'deleteEvent', id: 'tue' }, MON_10_15);

    expect(changes.updates).toEqual([{ table: 'tasks', id: 's1', set: { event_id: null, updated_at: MON_10_15 } }]);
    const view = dayView(applyChanges(state, changes), TODAY, MON_10_15);
    expect(view.anytime.items.map((i) => [i.id, i.parentTitle])).toEqual([['s1', 'Report']]);
    expect(dayView(applyChanges(state, changes), TUE, MON_10_15).anytime.items).toEqual([]);
  });
});

describe('a parent in Someday', () => {
  const state = () =>
    aState({
      events,
      tasks: [aTask({ id: 'rep', title: 'Report', date: null }), aTask({ id: 's1', parent_id: 'rep', date: null }), aTask({ id: 's2', parent_id: 'rep', date: null })],
    });

  it('stays in Someday while a Sub-task can be placed in an Event and shows there', () => {
    const after = run(state(), { type: 'placeTask', id: 's1', eventId: 'work' });

    const view = dayView(after, TODAY, MON_10_15);
    expect(view.now.cards[0]?.tasks.map((t) => [t.id, t.parentTitle])).toEqual([['s1', 'Report']]);
    expect(view.someday.items.map((i) => i.title)).toEqual(['Report']);
    expect(task(after, 'rep')?.date).toBeNull();
  });

  it('goes back to Someday when the Sub-task is taken out of its Event: it is on no day', () => {
    let after = run(state(), { type: 'placeTask', id: 's1', eventId: 'work' });
    after = run(after, { type: 'unplaceTask', id: 's1' });

    const view = dayView(after, TODAY, MON_10_15);
    expect(view.now.cards[0]?.tasks).toEqual([]);
    expect(view.anytime.items).toEqual([]);
    expect(view.someday.items.map((i) => i.title)).toEqual(['Report']);
  });

  it('cannot have a Sub-task dropped on Someday, or dated, on its own', () => {
    expect(canUndate(state(), 's1')).toBe(false);
    expect(canDateTask(state(), 's1', TODAY)).toBe(false);
  });

  it('can be sent to Someday as a whole, keeping its placed Sub-tasks placed', () => {
    let s = aState({ events, tasks: [aTask({ id: 'rep', title: 'Report', date: TODAY }), aTask({ id: 's1', parent_id: 'rep', date: null, event_id: 'work' })] });
    expect(canUndate(s, 'rep')).toBe(true);

    s = run(s, { type: 'undateTask', id: 'rep' });

    expect(task(s, 'rep')?.date).toBeNull();
    expect(task(s, 's1')?.event_id).toBe('work');
  });

  it('cannot be sent to Someday once it is done through its Sub-tasks', () => {
    const s = aState({ tasks: [aTask({ id: 'rep', date: TODAY }), aTask({ id: 's1', parent_id: 'rep', date: null, completed_at: '2026-11-16T09:00:00+01:00' })] });

    expect(canUndate(s, 'rep')).toBe(false);
  });
});

describe('re-dating a parent', () => {
  const state = () =>
    aState({
      events,
      tasks: [
        aTask({ id: 'rep', title: 'Report', date: TODAY }),
        aTask({ id: 'done', parent_id: 'rep', date: null, event_id: 'work', completed_at: '2026-11-16T09:30:00+01:00' }),
        aTask({ id: 'open1', parent_id: 'rep', date: null, event_id: 'tue' }),
        aTask({ id: 'open2', parent_id: 'rep', date: null }),
      ],
    });

  it('brings its open Sub-tasks along and clears their Placements, keeping the done one in place', () => {
    const after = run(state(), { type: 'dateTask', id: 'rep', date: WED });

    expect(task(after, 'rep')?.date).toBe(WED);
    expect(task(after, 'open1')?.event_id).toBeNull();
    expect(task(after, 'done')?.event_id).toBe('work');
    expect(dayView(after, WED, MON_10_15).anytime.items.map((i) => i.id).sort()).toEqual(['open1', 'open2']);
    expect(dayView(after, TUE, MON_10_15).later.events[0]?.tasks).toEqual([]);
  });

  it('changes only the parent date and the Placements of the open Sub-tasks that have one', () => {
    const changes = apply(state(), { type: 'dateTask', id: 'rep', date: WED }, MON_10_15);

    expect(changes.updates).toEqual([
      { table: 'tasks', id: 'rep', set: { date: WED, updated_at: MON_10_15 } },
      { table: 'tasks', id: 'open1', set: { event_id: null, updated_at: MON_10_15 } },
    ]);
  });

  it('on the same day still clears the Placements of its open Sub-tasks (a drop on Anytime)', () => {
    expect(canDateTask(state(), 'rep', TODAY)).toBe(true);

    const after = run(state(), { type: 'dateTask', id: 'rep', date: TODAY });

    expect(task(after, 'open1')?.event_id).toBeNull();
  });

  it('is a no-op on the same day when no open Sub-task is placed', () => {
    const s = aState({ tasks: [aTask({ id: 'rep', date: TODAY }), aTask({ id: 's1', parent_id: 'rep', date: null })] });

    expect(canDateTask(s, 'rep', TODAY)).toBe(false);
  });

  it('dates a Someday parent to today with Do today, bringing its placed open Sub-tasks to Anytime', () => {
    const s = aState({ events, tasks: [aTask({ id: 'rep', date: null }), aTask({ id: 's1', parent_id: 'rep', date: null, event_id: 'tue' })] });

    const after = run(s, { type: 'dateTask', id: 'rep', date: TODAY });

    expect(dayView(after, TODAY, MON_10_15).anytime.items.map((i) => i.id)).toEqual(['s1']);
  });
});

describe('deleting', () => {
  it('a Task deletes its Sub-tasks with it', () => {
    const state = aState({ tasks: [aTask({ id: 'rep' }), aTask({ id: 's1', parent_id: 'rep', date: null }), aTask({ id: 'other' })] });

    const after = run(state, { type: 'deleteTask', id: 'rep' });

    expect(after.tasks.map((t) => t.id)).toEqual(['other']);
  });

  it('the last Sub-task leaves a plain open Task', () => {
    const state = aState({
      tasks: [aTask({ id: 'rep', title: 'Report' }), aTask({ id: 's1', parent_id: 'rep', date: null, completed_at: '2026-11-16T09:00:00+01:00' })],
    });
    expect(dayView(state, TODAY, MON_10_15).anytime.items).toEqual([]);

    const after = run(state, { type: 'deleteTask', id: 's1' });

    expect(dayView(after, TODAY, MON_10_15).anytime.items.map((i) => i.title)).toEqual(['Report']);
  });
});
