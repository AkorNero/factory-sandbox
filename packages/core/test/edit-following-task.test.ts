import { describe, expect, it } from 'vitest';
import { apply, dayView, splitSeriesId } from '../src/index.ts';
import { MON_10_15 } from './helpers.ts';
import { DAYS, NOTHING, dailyTask, handMoved, idOn, lineageOf, run, taskTitles } from './series-fixtures.ts';

describe('Rename an Occurrence of a Task', () => {
  it('"Just this one" changes only that Occurrence and it stays linked', () => {
    const after = run(dailyTask(), { type: 'renameTask', id: idOn('daily', '2026-11-18'), title: 'Water the ferns', scope: 'one' });

    expect(taskTitles(after)).toEqual({
      '2026-11-16': 'Water plants',
      '2026-11-17': 'Water plants',
      '2026-11-18': 'Water the ferns',
      '2026-11-19': 'Water plants',
      '2026-11-20': 'Water plants',
    });
    expect(after.tasks.find((t) => t.id === idOn('daily', '2026-11-18'))).toMatchObject({ series_id: 'daily', occurrence_date: '2026-11-18' });
    expect(after.series).toHaveLength(1);
  });

  it('"This and following" changes this Occurrence and every later one, not the earlier ones', () => {
    const after = run(dailyTask(), { type: 'renameTask', id: idOn('daily', '2026-11-18'), title: 'Water the ferns', scope: 'following' });

    expect(taskTitles(after)).toEqual({
      '2026-11-16': 'Water plants',
      '2026-11-17': 'Water plants',
      '2026-11-18': 'Water the ferns',
      '2026-11-19': 'Water the ferns',
      '2026-11-20': 'Water the ferns',
    });
  });

  it('splits the series at that day: the old segment ends the day before, the new one starts there, in the same lineage', () => {
    const after = run(dailyTask(), { type: 'renameTask', id: idOn('daily', '2026-11-18'), title: 'Water the ferns', scope: 'following' });

    const [old, split] = lineageOf(after, 'daily');
    expect(after.series).toHaveLength(2);
    expect(old).toMatchObject({ id: 'daily', starts_on: '2026-11-16', ends_on: '2026-11-17' });
    expect(split).toMatchObject({ lineage_id: 'daily', kind: 'task', rule: 'every_n_days', interval_n: 1, anchor_date: '2026-11-16', starts_on: '2026-11-18', ends_on: null });
    expect(JSON.parse(split!.template).title).toBe('Water the ferns');
    expect(JSON.parse(old!.template).title).toBe('Water plants');
  });

  it('makes later Occurrences with the new title and never duplicates the ones already made', () => {
    const after = run(dailyTask(), { type: 'renameTask', id: idOn('daily', '2026-11-18'), title: 'Water the ferns', scope: 'following' });

    const more = run(after, { type: 'materialise', dates: [...DAYS, '2026-11-21'] });

    expect(more.tasks).toHaveLength(6);
    expect(taskTitles(more)['2026-11-21']).toBe('Water the ferns');
  });

  it('keeps every Occurrence linked to its series, so the ↻ marker stays', () => {
    const after = run(dailyTask(), { type: 'renameTask', id: idOn('daily', '2026-11-18'), title: 'Water the ferns', scope: 'following' });

    expect(after.tasks.every((t) => t.series_id !== null)).toBe(true);
    expect(dayView(after, '2026-11-19', MON_10_15).anytime.items[0]).toMatchObject({ title: 'Water the ferns', recurring: true, recurrence: 'daily' });
  });

  it('never changes Occurrences that are done or Skipped, nor ones on earlier days', () => {
    let state = dailyTask();
    state = run(state, { type: 'tickTask', id: idOn('daily', '2026-11-19') });
    state = {
      ...state,
      tasks: state.tasks.map((t) => (t.id === idOn('daily', '2026-11-20') ? { ...t, skipped_at: '2026-11-21T00:00:00+01:00' } : t)),
    };
    state = run(state, { type: 'tickTask', id: idOn('daily', '2026-11-16') });
    const before = structuredClone(state.tasks);

    const after = run(state, { type: 'renameTask', id: idOn('daily', '2026-11-17'), title: 'Water the ferns', scope: 'following' });

    expect(taskTitles(after)).toEqual({
      '2026-11-16': 'Water plants',
      '2026-11-17': 'Water the ferns',
      '2026-11-18': 'Water the ferns',
      '2026-11-19': 'Water plants',
      '2026-11-20': 'Water plants',
    });
    for (const id of [idOn('daily', '2026-11-16'), idOn('daily', '2026-11-19'), idOn('daily', '2026-11-20')]) {
      expect(after.tasks.find((t) => t.id === id)).toEqual(before.find((t) => t.id === id));
    }
  });

  it('does not touch a deleted Occurrence, and it stays gone', () => {
    const state = run(dailyTask(), { type: 'deleteTask', id: idOn('daily', '2026-11-19'), scope: 'one' });
    const after = run(state, { type: 'renameTask', id: idOn('daily', '2026-11-17'), title: 'Water the ferns', scope: 'following' });

    expect(after.tasks.find((t) => t.id === idOn('daily', '2026-11-19'))).toMatchObject({ title: 'Water plants', deleted_at: MON_10_15 });
    expect(apply(after, { type: 'materialise', dates: ['2026-11-19'] }, MON_10_15).inserts).toEqual([]);
  });

  it('renames a hand-moved Occurrence too, keeps it linked and makes no duplicate on its original day', () => {
    const state = handMoved(dailyTask(), idOn('daily', '2026-11-19'), '2026-11-20');
    const after = run(state, { type: 'renameTask', id: idOn('daily', '2026-11-18'), title: 'Water the ferns', scope: 'following' });

    expect(after.tasks.find((t) => t.id === idOn('daily', '2026-11-19'))).toMatchObject({
      title: 'Water the ferns',
      date: '2026-11-20',
      occurrence_date: '2026-11-19',
    });
    expect(run(after, { type: 'materialise', dates: ['2026-11-19'] }).tasks).toHaveLength(5);
  });

  it('changes nothing when the title is the same or empty', () => {
    const state = dailyTask();
    const id = idOn('daily', '2026-11-18');

    expect(apply(state, { type: 'renameTask', id, title: 'Water plants', scope: 'following' }, MON_10_15)).toEqual(NOTHING);
    expect(apply(state, { type: 'renameTask', id, title: '  ', scope: 'following' }, MON_10_15)).toEqual(NOTHING);
  });

  it('is a plain rename for a one-off Task, whatever the scope', () => {
    const state = run(dailyTask(), { type: 'addTask', id: 'one', title: 'Pay rent', date: '2026-11-16' });

    const after = run(state, { type: 'renameTask', id: 'one', title: 'Pay the rent', scope: 'following' });

    expect(after.series).toHaveLength(1);
    expect(after.tasks.find((t) => t.id === 'one')?.title).toBe('Pay the rent');
  });
});

