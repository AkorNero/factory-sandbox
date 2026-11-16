import { describe, expect, it } from 'vitest';
import { apply, applyChanges, asksScope, canEditSchedule, dayView, type RecurrenceRule, type State } from '../src/index.ts';
import { MON_10_15, aTask, anEvent } from './helpers.ts';
import { NOTHING, dailyEvent, dailyTask, idOn, lineageOf, run, taskTitles } from './series-fixtures.ts';

const weekdaysMonWed: RecurrenceRule = { rule: 'weekdays', weekdays: [1, 3] };
const dates = (state: State) => state.tasks.filter((t) => !t.parent_id && !t.deleted_at).map((t) => t.date).sort();

describe('Change schedule on a Task Occurrence', () => {
  it('removes every later Occurrence, hand-edited ones too, and rebuilds them on the new rule', () => {
    let state = dailyTask();
    state = run(state, { type: 'renameTask', id: idOn('daily', '2026-11-19'), title: 'Hand edited', scope: 'one' });
    state = run(state, { type: 'dateTask', id: idOn('daily', '2026-11-20'), date: '2026-11-22' });

    const after = run(state, { type: 'changeSchedule', id: idOn('daily', '2026-11-17'), seriesId: 'mw', recurrence: weekdaysMonWed });
    const rebuilt = run(after, { type: 'materialise', dates: ['2026-11-18', '2026-11-19', '2026-11-20', '2026-11-22', '2026-11-23', '2026-11-25'] });

    // Mon 16th is earlier and stays; the opened Tue 17th moves to the first match, Wed 18th; later ones follow Mon/Wed
    expect(dates(rebuilt)).toEqual(['2026-11-16', '2026-11-18', '2026-11-23', '2026-11-25']);
    expect(taskTitles(rebuilt)['2026-11-19']).toBeUndefined();
  });

  it('keeps the opened Occurrence, moved to the first matching day, unplaced, and linked to the new segment', () => {
    const state = applyChanges(dailyTask(), {
      inserts: [{ table: 'events', row: anEvent({ id: 'work', date: '2026-11-17' }) }],
      updates: [{ table: 'tasks', id: idOn('daily', '2026-11-17'), set: { event_id: 'work' } }],
      deletes: [],
    });

    const after = run(state, { type: 'changeSchedule', id: idOn('daily', '2026-11-17'), seriesId: 'mw', recurrence: weekdaysMonWed });

    expect(after.tasks.find((t) => t.id === idOn('daily', '2026-11-17'))).toMatchObject({
      date: '2026-11-18',
      event_id: null,
      series_id: 'mw',
      occurrence_date: '2026-11-18',
    });
  });

  it('leaves the opened Occurrence where it is when the new rule falls on its day', () => {
    const after = run(dailyTask(), { type: 'changeSchedule', id: idOn('daily', '2026-11-18'), seriesId: 'mw', recurrence: weekdaysMonWed });

    expect(after.tasks.find((t) => t.id === idOn('daily', '2026-11-18'))).toMatchObject({ date: '2026-11-18', series_id: 'mw', occurrence_date: '2026-11-18' });
  });

  it('ends the old segment the day before and starts a new one in the same lineage, with the same template', () => {
    const state = run(dailyTask(), { type: 'renameTask', id: idOn('daily', '2026-11-17'), title: 'Mist plants', scope: 'following' });

    const after = run(state, { type: 'changeSchedule', id: idOn('daily', '2026-11-18'), seriesId: 'mw', recurrence: weekdaysMonWed });

    const rows = lineageOf(after, 'daily').map((s) => [s.id === 'daily' ? 'daily' : s.id === 'mw' ? 'mw' : 'split', s.starts_on, s.ends_on, s.rule]);
    expect(rows).toEqual([
      ['daily', '2026-11-16', '2026-11-16', 'every_n_days'],
      ['split', '2026-11-17', '2026-11-17', 'every_n_days'],
      ['mw', '2026-11-18', null, 'weekdays'],
    ]);
    const mw = after.series.find((s) => s.id === 'mw')!;
    expect(mw).toMatchObject({ lineage_id: 'daily', kind: 'task', weekdays: '[1,3]', interval_n: 1, anchor_date: '2026-11-18' });
    expect(JSON.parse(mw.template).title).toBe('Mist plants');
  });

  it('never changes Occurrences that are done or Skipped, or on earlier days', () => {
    let state = dailyTask();
    state = run(state, { type: 'tickTask', id: idOn('daily', '2026-11-19') });
    state = { ...state, tasks: state.tasks.map((t) => (t.id === idOn('daily', '2026-11-20') ? { ...t, skipped_at: '2026-11-21T00:00:00+01:00' } : t)) };
    const before = structuredClone(state.tasks);

    const after = run(state, { type: 'changeSchedule', id: idOn('daily', '2026-11-17'), seriesId: 'mw', recurrence: weekdaysMonWed });

    for (const d of ['2026-11-16', '2026-11-19', '2026-11-20']) {
      expect(after.tasks.find((t) => t.id === idOn('daily', d))).toEqual(before.find((t) => t.id === idOn('daily', d)));
    }
  });

  it('removes the Sub-tasks of the removed Occurrences with them', () => {
    const state = dailyTask({ template: { title: 'Clean', subtasks: [{ key: 'k', title: 'Hoover' }] } });

    const after = run(state, { type: 'changeSchedule', id: idOn('daily', '2026-11-17'), seriesId: 'mw', recurrence: weekdaysMonWed });

    expect(after.tasks.filter((t) => t.parent_id).map((t) => t.parent_id).sort()).toEqual([idOn('daily', '2026-11-16'), idOn('daily', '2026-11-17')].sort());
  });

  it('refuses a bad rule, a taken id, a Sub-task, and an Occurrence that is done or not repeating', () => {
    let state = run(dailyTask(), { type: 'tickTask', id: idOn('daily', '2026-11-19') });
    state = applyChanges(state, { inserts: [{ table: 'tasks', row: aTask({ id: 'one' }) }], updates: [], deletes: [] });
    const go = (id: string, seriesId = 'mw', recurrence: RecurrenceRule = weekdaysMonWed) =>
      apply(state, { type: 'changeSchedule', id, seriesId, recurrence }, MON_10_15);

    expect(go(idOn('daily', '2026-11-18'), 'mw', { rule: 'weekdays', weekdays: [] })).toEqual(NOTHING);
    expect(go(idOn('daily', '2026-11-18'), 'daily')).toEqual(NOTHING);
    expect(go(idOn('daily', '2026-11-19'))).toEqual(NOTHING);
    expect(go('one')).toEqual(NOTHING);
    expect(go('nope')).toEqual(NOTHING);
  });

  it('is offered on an open Occurrence that has not passed, not on a one-off or a done one', () => {
    let state = run(dailyTask(), { type: 'tickTask', id: idOn('daily', '2026-11-19') });
    state = applyChanges(state, { inserts: [{ table: 'tasks', row: aTask({ id: 'one' }) }], updates: [], deletes: [] });

    expect(canEditSchedule(state, idOn('daily', '2026-11-18'), MON_10_15)).toBe(true);
    expect([idOn('daily', '2026-11-19'), 'one', 'nope'].map((id) => canEditSchedule(state, id, MON_10_15))).toEqual([false, false, false]);
    expect(asksScope(state, idOn('daily', '2026-11-18'))).toBe(true);
    expect(asksScope(state, 'one')).toBe(false);
  });
});

