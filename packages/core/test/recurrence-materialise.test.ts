import { describe, expect, it } from 'vitest';
import { apply, applyChanges, dayView, occurrenceId, occurrenceSubtaskId, type Command, type State } from '../src/index.ts';
import { MON_10_15, TODAY, aSeries, aState, aTask, anEvent } from './helpers.ts';

const run = (state: State, command: Command, now = MON_10_15) => applyChanges(state, apply(state, command, now));
const materialise = (state: State, ...dates: string[]) => run(state, { type: 'materialise', dates });

const daily = aSeries({ id: 'daily', template: JSON.stringify({ title: 'Water plants', subtasks: [] }) });

describe('materialising Occurrences for the days the UI asks about', () => {
  it('makes a real Task for a day the series falls on, with the id fixed by series and day', () => {
    const after = materialise(aState({ series: [daily] }), '2026-11-18');

    expect(after.tasks).toHaveLength(1);
    expect(after.tasks[0]).toMatchObject({
      id: occurrenceId('daily', '2026-11-18'),
      title: 'Water plants',
      date: '2026-11-18',
      event_id: null,
      completed_at: null,
      series_id: 'daily',
      occurrence_date: '2026-11-18',
      deleted_at: null,
    });
  });

  it('makes nothing for a day the series does not fall on, nor outside its start and end', () => {
    const mondays = aSeries({ id: 'mon', rule: 'weekdays', weekdays: '[1]', anchor_date: '2026-11-16', starts_on: '2026-11-16', ends_on: '2026-11-30' });
    const state = aState({ series: [mondays] });

    expect(materialise(state, '2026-11-17').tasks).toEqual([]);
    expect(materialise(state, '2026-11-09').tasks).toEqual([]);
    expect(materialise(state, '2026-12-07').tasks).toEqual([]);
    expect(materialise(state, '2026-11-23').tasks).toHaveLength(1);
  });

  it('works for any date asked, however far ahead (a day picked in Upcoming)', () => {
    const after = materialise(aState({ series: [daily] }), '2027-03-01');

    expect(after.tasks.map((t) => t.date)).toEqual(['2027-03-01']);
  });

  it('is idempotent: asking again for the same day changes nothing', () => {
    const once = materialise(aState({ series: [daily] }), '2026-11-18');

    expect(apply(once, { type: 'materialise', dates: ['2026-11-18'] }, MON_10_15)).toEqual({ inserts: [], updates: [], deletes: [] });
  });

  it('makes the same row on two devices that each materialise the day from their own state', () => {
    const phone = materialise(aState({ series: [daily] }), '2026-11-18');
    const desktop = materialise(aState({ series: [daily] }), '2026-11-18');

    expect(phone.tasks.map((t) => t.id)).toEqual(desktop.tasks.map((t) => t.id));
    expect(phone.tasks[0]!.id).toBe(occurrenceId('daily', '2026-11-18'));
  });

  it('does not bring back a deleted Occurrence', () => {
    const deleted = aTask({ id: occurrenceId('daily', '2026-11-18'), series_id: 'daily', occurrence_date: '2026-11-18', date: '2026-11-18', deleted_at: MON_10_15 });

    expect(apply(aState({ series: [daily], tasks: [deleted] }), { type: 'materialise', dates: ['2026-11-18'] }, MON_10_15).inserts).toEqual([]);
  });

  it('does not add a duplicate on the original day of an Occurrence that was moved', () => {
    const moved = aTask({ id: 'moved', series_id: 'daily', occurrence_date: '2026-11-18', date: '2026-11-20' });

    expect(apply(aState({ series: [daily], tasks: [moved] }), { type: 'materialise', dates: ['2026-11-18'] }, MON_10_15).inserts).toEqual([]);
  });

  it('follows the calendar, not completion: ticking late shifts nothing', () => {
    const everyThree = aSeries({ id: 'three', interval_n: 3, anchor_date: TODAY, starts_on: TODAY });
    const state = aState({ series: [everyThree] });
    const first = materialise(state, TODAY);
    // ticked two days late, on the 18th
    const late = run(first, { type: 'tickTask', id: occurrenceId('three', TODAY) }, '2026-11-18T09:00:00+01:00');

    const later = materialise(late, '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20', '2026-11-22');

    expect(later.tasks.map((t) => t.date).sort()).toEqual(['2026-11-16', '2026-11-19', '2026-11-22']);
  });

  it('makes an Event Occurrence with the series times and nothing placed in it', () => {
    const standup = aSeries({
      id: 'standup',
      kind: 'event',
      template: JSON.stringify({ title: 'Stand-up', start: '09:30', end: '09:45' }),
    });
    const after = materialise(aState({ series: [standup] }), '2026-11-17');

    expect(after.events).toEqual([
      expect.objectContaining({
        id: occurrenceId('standup', '2026-11-17'),
        title: 'Stand-up',
        date: '2026-11-17',
        start_time: '09:30',
        end_time: '09:45',
        series_id: 'standup',
        occurrence_date: '2026-11-17',
      }),
    ]);
    expect(after.tasks).toEqual([]);
    expect(dayView(after, '2026-11-17', MON_10_15).later.events[0]).toMatchObject({ title: 'Stand-up', tasks: [], placedTotal: 0 });
  });

  it("brings the series' Sub-tasks with a Task Occurrence, all unticked, with ids fixed by Occurrence and key", () => {
    const chores = aSeries({
      id: 'chores',
      template: JSON.stringify({ title: 'Clean flat', subtasks: [{ key: 'k1', title: 'Hoover' }, { key: 'k2', title: 'Bins' }] }),
    });
    const after = materialise(aState({ series: [chores] }), '2026-11-17');

    const parentId = occurrenceId('chores', '2026-11-17');
    const subs = after.tasks.filter((t) => t.parent_id === parentId);
    expect(subs.map((s) => [s.id, s.title, s.series_subtask_key, s.completed_at])).toEqual([
      [occurrenceSubtaskId(parentId, 'k1'), 'Hoover', 'k1', null],
      [occurrenceSubtaskId(parentId, 'k2'), 'Bins', 'k2', null],
    ]);
    // they follow the parent's day, unplaced
    expect(dayView(after, '2026-11-17', MON_10_15).anytime.items.map((i) => i.title)).toEqual(['Hoover', 'Bins']);
  });

  it('brings Sub-tasks unticked even when last time\'s were ticked', () => {
    const chores = aSeries({ id: 'chores', template: JSON.stringify({ title: 'Clean flat', subtasks: [{ key: 'k1', title: 'Hoover' }] }) });
    const first = materialise(aState({ series: [chores] }), '2026-11-16');
    const ticked = run(first, { type: 'tickTask', id: occurrenceId('chores', '2026-11-16') });

    const next = materialise(ticked, '2026-11-17');

    expect(next.tasks.filter((t) => t.date === '2026-11-17' || t.parent_id === occurrenceId('chores', '2026-11-17')).every((t) => !t.completed_at)).toBe(true);
    expect(ticked.tasks.find((t) => t.series_subtask_key === 'k1' && t.parent_id === occurrenceId('chores', '2026-11-16'))?.completed_at).not.toBeNull();
  });
});

