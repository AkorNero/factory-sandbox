import { describe, expect, it } from 'vitest';
import { apply, applyChanges, dayView, type State } from '../src/index.ts';
import { MON_10_15, aTask } from './helpers.ts';
import { NOTHING, dailyEvent, dailyTask, handMoved, idOn, lineageOf, run } from './series-fixtures.ts';

const taskDates = (state: State) => state.tasks.filter((t) => !t.parent_id && !t.deleted_at).map((t) => t.occurrence_date ?? `one-off ${t.date}`).sort();
const gym = (d: string) => idOn('gym', d);
const live = <T extends { deleted_at: string | null }>(rows: T[]) => rows.filter((r) => !r.deleted_at);
const liveEventDates = (state: State) => state.events.filter((e) => !e.deleted_at).map((e) => e.date).sort();
const liveSubParents = (state: State) => state.tasks.filter((t) => t.parent_id && !t.deleted_at).map((t) => t.parent_id).sort();

describe('Stop repeating', () => {
  it('keeps the opened Occurrence as a plain one-off and removes the later ones', () => {
    const after = run(dailyTask(), { type: 'stopRepeating', id: idOn('daily', '2026-11-18') });

    expect(after.tasks.find((t) => t.id === idOn('daily', '2026-11-18'))).toMatchObject({ series_id: null, occurrence_date: null, date: '2026-11-18' });
    expect(taskDates(after)).toEqual(['2026-11-16', '2026-11-17', 'one-off 2026-11-18']);
    expect(dayView(after, '2026-11-18', MON_10_15).anytime.items[0]).toMatchObject({ recurring: false, recurrence: null });
  });

  it('ends the series the day before, so nothing is made again, and leaves earlier Occurrences linked', () => {
    const after = run(dailyTask(), { type: 'stopRepeating', id: idOn('daily', '2026-11-18') });

    expect(lineageOf(after, 'daily')).toEqual([expect.objectContaining({ starts_on: '2026-11-16', ends_on: '2026-11-17' })]);
    expect(live(run(after, { type: 'materialise', dates: ['2026-11-19', '2026-11-25'] }).tasks)).toHaveLength(3);
    expect(after.tasks.find((t) => t.id === idOn('daily', '2026-11-17'))).toMatchObject({ series_id: 'daily', occurrence_date: '2026-11-17' });
  });

  it('ends every segment of a lineage that was split, not only the opened one', () => {
    let state = run(dailyTask(), { type: 'renameTask', id: idOn('daily', '2026-11-19'), title: 'Later', scope: 'following' });
    state = run(state, { type: 'stopRepeating', id: idOn('daily', '2026-11-17') });

    expect(lineageOf(state, 'daily').every((s) => s.ends_on !== null && s.ends_on < '2026-11-17')).toBe(true);
    expect(live(run(state, { type: 'materialise', dates: ['2026-11-21', '2026-11-30'] }).tasks).filter((t) => !t.parent_id)).toHaveLength(2);
  });

  it('keeps done Occurrences and their link, removes the open later ones, and takes the Sub-tasks of the opened one along as plain ones', () => {
    let state = dailyTask({ template: { title: 'Clean', subtasks: [{ key: 'k', title: 'Hoover' }] } });
    state = run(state, { type: 'tickTask', id: idOn('daily', '2026-11-20') });

    const after = run(state, { type: 'stopRepeating', id: idOn('daily', '2026-11-17') });

    expect(taskDates(after)).toEqual(['2026-11-16', '2026-11-20', 'one-off 2026-11-17']);
    expect(after.tasks.find((t) => t.parent_id === idOn('daily', '2026-11-17'))).toMatchObject({ series_subtask_key: null });
    expect(after.tasks.find((t) => t.id === idOn('daily', '2026-11-20'))).toMatchObject({ series_id: 'daily' });
  });

  it('on an Event Occurrence unplaces the items of the removed Events, which keep their day', () => {
    const state = applyChanges(dailyEvent(), {
      inserts: [{ table: 'tasks', row: aTask({ id: 'bag', date: '2026-11-19', event_id: gym('2026-11-19') }) }],
      updates: [],
      deletes: [],
    });

    const after = run(state, { type: 'stopRepeating', id: gym('2026-11-17') });

    expect(liveEventDates(after)).toEqual(['2026-11-16', '2026-11-17']);
    expect(after.events.find((e) => e.id === gym('2026-11-17'))).toMatchObject({ series_id: null, occurrence_date: null });
    expect(after.tasks.find((t) => t.id === 'bag')).toMatchObject({ event_id: null, date: '2026-11-19' });
  });

  it('does nothing on a one-off, a done Occurrence or an item that does not exist', () => {
    const state = applyChanges(run(dailyTask(), { type: 'tickTask', id: idOn('daily', '2026-11-19') }), { inserts: [{ table: 'tasks', row: aTask({ id: 'one' }) }], updates: [], deletes: [] });

    for (const id of ['one', idOn('daily', '2026-11-19'), 'nope']) expect(apply(state, { type: 'stopRepeating', id }, MON_10_15), id).toEqual(NOTHING);
  });
});