describe('Change schedule on an Event Occurrence', () => {
  const gym = (d: string) => idOn('gym', d);
  const withPlacements = () =>
    applyChanges(dailyEvent(), {
      inserts: [
        { table: 'tasks', row: aTask({ id: 'bag', date: '2026-11-18', event_id: gym('2026-11-18') }) },
        { table: 'tasks', row: aTask({ id: 'towel', date: '2026-11-19', event_id: gym('2026-11-19') }) },
        { table: 'tasks', row: aTask({ id: 'kept', date: '2026-11-17', event_id: gym('2026-11-17') }) },
      ],
      updates: [],
      deletes: [],
    });

  it('unplaces the items of removed Event Occurrences, keeping their day, and rebuilds the Events', () => {
    const after = run(withPlacements(), { type: 'changeSchedule', id: gym('2026-11-17'), seriesId: 'mw', recurrence: weekdaysMonWed });

    expect(after.tasks.find((t) => t.id === 'bag')).toMatchObject({ event_id: null, date: '2026-11-18' });
    expect(after.tasks.find((t) => t.id === 'towel')).toMatchObject({ event_id: null, date: '2026-11-19' });
    expect(dayView(after, '2026-11-19', MON_10_15).anytime.items.map((i) => i.title)).toEqual(['A task']);
    expect(after.events.map((e) => e.date).sort()).toEqual(['2026-11-16', '2026-11-18']);
  });

  it('keeps the opened Event with its placed items, moving it (and them) to the first matching day', () => {
    const after = run(withPlacements(), { type: 'changeSchedule', id: gym('2026-11-17'), seriesId: 'mw', recurrence: weekdaysMonWed });

    expect(after.events.find((e) => e.id === gym('2026-11-17'))).toMatchObject({ date: '2026-11-18', series_id: 'mw', occurrence_date: '2026-11-18' });
    expect(after.tasks.find((t) => t.id === 'kept')).toMatchObject({ event_id: gym('2026-11-17'), date: '2026-11-18' });
  });

  it('rebuilds with the Event times of the series, nothing placed', () => {
    const after = run(withPlacements(), { type: 'changeSchedule', id: gym('2026-11-18'), seriesId: 'mw', recurrence: weekdaysMonWed });
    const rebuilt = run(after, { type: 'materialise', dates: ['2026-11-23'] });

    expect(rebuilt.events.find((e) => e.date === '2026-11-23')).toMatchObject({ title: 'Gym', start_time: '18:00', end_time: '19:00' });
    expect(rebuilt.tasks.filter((t) => t.event_id === rebuilt.events.find((e) => e.date === '2026-11-23')!.id)).toEqual([]);
  });

  it('keeps hand-moved later Events from surviving: they are rebuilt too', () => {
    const state = run(dailyEvent(), { type: 'moveEvent', id: gym('2026-11-19'), date: '2026-11-21' });

    const after = run(state, { type: 'changeSchedule', id: gym('2026-11-17'), seriesId: 'mw', recurrence: weekdaysMonWed });

    expect(after.events.map((e) => e.date).sort()).toEqual(['2026-11-16', '2026-11-18']);
  });
});
