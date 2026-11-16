-- Day Planner schema. Runs once, as the postgres superuser, on an empty volume (docker-entrypoint-initdb.d).
-- The API integration tests load this same file into a throwaway Postgres.
--
-- Conventions
--   * ids are text UUIDs made on the client
--   * local dates are text 'YYYY-MM-DD', local times are text 'HH:MM' (no timezone conversion anywhere)
--   * timestamps are text too: ISO local date-time WITH its UTC offset, exactly as the client wrote it.
--     (timestamptz would normalise to UTC on the way back and lose the local clock time that
--     "Completion time" and its done-in Event depend on.)
--   * derived facts are never stored

CREATE TABLE events (
  id              text PRIMARY KEY,
  title           text NOT NULL,
  date            text NOT NULL,
  start_time      text NOT NULL,
  end_time        text NOT NULL,
  series_id       text,
  occurrence_date text,
  deleted_at      text,
  created_at      text NOT NULL,
  updated_at      text NOT NULL
);

-- Holds both Tasks and Sub-tasks.
CREATE TABLE tasks (
  id                 text PRIMARY KEY,
  parent_id          text,                  -- set for a Sub-task
  title              text NOT NULL,
  date               text,                  -- Tasks only; NULL = Someday
  event_id           text,                  -- the Placement; NULL = Unplaced; never set on a Task that has Sub-tasks
  completed_at       text,                  -- the Completion time; never set on a parent
  skipped_at         text,
  carried_over       boolean NOT NULL DEFAULT false,
  position           double precision NOT NULL DEFAULT 0,
  series_id          text,
  occurrence_date    text,
  series_subtask_key text,                  -- links a Sub-task to its series template entry
  deleted_at         text,
  created_at         text NOT NULL,
  updated_at         text NOT NULL
);
CREATE INDEX tasks_date_idx ON tasks (date);
CREATE INDEX tasks_event_idx ON tasks (event_id);
CREATE INDEX tasks_parent_idx ON tasks (parent_id);

-- One row per Recurrence segment.
CREATE TABLE series (
  id           text PRIMARY KEY,
  lineage_id   text NOT NULL,
  kind         text NOT NULL CHECK (kind IN ('task', 'event')),
  rule         text NOT NULL CHECK (rule IN ('every_n_days', 'weekdays', 'day_of_month')),
  interval_n   integer,                     -- every N days (or every N weeks for weekdays)
  weekdays     jsonb,                       -- e.g. [1,3,5]
  day_of_month integer,
  anchor_date  text NOT NULL,
  starts_on    text NOT NULL,
  ends_on      text,                        -- internal only, never shown as an end date
  template     jsonb NOT NULL,              -- title; Event times; Sub-task titles with stable keys
  created_at   text NOT NULL,
  updated_at   text NOT NULL
);

-- A saved bundle of Events, Tasks, Sub-tasks and the Placements between them.
CREATE TABLE routines (
  id         text PRIMARY KEY,
  name       text NOT NULL,
  body       jsonb NOT NULL,
  created_at text NOT NULL,
  updated_at text NOT NULL
);