describe('Delete an Occurrence', () => {
  it('"Just this one" leaves no trace on screen: no Skipped, nothing in the overnight banner', () => {
    const after = run(dailyTask(), { type: 'deleteTask', id: idOn('daily', '2026-11-16'), scope: 'one' });

    const view = dayView(after, '2026-11-16', MON_10_15);
    expect(view.anytime.items).toEqual([]);
    expect(view.done.items).toEqual([]);
    expect(view.overnight).toEqual({ carried: [], skipped: [] });
    expect(view.strip.find((d) => d.date === '2026-11-16')?.tasks).toBe(0);
  });

  it('"Just this one" lets the next Occurrence appear, also on a second device that only has the synced rows', () => {
    const phone = run(dailyTask(), { type: 'deleteTask', id: idOn('daily', '2026-11-17'), scope: 'one' });
    // the desktop got the series and the Occurrences from the phone, and has not made anything of its own yet
    const desktop: State = structuredClone(phone);

    const later = run(desktop, { type: 'materialise', dates: ['2026-11-17', '2026-11-21'] });

    expect(later.tasks.filter((t) => !t.deleted_at).map((t) => t.occurrence_date).sort()).toEqual(['2026-11-16', '2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21']);
    expect(later.tasks.filter((t) => t.deleted_at).map((t) => t.id)).toEqual([idOn('daily', '2026-11-17')]);
  });

  it('"Just this one" on an Event Occurrence leaves no "slot missed" and its items unplaced on their day', () => {
    const state = applyChanges(dailyEvent(), {
      inserts: [{ table: 'tasks', row: aTask({ id: 'bag', date: '2026-11-16', event_id: gym('2026-11-16') }) }],
      updates: [],
      deletes: [],
    });
    const later = '2026-11-16T20:00:00+01:00';

    const after = run(state, { type: 'deleteEvent', id: gym('2026-11-16'), scope: 'one' }, later);

    const view = dayView(after, '2026-11-16', later);
    expect(view.earlier.events).toEqual([]);
    expect(view.anytime.items.map((i) => i.title)).toEqual(['A task']);
    expect(after.tasks.find((t) => t.id === 'bag')?.carried_from_event_id).toBeNull();
  });

  it('"This and following" removes this Occurrence and all later ones, and the series ends', () => {
    const after = run(dailyTask(), { type: 'deleteTask', id: idOn('daily', '2026-11-18'), scope: 'following' });

    expect(taskDates(after)).toEqual(['2026-11-16', '2026-11-17']);
    expect(lineageOf(after, 'daily')).toEqual([expect.objectContaining({ ends_on: '2026-11-17' })]);
    expect(live(run(after, { type: 'materialise', dates: ['2026-11-18', '2026-11-30'] }).tasks)).toHaveLength(2);
  });

  it('"This and following" keeps earlier, done and Skipped Occurrences, and removes the Sub-tasks of removed ones', () => {
    let state = dailyTask({ template: { title: 'Clean', subtasks: [{ key: 'k', title: 'Hoover' }] } });
    state = run(state, { type: 'tickTask', id: idOn('daily', '2026-11-19') });
    state = { ...state, tasks: state.tasks.map((t) => (t.id === idOn('daily', '2026-11-20') ? { ...t, skipped_at: '2026-11-21T00:00:00+01:00' } : t)) };

    const after = run(state, { type: 'deleteTask', id: idOn('daily', '2026-11-17'), scope: 'following' });

    expect(taskDates(after)).toEqual(['2026-11-16', '2026-11-19', '2026-11-20']);
    expect(liveSubParents(after)).toEqual([idOn('daily', '2026-11-16'), idOn('daily', '2026-11-19'), idOn('daily', '2026-11-20')].sort());
  });

  it('"This and following" on an Event removes it and later ones and unplaces their items on their days', () => {
    const state = applyChanges(dailyEvent(), {
      inserts: [
        { table: 'tasks', row: aTask({ id: 'a', date: '2026-11-18', event_id: gym('2026-11-18') }) },
        { table: 'tasks', row: aTask({ id: 'b', date: '2026-11-16', event_id: gym('2026-11-16') }) },
      ],
      updates: [],
      deletes: [],
    });

    const after = run(state, { type: 'deleteEvent', id: gym('2026-11-18'), scope: 'following' });

    expect(liveEventDates(after)).toEqual(['2026-11-16', '2026-11-17']);
    expect(after.tasks.find((t) => t.id === 'a')).toMatchObject({ event_id: null, date: '2026-11-18' });
    expect(after.tasks.find((t) => t.id === 'b')).toMatchObject({ event_id: gym('2026-11-16') });
    expect(live(run(after, { type: 'materialise', dates: ['2026-11-18', '2026-11-19'] }).events)).toHaveLength(2);
  });
});

