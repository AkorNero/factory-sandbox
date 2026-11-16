import { apply, applyChanges, occurrenceId, type Command, type State } from '../src/index.ts';
import { MON_10_15, aSeries, aState } from './helpers.ts';

export const run = (state: State, command: Command, now = MON_10_15) => applyChanges(state, apply(state, command, now));

export const DAYS = ['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20'];

/** A daily Task series from Monday 16 November with its Occurrences made for Mon–Fri. */
export function dailyTask(over: { template?: object; id?: string } = {}): State {
  const id = over.id ?? 'daily';
  const series = aSeries({ id, template: JSON.stringify(over.template ?? { title: 'Water plants', subtasks: [] }) });
  return run(aState({ series: [series] }), { type: 'materialise', dates: DAYS });
}

/** A daily Event series from Monday 16 November with its Occurrences made for Mon–Fri. */
export function dailyEvent(over: { template?: object; id?: string } = {}): State {
  const id = over.id ?? 'gym';
  const series = aSeries({ id, kind: 'event', template: JSON.stringify(over.template ?? { title: 'Gym', start: '18:00', end: '19:00' }) });
  return run(aState({ series: [series] }), { type: 'materialise', dates: DAYS });
}

/** The id of the Occurrence a series first made for the day (later segments of a lineage make other ids). */
export const idOn = (seriesId: string, date: string) => occurrenceId(seriesId, date);

export const taskTitles = (state: State) =>
  Object.fromEntries(state.tasks.filter((t) => !t.parent_id && !t.deleted_at).map((t) => [t.occurrence_date, t.title]));

export const lineageOf = (state: State, lineageId: string) =>
  state.series.filter((s) => s.lineage_id === lineageId).sort((a, b) => a.starts_on.localeCompare(b.starts_on) || a.id.localeCompare(b.id));

export const NOTHING = { inserts: [], updates: [], deletes: [] };
