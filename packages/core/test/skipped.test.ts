import { describe, expect, it } from 'vitest';
import { apply, applyChanges, dayView, occurrenceId, type State } from '../src/index.ts';
import { aSeries, aState, aTask } from './helpers.ts';

const MON = '2026-11-16';
const TUE = '2026-11-17';
const TUE_00_00 = '2026-11-17T00:00:00+01:00';

const midnight = (state: State, now = TUE_00_00) => applyChanges(state, apply(state, { type: 'runMidnight' }, now));
const materialise = (state: State, now: string, ...dates: string[]) => applyChanges(state, apply(state, { type: 'materialise', dates }, now));
const task = (state: State, id: string) => state.tasks.find((t) => t.id === id)!;

const daily = aSeries({ id: 'daily', anchor_date: MON, starts_on: MON, template: JSON.stringify({ title: 'Water plants', subtasks: [] }) });
const dailyMonday = () => aTask({ id: occurrenceId('daily', MON), title: 'Water plants', date: MON, series_id: 'daily', occurrence_date: MON });

describe("Skipped: yesterday's unfinished daily Occurrence when today's arrives", () => {
  it("is Skipped, not carried over, and today's Occurrence is the only open one", () => {
    const state = midnight(aState({ series: [daily], tasks: [dailyMonday()] }));
    const withToday = materialise(state, TUE_00_00, TUE);

    expect(task(withToday, occurrenceId('daily', MON))).toMatchObject({ skipped_at: TUE_00_00, date: MON, carried_over: false });
    expect(task(withToday, occurrenceId('daily', TUE))).toMatchObject({ date: TUE, skipped_at: null, completed_at: null });
    expect(dayView(withToday, TUE, TUE_00_00).anytime.items.map((i) => [i.title, i.carriedOver])).toEqual([['Water plants', false]]);
  });
});

describe('a weekly Occurrence left unfinished', () => {
  // Mondays; the Occurrence of Monday 9 November was never finished
  const weekly = aSeries({ id: 'weekly', rule: 'weekdays', weekdays: '[1]', anchor_date: '2026-11-09', starts_on: '2026-11-09', template: JSON.stringify({ title: 'Clean oven', subtasks: [] }) });
  const mondayNine = () => aTask({ id: occurrenceId('weekly', '2026-11-09'), title: 'Clean oven', date: '2026-11-09', series_id: 'weekly', occurrence_date: '2026-11-09' });
  const at = (date: string) => `${date}T00:00:00+01:00`;

  it('carries over day by day until the next one arrives', () => {
    let state = aState({ series: [weekly], tasks: [mondayNine()] });
    for (const day of ['2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15']) {
      state = midnight(state, at(day));
      expect(task(state, occurrenceId('weekly', '2026-11-09'))).toMatchObject({ date: day, carried_over: true, skipped_at: null });
    }
  });

  it('closes as Skipped on the day the next one arrives, and is not carried over onto that day', () => {
    let state = aState({ series: [weekly], tasks: [mondayNine()] });
    for (const day of ['2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15']) state = midnight(state, at(day));

    state = midnight(state, at('2026-11-16'));

    expect(task(state, occurrenceId('weekly', '2026-11-09'))).toMatchObject({ date: '2026-11-15', skipped_at: at('2026-11-16') });
    expect(dayView(state, '2026-11-16', at('2026-11-16')).anytime.items).toEqual([]);
  });

  it('is Skipped by one midnight after the app was closed over several, and today gets the new Occurrence', () => {
    const state = materialise(midnight(aState({ series: [weekly], tasks: [mondayNine()] }), at('2026-11-18')), at('2026-11-18'), '2026-11-16', '2026-11-18');

    expect(task(state, occurrenceId('weekly', '2026-11-09'))).toMatchObject({ date: '2026-11-09', skipped_at: at('2026-11-18') });
    expect(state.tasks.filter((t) => !t.skipped_at).map((t) => t.date)).toEqual(['2026-11-16']);
  });

  it('never leaves a Task with two open Occurrences that have arrived', () => {
    let state = aState({ series: [weekly], tasks: [mondayNine()] });
    for (const day of ['2026-11-10', '2026-11-16', '2026-11-17']) {
      state = materialise(midnight(state, at(day)), at(day), day);
      const open = state.tasks.filter((t) => t.series_id === 'weekly' && !t.completed_at && !t.skipped_at && t.date! <= day);
      expect(open).toHaveLength(1);
    }
  });
});

describe('an Occurrence that is finished', () => {
  it('is never Skipped', () => {
    const doneMonday = { ...dailyMonday(), completed_at: '2026-11-16T09:00:00+01:00' };

    expect(task(midnight(aState({ series: [daily], tasks: [doneMonday] })), doneMonday.id).skipped_at).toBeNull();
  });

  it('stays as it is when it was deleted, so a deleted Occurrence leaves no record', () => {
    const deleted = { ...dailyMonday(), deleted_at: '2026-11-16T12:00:00+01:00' };

    expect(apply(aState({ series: [daily], tasks: [deleted] }), { type: 'runMidnight' }, TUE_00_00)).toEqual({ inserts: [], updates: [], deletes: [] });
  });

  it('is left alone when the next Occurrence has not arrived yet', () => {
    const state = midnight(aState({ series: [daily], tasks: [dailyMonday()] }), '2026-11-16T00:00:00+01:00');

    expect(task(state, dailyMonday().id)).toMatchObject({ skipped_at: null });
  });
});