describe('Two devices making the same This and following edit', () => {
  it('write the same new segment and the same rows', () => {
    const cmd = { type: 'renameTask', id: idOn('daily', '2026-11-18'), title: 'Water the ferns', scope: 'following' } as const;

    const phone = run(dailyTask(), cmd);
    const desktop = run(dailyTask(), cmd);

    expect(phone.series.map((s) => s.id).sort()).toEqual(desktop.series.map((s) => s.id).sort());
    expect(phone.series.map((s) => s.id)).toContain(splitSeriesId('daily', '2026-11-18'));
  });
});

describe('Rename again from an earlier Occurrence', () => {
  it('still reaches every later Occurrence, including the ones split off by an earlier edit', () => {
    let state = run(dailyTask(), { type: 'renameTask', id: idOn('daily', '2026-11-19'), title: 'Water the ferns', scope: 'following' });
    state = run(state, { type: 'renameTask', id: idOn('daily', '2026-11-18'), title: 'Mist the ferns', scope: 'following' });

    const after = run(state, { type: 'renameTask', id: idOn('daily', '2026-11-17'), title: 'Prune the ferns', scope: 'following' });

    expect(taskTitles(after)).toEqual({
      '2026-11-16': 'Water plants',
      '2026-11-17': 'Prune the ferns',
      '2026-11-18': 'Prune the ferns',
      '2026-11-19': 'Prune the ferns',
      '2026-11-20': 'Prune the ferns',
    });
    expect(lineageOf(after, 'daily').map((s) => [s.starts_on, s.ends_on, JSON.parse(s.template).title])).toEqual([
      ['2026-11-16', '2026-11-16', 'Water plants'],
      ['2026-11-17', '2026-11-17', 'Prune the ferns'],
      ['2026-11-18', '2026-11-18', 'Prune the ferns'],
      ['2026-11-19', null, 'Prune the ferns'],
    ]);
    expect(taskTitles(run(after, { type: 'materialise', dates: ['2026-11-21'] }))['2026-11-21']).toBe('Prune the ferns');
  });
});
