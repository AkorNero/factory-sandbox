/**
 * Column lists of the four synced tables, as the client's PowerSync schema sees them
 * (powersync columns are text / integer / real; the id column is implicit).
 * The Postgres DDL in infra/postgres/init/02-schema.sql must list the same columns:
 * an API test compares the two.
 */
export type ColumnType = 'text' | 'integer' | 'real';

export const SCHEMA = {
  events: {
    title: 'text',
    date: 'text',
    start_time: 'text',
    end_time: 'text',
    series_id: 'text',
    occurrence_date: 'text',
    deleted_at: 'text',
    created_at: 'text',
    updated_at: 'text',
  },
  tasks: {
    parent_id: 'text',
    title: 'text',
    date: 'text',
    event_id: 'text',
    completed_at: 'text',
    skipped_at: 'text',
    carried_over: 'integer',
    carried_on: 'text',
    carried_from_event_id: 'text',
    position: 'real',
    series_id: 'text',
    occurrence_date: 'text',
    series_subtask_key: 'text',
    deleted_at: 'text',
    created_at: 'text',
    updated_at: 'text',
  },
  series: {
    lineage_id: 'text',
    kind: 'text',
    rule: 'text',
    interval_n: 'integer',
    weekdays: 'text',
    day_of_month: 'integer',
    anchor_date: 'text',
    starts_on: 'text',
    ends_on: 'text',
    template: 'text',
    created_at: 'text',
    updated_at: 'text',
  },
  routines: {
    name: 'text',
    body: 'text',
    created_at: 'text',
    updated_at: 'text',
  },
} as const satisfies Record<string, Record<string, ColumnType>>;
