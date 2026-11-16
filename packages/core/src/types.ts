/**
 * Shapes the planner core works with. Rows mirror the synced tables one to one
 * (see schema.ts). Dates are local calendar dates 'YYYY-MM-DD', times are local
 * clock times 'HH:MM', timestamps are ISO local date-times with their UTC offset.
 */

export type DateStr = string;
export type TimeStr = string;
/** "Now" as the injectable Clock reports it: local date-time with offset, e.g. 2026-11-16T10:15:00+01:00. */
export type Now = string;

export interface EventRow {
  id: string;
  title: string;
  date: DateStr;
  start_time: TimeStr;
  end_time: TimeStr;
  series_id: string | null;
  occurrence_date: DateStr | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Holds both Tasks and Sub-tasks (a Sub-task has parent_id set). */
export interface TaskRow {
  id: string;
  parent_id: string | null;
  title: string;
  /** Tasks only. null means Someday. */
  date: DateStr | null;
  /** The Placement. null means Unplaced. */
  event_id: string | null;
  /** The Completion time. */
  completed_at: string | null;
  skipped_at: string | null;
  carried_over: boolean;
  /** The day the midnight job last carried it over to (the banner lists these); null when never carried. */
  carried_on: DateStr | null;
  /** The Event whose Placement the first Carry-over cleared: it keeps showing a missed slot. */
  carried_from_event_id: string | null;
  position: number;
  series_id: string | null;
  occurrence_date: DateStr | null;
  series_subtask_key: string | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

export type RuleKind = 'every_n_days' | 'weekdays' | 'day_of_month';

export interface SeriesRow {
  id: string;
  lineage_id: string;
  kind: 'task' | 'event';
  rule: RuleKind;
  interval_n: number | null;
  /** JSON text, e.g. "[1,3]" (jsonb in Postgres arrives as text). */
  weekdays: string | null;
  day_of_month: number | null;
  anchor_date: DateStr;
  starts_on: DateStr;
  ends_on: DateStr | null;
  template: string;
  created_at: string;
  updated_at: string;
}

/** What the "Repeat…" picker produces: one of the three rules. Weekdays are ISO numbered, 1 = Monday ... 7 = Sunday. */
export type RecurrenceRule =
  | { rule: 'every_n_days'; interval: number }
  | { rule: 'weekdays'; weekdays: number[]; /** every N weeks, 1 when left out */ everyWeeks?: number }
  | { rule: 'day_of_month'; day: number };

/** What a series stores (as JSON text in `template`) to make each Occurrence from. */
export interface SeriesTemplate {
  title: string;
  /** Event series only. */
  start?: TimeStr;
  end?: TimeStr;
  /** Task series only: each Sub-task with a key that stays the same through edits. */
  subtasks?: { key: string; title: string }[];
}

export interface RoutineRow {
  id: string;
  name: string;
  body: string;
  created_at: string;
  updated_at: string;
}

export interface Tables {
  events: EventRow;
  tasks: TaskRow;
  series: SeriesRow;
  routines: RoutineRow;
}
export type TableName = keyof Tables;

export interface State {
  events: EventRow[];
  tasks: TaskRow[];
  series: SeriesRow[];
  routines: RoutineRow[];
}

export const emptyState = (): State => ({ events: [], tasks: [], series: [], routines: [] });

/** The core's output: changed rows. An update lists only the columns that change (it becomes a PATCH). */
export type Insert = { [T in TableName]: { table: T; row: Tables[T] } }[TableName];
export interface Update {
  table: TableName;
  id: string;
  set: Record<string, unknown>;
}
export interface Delete {
  table: TableName;
  id: string;
}
export interface Changes {
  inserts: Insert[];
  updates: Update[];
  deletes: Delete[];
}
export const noChanges = (): Changes => ({ inserts: [], updates: [], deletes: [] });

/**
 * How far a menu edit on an Occurrence reaches: just that Occurrence, or it and every later one. There is no
 * "Whole series". The UI asks for it on every menu edit of an Occurrence; ticking and dragging never carry one.
 * Left out, or on anything that is not an Occurrence, an edit is "Just this one".
 */
export type Scope = 'one' | 'following';

/** Commands in. Ids are made by the caller (UUIDs), which keeps the core pure. */
export type Command =
  | {
      type: 'addTask';
      id: string;
      title: string;
      /** null adds a Someday Task. */
      date: DateStr | null;
      /** Adds the Task already placed in this Event; it then takes the Event's day. */
      eventId?: string;
    }
  /** Add a Sub-task to a Task. A Sub-task never has Sub-tasks, and has no day of its own. */
  | { type: 'addSubtask'; id: string; parentId: string; title: string; scope?: Scope }
  | { type: 'addEvent'; id: string; title: string; date: DateStr; start: TimeStr; end: TimeStr }
  | { type: 'renameEvent'; id: string; title: string; scope?: Scope }
  | { type: 'setEventTimes'; id: string; start: TimeStr; end: TimeStr; scope?: Scope }
  | { type: 'deleteEvent'; id: string; scope?: Scope }
  /** Move an Event to another day; the Tasks placed in it come along, still placed. */
  | { type: 'moveEvent'; id: string; date: DateStr }
  /** Place a Task or Sub-task into an Event (a Task takes the Event's day). */
  | { type: 'placeTask'; id: string; eventId: string }
  /** Take it out of its Event, keeping its day. */
  | { type: 'unplaceTask'; id: string }
  /** Send a Task to Someday: it loses its date and its Placement. */
  | { type: 'undateTask'; id: string }
  /**
   * Give a Task a day ("Do today" is today's date, a drop on a day chip or on Anytime is the day shown); its
   * Placement is cleared. A Sub-task has no day of its own.
   */
  | { type: 'dateTask'; id: string; date: DateStr }
  | { type: 'tickTask'; id: string }
  | { type: 'untickTask'; id: string }
  /** Edit a done Task's Completion time to `time` ('HH:MM') on the day it already has. */
  | { type: 'setCompletionTime'; id: string; time: TimeStr }
  /** A Sub-task of an Occurrence takes its scope the same way: "this and following" renames the same Sub-task in later Occurrences. */
  | { type: 'renameTask'; id: string; title: string; scope?: Scope }
  | { type: 'deleteTask'; id: string; scope?: Scope }
  /**
   * Set a Recurrence on a Task or Event (not a Sub-task, a done Task, or one that already recurs). The item becomes
   * the first Occurrence, on the first matching day from its own day (from today for a Someday Task, which is then dated).
   * `seriesId` is made by the caller.
   */
  | { type: 'setRecurrence'; id: string; seriesId: string; recurrence: RecurrenceRule }
  /**
   * "Change schedule" on an open Occurrence (always "this and following"): every later Occurrence, hand-edited ones
   * included, is removed and rebuilt on the new rule, which starts from this Occurrence. Items placed in a removed Event
   * Occurrence become unplaced but keep their day. Done and Skipped Occurrences and earlier days are never changed.
   * `seriesId` is the new segment's id, made by the caller.
   */
  | { type: 'changeSchedule'; id: string; seriesId: string; recurrence: RecurrenceRule }
  /** "Stop repeating" on an open Occurrence: it stays as a plain one-off and the later Occurrences are removed. */
  | { type: 'stopRepeating'; id: string }
  /** Make the Occurrences that fall on these days and do not exist yet. The UI asks for the days it is about to show. */
  | { type: 'materialise'; dates: DateStr[] }
  /**
   * The midnight jobs, run on every device at local midnight and on the first start after a missed one.
   * Today is the date of `now`; the result does not depend on the time of day, so two devices agree.
   */
  | { type: 'runMidnight' };
