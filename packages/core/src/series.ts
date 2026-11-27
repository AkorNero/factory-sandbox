import { dateTask, findEvent, isDone, liveTask, setEventDay, nextPosition, subtasksOf } from './commands.ts';
import { addDays, today } from './dates.ts';
import { occurrenceId, occurrenceSubtaskId } from './ids.ts';
import { occurrenceDates } from './recurrence.ts';
import type { Changes, Command, DateStr, EventRow, Insert, Now, RecurrenceRule, SeriesRow, SeriesTemplate, State, TaskRow, Update } from './types.ts';
import { noChanges } from './types.ts';

export function parseTemplate(series: Pick<SeriesRow, 'template'>): SeriesTemplate {
  try {
    const t: unknown = JSON.parse(series.template);
    if (t && typeof t === 'object' && typeof (t as SeriesTemplate).title === 'string') return t as SeriesTemplate;
  } catch {
    // fall through to the empty template
  }
  return { title: '' };
}

/**
 * Make the Occurrences that fall on the days and do not exist yet. Existing means a row with the Occurrence's id
 * (deleted ones included, so a deleted Occurrence stays gone) or any row of the series' lineage that was made for that day
 * (an Occurrence that was moved keeps its original day, so no duplicate appears there).
 * The ids are fixed by series and day, so two devices doing this from their own state write the same rows.
 */
export function materialise(state: State, dates: DateStr[], now: Now): Changes {
  // a day is taken for the whole lineage: a split segment must not make a second Occurrence for a day another segment made
  const lineages = new Map(state.series.map((s) => [s.id, s.lineage_id]));
  const dayKey = (seriesId: string, date: DateStr) => `${lineages.get(seriesId) ?? seriesId}|${date}`;
  const taken = new Set<string>();
  for (const t of state.tasks) if (t.series_id && t.occurrence_date) taken.add(dayKey(t.series_id, t.occurrence_date));
  for (const e of state.events) if (e.series_id && e.occurrence_date) taken.add(dayKey(e.series_id, e.occurrence_date));
  const ids = new Set([...state.tasks.map((t) => t.id), ...state.events.map((e) => e.id)]);

  const inserts: Insert[] = [];
  let position = nextPosition(state);
  for (const date of [...new Set(dates)].sort()) {
    for (const series of state.series) {
      const id = occurrenceId(series.id, date);
      if (ids.has(id) || taken.has(dayKey(series.id, date)) || occurrenceDates(series, date, date).length === 0) continue;
      const template = parseTemplate(series);
      if (series.kind === 'event') {
        const row: EventRow = {
          id,
          title: template.title,
          date,
          start_time: template.start ?? '09:00',
          end_time: template.end ?? '10:00',
          series_id: series.id,
          occurrence_date: date,
          deleted_at: null,
          created_at: now,
          updated_at: now,
        };
        inserts.push({ table: 'events', row });
        continue;
      }
      const task = (over: Partial<TaskRow> & { id: string }): TaskRow => ({
        parent_id: null,
        title: '',
        date: null,
        event_id: null,
        completed_at: null,
        skipped_at: null,
        carried_over: false,
        carried_on: null,
        carried_from_event_id: null,
        position: position++,
        series_id: null,
        occurrence_date: null,
        series_subtask_key: null,
        deleted_at: null,
        created_at: now,
        updated_at: now,
        ...over,
      });
      inserts.push({ table: 'tasks', row: task({ id, title: template.title, date, series_id: series.id, occurrence_date: date }) });
      for (const sub of template.subtasks ?? []) {
        inserts.push({
          table: 'tasks',
          row: task({ id: occurrenceSubtaskId(id, sub.key), parent_id: id, title: sub.title, series_subtask_key: sub.key }),
        });
      }
    }
  }
  return { inserts, updates: [], deletes: [] };
}

/** Whether "Repeat…" is offered: an open Task or an Event (not a Sub-task, not a done Task) that does not already repeat. */
export function canRepeat(state: State, id: string): boolean {
  const task = liveTask(state, id);
  if (task) return !task.parent_id && !task.series_id && !isDone(state, task);
  const event = findEvent(state, id);
  return !!event && !event.series_id;
}

const isInt = (n: unknown, min: number, max: number): n is number => Number.isInteger(n) && (n as number) >= min && (n as number) <= max;

/**
 * Why a rule is not valid, in words the "Repeat…" picker can show; null when it is valid. This is the only place the
 * limits live: the commands refuse exactly what it rejects.
 */