describe('A moved Occurrence', () => {
  it('stays linked to its series and leaves no duplicate on its original day, also after the series is split', () => {
    let state = handMoved(dailyTask(), idOn('daily', '2026-11-18'), '2026-11-21');
    state = run(state, { type: 'renameTask', id: idOn('daily', '2026-11-17'), title: 'Mist', scope: 'following' });

    const after = run(state, { type: 'materialise', dates: ['2026-11-18'] });

    expect(after.tasks.filter((t) => !t.parent_id)).toHaveLength(5);
    expect(after.tasks.find((t) => t.id === idOn('daily', '2026-11-18'))).toMatchObject({ title: 'Mist', date: '2026-11-21', series_id: 'daily', occurrence_date: '2026-11-18' });
    expect(dayView(after, '2026-11-21', MON_10_15).anytime.items[0]).toMatchObject({ title: 'Mist', recurring: true });
    expect(dayView(after, '2026-11-18', MON_10_15).anytime.items).toEqual([]);
  });

  it('an edited Occurrence keeps its ↻ marker', () => {
    const after = run(dailyTask(), { type: 'renameTask', id: idOn('daily', '2026-11-18'), title: 'Mist', scope: 'one' });

    expect(dayView(after, '2026-11-18', MON_10_15).anytime.items[0]).toMatchObject({ title: 'Mist', recurring: true, recurrence: 'daily' });
  });

  it('moving an Event Occurrence takes its placed items along, which stay placed', () => {
    const state = applyChanges(dailyEvent(), {
      inserts: [{ table: 'tasks', row: aTask({ id: 'bag', date: '2026-11-18', event_id: gym('2026-11-18') }) }],
      updates: [],
      deletes: [],
    });

    const after = run(state, { type: 'moveEvent', id: gym('2026-11-18'), date: '2026-11-22' });

    expect(after.tasks.find((t) => t.id === 'bag')).toMatchObject({ date: '2026-11-22', event_id: gym('2026-11-18') });
    expect(after.events.find((e) => e.id === gym('2026-11-18'))).toMatchObject({ date: '2026-11-22', series_id: 'gym', occurrence_date: '2026-11-18' });
    expect(run(after, { type: 'materialise', dates: ['2026-11-18'] }).events).toHaveLength(5);
    const view = dayView(after, '2026-11-22', MON_10_15);
    expect(view.later.events[0]).toMatchObject({ recurrence: 'daily', placedTotal: 1 });
  });
});