describe('Skipped Sub-tasks', () => {
  const chores = aSeries({
    id: 'chores',
    anchor_date: MON,
    starts_on: MON,
    template: JSON.stringify({ title: 'Clean flat', subtasks: [{ key: 'k1', title: 'Hoover' }, { key: 'k2', title: 'Bins' }] }),
  });
  const parent = occurrenceId('chores', MON);
  const monday = () => {
    const first = materialise(aState({ series: [chores] }), '2026-11-15T09:00:00+01:00', MON);
    return applyChanges(first, apply(first, { type: 'tickTask', id: first.tasks.find((t) => t.series_subtask_key === 'k1')!.id }, '2026-11-16T09:40:00+01:00'));
  };
  const sub = (state: State, key: string, day = MON) => state.tasks.find((t) => t.parent_id === occurrenceId('chores', day) && t.series_subtask_key === key)!;

  it('Skips the unfinished ones with their Occurrence; the finished one keeps its Completion time', () => {
    const state = midnight(monday());

    expect(task(state, parent)).toMatchObject({ skipped_at: TUE_00_00 });
    expect(sub(state, 'k2')).toMatchObject({ skipped_at: TUE_00_00, completed_at: null });
    expect(sub(state, 'k1')).toMatchObject({ skipped_at: null, completed_at: '2026-11-16T09:40:00+01:00' });
  });

  it("starts the new Occurrence's Sub-tasks unticked", () => {
    const state = materialise(midnight(monday()), TUE_00_00, TUE);

    expect([sub(state, 'k1', TUE), sub(state, 'k2', TUE)].map((s) => [s.completed_at, s.skipped_at])).toEqual([[null, null], [null, null]]);
  });

  it("is not carried over: only the new Occurrence's Sub-tasks are in Anytime today", () => {
    const state = materialise(midnight(monday()), TUE_00_00, TUE);
    const view = dayView(state, TUE, TUE_00_00);

    expect(view.anytime.items.map((i) => [i.title, i.carriedOver])).toEqual([['Hoover', false], ['Bins', false]]);
  });

  it("keeps the done Sub-task in Monday's Done list", () => {
    const state = midnight(monday());

    expect(dayView(state, MON, TUE_00_00).done.items.map((i) => i.title)).toEqual(['Hoover']);
  });

  it('is not Skipped at all when every Sub-task was ticked', () => {
    const all = applyChanges(monday(), apply(monday(), { type: 'tickTask', id: parent }, '2026-11-16T10:00:00+01:00'));

    expect(midnight(all).tasks.every((t) => !t.skipped_at)).toBe(true);
  });
});

describe('Skipped is a midnight step that every device runs the same way', () => {
  it('runs before Carry-over: an unfinished Occurrence is not carried over and a plain Task still is', () => {
    const state = aState({ series: [daily], tasks: [dailyMonday(), aTask({ id: 'plain', title: 'Buy stamps', date: MON })] });

    const after = midnight(state);

    expect(task(after, dailyMonday().id)).toMatchObject({ skipped_at: TUE_00_00, carried_over: false, carried_on: null, date: MON });
    expect(task(after, 'plain')).toMatchObject({ date: TUE, carried_over: true });
  });

  it('writes identical rows on two devices whatever the time of day they run it at', () => {
    const state = aState({ series: [daily], tasks: [dailyMonday(), aTask({ id: 'plain', date: MON })] });

    const phone = apply(state, { type: 'runMidnight' }, '2026-11-17T00:00:03+01:00');
    const desktop = apply(state, { type: 'runMidnight' }, '2026-11-17T07:45:00+01:00');

    expect(phone).toEqual(desktop);
  });

  it('changes nothing when run again', () => {
    const once = midnight(aState({ series: [daily], tasks: [dailyMonday()] }));

    expect(apply(once, { type: 'runMidnight' }, TUE_00_00)).toEqual({ inserts: [], updates: [], deletes: [] });
  });
});

describe('Skipped Occurrences are kept as a record', () => {
  it('stay as rows, off Anytime and the strip counts, and listed in the overnight banner', () => {
    const state = midnight(aState({ series: [daily], tasks: [dailyMonday()] }));
    const view = dayView(state, TUE, TUE_00_00);

    expect(state.tasks).toHaveLength(1);
    expect(state.tasks[0]!.deleted_at).toBeNull();
    expect(view.overnight.skipped.map((i) => i.title)).toEqual(['Water plants']);
    expect(view.overnight.carried).toEqual([]);
    expect(view.anytime.count).toBe(0);
    expect(view.strip[0]).toMatchObject({ date: TUE, tasks: 0 });
  });

  it('lists a Skipped Sub-task as "Parent › Sub-task" in the banner', () => {
    const series = aSeries({ id: 'chores', anchor_date: MON, starts_on: MON, template: JSON.stringify({ title: 'Clean flat', subtasks: [{ key: 'k1', title: 'Hoover' }] }) });
    const state = midnight(materialise(aState({ series: [series] }), '2026-11-15T09:00:00+01:00', MON));

    expect(dayView(state, TUE, TUE_00_00).overnight.skipped.map((i) => [i.title, i.parentTitle])).toEqual([['Hoover', 'Clean flat']]);
  });
});
