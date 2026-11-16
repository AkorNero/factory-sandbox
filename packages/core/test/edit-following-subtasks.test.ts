import { describe, expect, it } from 'vitest';
import { apply, applyChanges, occurrenceSubtaskId, type State } from '../src/index.ts';
import { MON_10_15 } from './helpers.ts';
import { dailyTask, idOn, lineageOf, run } from './series-fixtures.ts';

const chores = () => dailyTask({ id: 'chores', template: { title: 'Clean flat', subtasks: [{ key: 'k1', title: 'Hoover' }, { key: 'k2', title: 'Bins' }] } });
const parent = (date: string) => idOn('chores', date);
const sub = (date: string, key: string) => occurrenceSubtaskId(parent(date), key);
const subsOn = (state: State, date: string) =>
  state.tasks
    .filter((t) => t.parent_id === parent(date) && !t.deleted_at)
    .sort((a, b) => a.position - b.position)
    .map((t) => t.title);
const templateSubs = (state: State) => lineageOf(state, 'chores').map((s) => (JSON.parse(s.template).subtasks as { key: string; title: string }[]).map((x) => x.title));

describe('+ Sub-task on an Occurrence', () => {
  it('"Just this one" adds it to that Occurrence only', () => {
    const after = run(chores(), { type: 'addSubtask', id: 'new', parentId: parent('2026-11-18'), title: 'Dust', scope: 'one' });

    expect(subsOn(after, '2026-11-18')).toEqual(['Hoover', 'Bins', 'Dust']);
    expect(subsOn(after, '2026-11-19')).toEqual(['Hoover', 'Bins']);
    expect(after.series).toHaveLength(1);
  });

  it('"This and following" adds it to this and every later open Occurrence, and to what is made later', () => {
    let state = run(chores(), { type: 'tickTask', id: parent('2026-11-19') });
    state = run(state, { type: 'addSubtask', id: 'new', parentId: parent('2026-11-18'), title: 'Dust', scope: 'following' });

    expect(subsOn(state, '2026-11-17')).toEqual(['Hoover', 'Bins']);
    expect(subsOn(state, '2026-11-18')).toEqual(['Hoover', 'Bins', 'Dust']);
    expect(subsOn(state, '2026-11-19')).toEqual(['Hoover', 'Bins']); // done: never changed
    expect(subsOn(state, '2026-11-20')).toEqual(['Hoover', 'Bins', 'Dust']);
    expect(templateSubs(state)).toEqual([['Hoover', 'Bins'], ['Hoover', 'Bins', 'Dust']]);

    const later = run(state, { type: 'materialise', dates: ['2026-11-21'] });
    const made = later.tasks.find((t) => t.occurrence_date === '2026-11-21' && !t.parent_id)!;
    expect(later.tasks.filter((t) => t.parent_id === made.id).map((t) => t.title)).toEqual(['Hoover', 'Bins', 'Dust']);
  });

  it('gives the added Sub-task the same key in the opened and the later Occurrences, with ids fixed by Occurrence and key', () => {
    const after = run(chores(), { type: 'addSubtask', id: 'new', parentId: parent('2026-11-18'), title: 'Dust', scope: 'following' });

    const opened = after.tasks.find((t) => t.id === 'new')!;
    expect(opened).toMatchObject({ parent_id: parent('2026-11-18'), series_subtask_key: 'new' });
    expect(after.tasks.find((t) => t.id === occurrenceSubtaskId(parent('2026-11-19'), 'new'))).toMatchObject({
      title: 'Dust',
      parent_id: parent('2026-11-19'),
      series_subtask_key: 'new',
      completed_at: null,
    });
  });

  it('is run twice by two devices without a second copy of the Sub-task', () => {
    const state = chores();
    const cmd = { type: 'addSubtask', id: 'new', parentId: parent('2026-11-18'), title: 'Dust', scope: 'following' } as const;
    const phone = run(state, cmd);
    const desktop = run(state, cmd);

    expect(phone.tasks.map((t) => t.id).sort()).toEqual(desktop.tasks.map((t) => t.id).sort());
  });

  it('takes over the Placement of a later Task that had none of its own Sub-tasks', () => {
    const plain = dailyTask({ id: 'plain' });
    const placed = applyChanges(plain, {
      inserts: [],
      updates: [{ table: 'tasks', id: idOn('plain', '2026-11-19'), set: { event_id: 'work' } }],
      deletes: [],
    });
    const state = applyChanges(placed, { inserts: [{ table: 'events', row: { id: 'work', title: 'Work', date: '2026-11-19', start_time: '09:00', end_time: '10:00', series_id: null, occurrence_date: null, deleted_at: null, created_at: '', updated_at: '' } }], updates: [], deletes: [] });

    const after = run(state, { type: 'addSubtask', id: 'new', parentId: idOn('plain', '2026-11-18'), title: 'Step', scope: 'following' });

    const sub19 = after.tasks.find((t) => t.parent_id === idOn('plain', '2026-11-19'))!;
    expect(sub19).toMatchObject({ title: 'Step', event_id: 'work' });
    expect(after.tasks.find((t) => t.id === idOn('plain', '2026-11-19'))?.event_id).toBeNull();
  });
});