describe('an Occurrence is a real item', () => {
  const base = () =>
    materialise(
      aState({
        series: [daily, aSeries({ id: 'standup', kind: 'event', template: JSON.stringify({ title: 'Stand-up', start: '09:30', end: '09:45' }) })],
      }),
      '2026-11-16',
      '2026-11-17',
    );
  const mon = occurrenceId('daily', '2026-11-16');
  const tue = occurrenceId('daily', '2026-11-17');
  const standupTue = occurrenceId('standup', '2026-11-17');

  it('ticking one Occurrence leaves the others open', () => {
    const after = run(base(), { type: 'tickTask', id: tue });

    expect(after.tasks.find((t) => t.id === tue)?.completed_at).toBe(MON_10_15);
    expect(after.tasks.find((t) => t.id === mon)?.completed_at).toBeNull();
  });

  it('placing one Occurrence in an Event affects only that Occurrence', () => {
    const state = applyChanges(base(), { inserts: [{ table: 'events', row: anEvent({ id: 'work', date: '2026-11-17' }) }], updates: [], deletes: [] });
    const after = run(state, { type: 'placeTask', id: tue, eventId: 'work' });

    expect(after.tasks.find((t) => t.id === tue)).toMatchObject({ event_id: 'work', date: '2026-11-17' });
    expect(after.tasks.find((t) => t.id === mon)?.event_id).toBeNull();
  });

  it('dragging one to another day moves only that one, and it stays linked to its series and original day', () => {
    const after = run(base(), { type: 'dateTask', id: tue, date: '2026-11-19' });

    expect(after.tasks.find((t) => t.id === tue)).toMatchObject({ date: '2026-11-19', series_id: 'daily', occurrence_date: '2026-11-17' });
    expect(after.tasks.find((t) => t.id === mon)?.date).toBe('2026-11-16');
  });

  it('moving an Event Occurrence takes its placed Tasks along and keeps its link', () => {
    const withTask = applyChanges(base(), { inserts: [{ table: 'tasks', row: aTask({ id: 'prep', date: '2026-11-17', event_id: standupTue }) }], updates: [], deletes: [] });
    const after = run(withTask, { type: 'moveEvent', id: standupTue, date: '2026-11-18' });

    expect(after.events.find((e) => e.id === standupTue)).toMatchObject({ date: '2026-11-18', series_id: 'standup', occurrence_date: '2026-11-17' });
    expect(after.tasks.find((t) => t.id === 'prep')).toMatchObject({ date: '2026-11-18', event_id: standupTue });
  });

  it('deleting an Occurrence keeps the row, marked deleted, so no device makes it again', () => {
    const after = run(base(), { type: 'deleteTask', id: tue });

    expect(after.tasks.find((t) => t.id === tue)?.deleted_at).toBe(MON_10_15);
    expect(dayView(after, '2026-11-17', MON_10_15).anytime.items).toEqual([]);
    expect(apply(after, { type: 'materialise', dates: ['2026-11-17'] }, MON_10_15).inserts).toEqual([]);
  });

  it('deleting an Event Occurrence marks it deleted and leaves its items unplaced on that day', () => {
    const withTask = applyChanges(base(), { inserts: [{ table: 'tasks', row: aTask({ id: 'prep', date: '2026-11-17', event_id: standupTue }) }], updates: [], deletes: [] });
    const after = run(withTask, { type: 'deleteEvent', id: standupTue });

    expect(after.events.find((e) => e.id === standupTue)?.deleted_at).toBe(MON_10_15);
    expect(after.tasks.find((t) => t.id === 'prep')).toMatchObject({ event_id: null, date: '2026-11-17' });
    expect(apply(after, { type: 'materialise', dates: ['2026-11-17'] }, MON_10_15).inserts).toEqual([]);
  });

  it('deleting a Task Occurrence marks its Sub-tasks deleted too', () => {
    const chores = aSeries({ id: 'chores', template: JSON.stringify({ title: 'Clean flat', subtasks: [{ key: 'k1', title: 'Hoover' }] }) });
    const state = materialise(aState({ series: [chores] }), '2026-11-17');
    const after = run(state, { type: 'deleteTask', id: occurrenceId('chores', '2026-11-17') });

    expect(after.tasks.every((t) => t.deleted_at === MON_10_15)).toBe(true);
    expect(apply(after, { type: 'materialise', dates: ['2026-11-17'] }, MON_10_15).inserts).toEqual([]);
  });

  it('a one-off Task is still hard-deleted', () => {
    const state = aState({ tasks: [aTask({ id: 'one' })] });

    expect(apply(state, { type: 'deleteTask', id: 'one' }, MON_10_15).deletes).toEqual([{ table: 'tasks', id: 'one' }]);
  });
});