describe('Removed Occurrences are soft-deleted, never hard-deleted', () => {
  // a stale device can only be stopped from making a row again under its deterministic id if the row still exists
  const staleSeries = (after: State, before: State): State => ({ ...after, series: before.series });
  const withSubtasks = () => dailyTask({ template: { title: 'Clean', subtasks: [{ key: 'k', title: 'Hoover' }] } });

  it('Stop repeating marks the later Occurrences and their Sub-tasks deleted and removes no row', () => {
    const state = withSubtasks();
    const changes = apply(state, { type: 'stopRepeating', id: idOn('daily', '2026-11-18') }, MON_10_15);
    const after = applyChanges(state, changes);

    expect(changes.deletes).toEqual([]);
    for (const d of ['2026-11-19', '2026-11-20']) {
      expect(after.tasks.find((t) => t.id === idOn('daily', d))?.deleted_at, d).toBe(MON_10_15);
      expect(after.tasks.find((t) => t.parent_id === idOn('daily', d))?.deleted_at, d).toBe(MON_10_15);
    }
    expect(after.tasks.find((t) => t.id === idOn('daily', '2026-11-18'))?.deleted_at).toBeNull();
  });

  it('"This and following" on a Task marks this and later Occurrences deleted and removes no row', () => {
    const state = withSubtasks();
    const changes = apply(state, { type: 'deleteTask', id: idOn('daily', '2026-11-18'), scope: 'following' }, MON_10_15);
    const after = applyChanges(state, changes);

    expect(changes.deletes).toEqual([]);
    expect(after.tasks.filter((t) => t.deleted_at).map((t) => t.id).sort()).toHaveLength(6); // 3 Occurrences and their 3 Sub-tasks
    expect(after.tasks).toHaveLength(state.tasks.length);
  });

  it('"This and following" on an Event marks this and later Occurrences deleted and removes no row', () => {
    const state = dailyEvent();
    const changes = apply(state, { type: 'deleteEvent', id: gym('2026-11-18'), scope: 'following' }, MON_10_15);
    const after = applyChanges(state, changes);

    expect(changes.deletes).toEqual([]);
    expect(after.events.filter((e) => e.deleted_at).map((e) => e.id).sort()).toEqual([gym('2026-11-18'), gym('2026-11-19'), gym('2026-11-20')].sort());
  });

  it('a device that has not seen the series end cannot make a removed Occurrence again', () => {
    const state = withSubtasks();
    for (const cmd of [
      { type: 'stopRepeating', id: idOn('daily', '2026-11-18') },
      { type: 'deleteTask', id: idOn('daily', '2026-11-18'), scope: 'following' },
    ] as const) {
      const after = run(state, cmd);

      const stale = run(staleSeries(after, state), { type: 'materialise', dates: ['2026-11-18', '2026-11-19', '2026-11-20'] });

      expect(stale.tasks.length, cmd.type).toBe(after.tasks.length);
    }
  });

  it('a removed Event Occurrence cannot be made again by a stale device either, and its items are unplaced', () => {
    const state = applyChanges(dailyEvent(), {
      inserts: [{ table: 'tasks', row: aTask({ id: 'a', date: '2026-11-19', event_id: gym('2026-11-19') }) }],
      updates: [],
      deletes: [],
    });
    const after = run(state, { type: 'stopRepeating', id: gym('2026-11-17') });

    const stale = run(staleSeries(after, state), { type: 'materialise', dates: ['2026-11-19'] });

    expect(stale.events).toHaveLength(after.events.length);
    expect(after.tasks.find((t) => t.id === 'a')).toMatchObject({ event_id: null, date: '2026-11-19' });
  });
});