describe('Rename a Sub-task of an Occurrence', () => {
  it('"Just this one" renames it in that Occurrence only', () => {
    const after = run(chores(), { type: 'renameTask', id: sub('2026-11-18', 'k1'), title: 'Vacuum', scope: 'one' });

    expect(subsOn(after, '2026-11-18')).toEqual(['Vacuum', 'Bins']);
    expect(subsOn(after, '2026-11-19')).toEqual(['Hoover', 'Bins']);
  });

  it('"This and following" renames the same Sub-task in later Occurrences, never a ticked one', () => {
    let state = run(chores(), { type: 'tickTask', id: sub('2026-11-20', 'k1') });
    state = run(state, { type: 'renameTask', id: sub('2026-11-18', 'k1'), title: 'Vacuum', scope: 'following' });

    expect(subsOn(state, '2026-11-17')).toEqual(['Hoover', 'Bins']);
    expect(subsOn(state, '2026-11-18')).toEqual(['Vacuum', 'Bins']);
    expect(subsOn(state, '2026-11-19')).toEqual(['Vacuum', 'Bins']);
    expect(subsOn(state, '2026-11-20')).toEqual(['Hoover', 'Bins']);
    expect(templateSubs(state)).toEqual([['Hoover', 'Bins'], ['Vacuum', 'Bins']]);
  });

  it('keeps a Sub-task title that was changed by hand on another Sub-task', () => {
    let state = run(chores(), { type: 'renameTask', id: sub('2026-11-19', 'k2'), title: 'Recycling', scope: 'one' });
    state = run(state, { type: 'renameTask', id: sub('2026-11-18', 'k1'), title: 'Vacuum', scope: 'following' });

    expect(subsOn(state, '2026-11-19')).toEqual(['Vacuum', 'Recycling']);
  });
});

describe('Remove a Sub-task of an Occurrence', () => {
  it('"Just this one" removes it from that Occurrence only', () => {
    const after = run(chores(), { type: 'deleteTask', id: sub('2026-11-18', 'k1'), scope: 'one' });

    expect(subsOn(after, '2026-11-18')).toEqual(['Bins']);
    expect(subsOn(after, '2026-11-19')).toEqual(['Hoover', 'Bins']);
  });

  it('"This and following" removes it from this and later Occurrences and from what is made later, not from a done one', () => {
    let state = run(chores(), { type: 'tickTask', id: sub('2026-11-19', 'k1') });
    state = run(state, { type: 'deleteTask', id: sub('2026-11-18', 'k1'), scope: 'following' });

    expect(subsOn(state, '2026-11-17')).toEqual(['Hoover', 'Bins']);
    expect(subsOn(state, '2026-11-18')).toEqual(['Bins']);
    expect(subsOn(state, '2026-11-19')).toEqual(['Hoover', 'Bins']);
    expect(subsOn(state, '2026-11-20')).toEqual(['Bins']);
    expect(templateSubs(state)).toEqual([['Hoover', 'Bins'], ['Bins']]);
    const later = run(state, { type: 'materialise', dates: ['2026-11-21'] });
    const made = later.tasks.find((t) => t.occurrence_date === '2026-11-21' && !t.parent_id)!;
    expect(later.tasks.filter((t) => t.parent_id === made.id).map((t) => t.title)).toEqual(['Bins']);
  });

  it('"This and following" marks the Sub-tasks deleted and removes no row, so a stale device cannot make them again', () => {
    const state = chores();
    const changes = apply(state, { type: 'deleteTask', id: sub('2026-11-18', 'k1'), scope: 'following' }, MON_10_15);
    const after = applyChanges(state, changes);

    expect(changes.deletes).toEqual([]);
    expect(after.tasks.filter((t) => t.deleted_at).map((t) => t.id).sort()).toEqual(
      ['2026-11-18', '2026-11-19', '2026-11-20'].map((d) => sub(d, 'k1')).sort(),
    );
    // a device that has not seen the template change makes the later Occurrences' Sub-tasks again: the rows are still there
    const stale = run({ ...after, series: state.series }, { type: 'materialise', dates: ['2026-11-18', '2026-11-19', '2026-11-20'] });
    expect(stale.tasks.filter((t) => t.id === sub('2026-11-19', 'k1'))).toHaveLength(1);
    expect(stale.tasks.find((t) => t.id === sub('2026-11-19', 'k1'))?.deleted_at).not.toBeNull();
  });

  it('ticking a Sub-task never spreads to other Occurrences', () => {
    const after = run(chores(), { type: 'tickTask', id: sub('2026-11-18', 'k1') });

    expect(after.tasks.filter((t) => t.completed_at).map((t) => t.id)).toEqual([sub('2026-11-18', 'k1')]);
  });
});
