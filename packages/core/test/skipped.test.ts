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
