import { emptyState, type EventRow, type SeriesRow, type State, type TaskRow } from '../src/index.ts';

/** Local "now" the way the Clock supplies it: local date and time with the UTC offset. */
export const MON_10_15 = '2026-11-16T10:15:00+01:00';
export const TODAY = '2026-11-16';

export function aTask(over: Partial<TaskRow> & { id: string }): TaskRow {
  return {
    parent_id: null,
    title: 'A task',
    date: TODAY,
    event_id: null,
    completed_at: null,
    skipped_at: null,
    carried_over: false,
    position: 0,
    series_id: null,
    occurrence_date: null,
    series_subtask_key: null,
    deleted_at: null,
    created_at: '2026-11-15T09:00:00+01:00',
    updated_at: '2026-11-15T09:00:00+01:00',
    ...over,
  };
}

export function anEvent(over: Partial<EventRow> & { id: string }): EventRow {
  return {
    title: 'An event',
    date: TODAY,
    start_time: '09:00',
    end_time: '10:00',
    series_id: null,
    occurrence_date: null,
    deleted_at: null,
    created_at: '2026-11-15T09:00:00+01:00',
    updated_at: '2026-11-15T09:00:00+01:00',
    ...over,
  };
}

export function aState(parts: Partial<State> = {}): State {
  return { ...emptyState(), ...parts };
}

/** A Task series that repeats daily from today; override the rule fields per test. */
export function aSeries(over: Partial<SeriesRow> & { id: string }): SeriesRow {
  return {
    lineage_id: over.id,
    kind: 'task',
    rule: 'every_n_days',
    interval_n: 1,
    weekdays: null,
    day_of_month: null,
    anchor_date: TODAY,
    starts_on: TODAY,
    ends_on: null,
    template: JSON.stringify({ title: 'Water plants', subtasks: [] }),
    created_at: '2026-11-15T09:00:00+01:00',
    updated_at: '2026-11-15T09:00:00+01:00',
    ...over,
  };
}
