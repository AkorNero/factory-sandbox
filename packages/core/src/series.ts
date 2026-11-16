import { nextPosition } from './commands.ts';
import { occurrenceId, occurrenceSubtaskId } from './ids.ts';
import { occurrenceDates } from './recurrence.ts';
import type { Changes, Command, DateStr, EventRow, Insert, Now, SeriesRow, SeriesTemplate, State, TaskRow } from './types.ts';
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
 * (deleted ones included, so a deleted Occurrence stays gone) or any row of the series that was made for that day
 * (an Occurrence that was moved keeps its original day, so no duplicate appears there).
 * The ids are fixed by series and day, so two devices doing this from their own state write the same rows.
 */
export function materialise(state: State, dates: DateStr[], now: Now): Changes {
  const taken = new Set<string>();
  for (const t of state.tasks) if (t.series_id && t.occurrence_date) taken.add(`${t.series_id}|${t.occurrence_date}`);
  for (const e of state.events) if (e.series_id && e.occurrence_date) taken.add(`${e.series_id}|${e.occurrence_date}`);
  const ids = new Set([...state.tasks.map((t) => t.id), ...state.events.map((e) => e.id)]);

  const inserts: Insert[] = [];
  let position = nextPosition(state);
  for (const date of [...new Set(dates)].sort()) {
    for (const series of state.series) {
      const id = occurrenceId(series.id, date);
      if (ids.has(id) || taken.has(`${series.id}|${date}`) || occurrenceDates(series, date, date).length === 0) continue;
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

export function setRecurrence(_state: State, _cmd: Extract<Command, { type: 'setRecurrence' }>, _now: Now): Changes {
  return noChanges();
}