export function checkRecurrence(r: RecurrenceRule): string | null {
  switch (r.rule) {
    case 'every_n_days':
      return isInt(r.interval, 1, 999) ? null : 'Use a whole number of days from 1 to 999.';
    case 'weekdays':
      if (r.weekdays.length === 0) return 'Pick at least one weekday.';
      if (!r.weekdays.every((d) => isInt(d, 1, 7))) return 'Pick weekdays from Monday to Sunday.';
      return isInt(r.everyWeeks ?? 1, 1, 52) ? null : 'Use a whole number of weeks from 1 to 52.';
    case 'day_of_month':
      return isInt(r.day, 1, 31) ? null : 'Pick a day from 1 to 31.';
  }
}

/** The series columns for a rule, or null when the rule is not valid. */
export function ruleColumns(r: RecurrenceRule): Pick<SeriesRow, 'rule' | 'interval_n' | 'weekdays' | 'day_of_month'> | null {
  if (checkRecurrence(r) !== null) return null;
  switch (r.rule) {
    case 'every_n_days':
      return { rule: r.rule, interval_n: r.interval, weekdays: null, day_of_month: null };
    case 'weekdays':
      return { rule: r.rule, interval_n: r.everyWeeks ?? 1, weekdays: JSON.stringify([...new Set(r.weekdays)].sort()), day_of_month: null };
    case 'day_of_month':
      return { rule: r.rule, interval_n: null, weekdays: null, day_of_month: r.day };
  }
}

/** Fold several changes to the same row into one update (so a row gets one PATCH). */
export function coalesce(updates: Update[]): Update[] {
  const byRow = new Map<string, Update>();
  for (const u of updates) {
    const key = `${u.table}|${u.id}`;
    const have = byRow.get(key);
    byRow.set(key, have ? { ...have, set: { ...have.set, ...u.set } } : u);
  }
  return [...byRow.values()];
}

/**
 * "Repeat…": the item becomes the first Occurrence of a new series, on the first matching day from its own day
 * (from today for a Someday Task, which is thereby dated; recurring Tasks are never in Someday). An item on a day the
 * rule skips is moved there like a drag would (Task: Placement cleared; Event: its placed Tasks come along).
 * An item whose day has passed stays a one-off and the series starts from today. Later Occurrences are made by `materialise`.
 */
export function setRecurrence(state: State, cmd: Extract<Command, { type: 'setRecurrence' }>, now: Now): Changes {
  const columns = ruleColumns(cmd.recurrence);
  if (!columns || state.series.some((s) => s.id === cmd.seriesId)) return noChanges();
  if (!canRepeat(state, cmd.id)) return noChanges();
  const task = liveTask(state, cmd.id);
  const event = task ? undefined : findEvent(state, cmd.id);

  const todayDate = today(now);
  const own = (task ? task.date : event!.date) ?? null;
  const linked = own === null || own >= todayDate;
  const base = linked && own ? own : todayDate;
  const subs = task ? subtasksOf(state, task.id).sort((a, b) => a.position - b.position) : [];
  const template: SeriesTemplate = task
    ? { title: task.title, subtasks: subs.map((s) => ({ key: s.id, title: s.title })) }
    : { title: event!.title, start: event!.start_time, end: event!.end_time };
  const draft: SeriesRow = {
    id: cmd.seriesId,
    lineage_id: cmd.seriesId,
    kind: task ? 'task' : 'event',
    ...columns,
    anchor_date: base,
    starts_on: base,
    ends_on: null,
    template: JSON.stringify(template),
    created_at: now,
    updated_at: now,
  };
  const first = occurrenceDates(draft, base, addDays(base, 800))[0];
  if (!first) return noChanges();
  const series: SeriesRow = { ...draft, starts_on: first };
  const inserts: Insert[] = [{ table: 'series', row: series }];
  if (!linked) return { inserts, updates: [], deletes: [] };

  const link = { series_id: series.id, occurrence_date: first, updated_at: now };
  const updates: Update[] = [];
  if (task) {
    if (task.date !== first) updates.push(...dateTask(state, task.id, first, now).updates);
    updates.push({ table: 'tasks', id: task.id, set: link });
    for (const s of subs) updates.push({ table: 'tasks', id: s.id, set: { series_subtask_key: s.id, updated_at: now } });
  } else {
    if (event!.date !== first) updates.push(...setEventDay(state, event!.id, first, now).updates);
    updates.push({ table: 'events', id: event!.id, set: link });
  }
  return { inserts, updates: coalesce(updates), deletes: [] };
}
