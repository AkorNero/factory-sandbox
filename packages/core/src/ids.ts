import { v5 } from 'uuid';
import type { DateStr } from './types.ts';

/** Fixed forever: changing it would change the id of every Occurrence already created. */
const OCCURRENCE_NS = 'b6f0e1a2-3c4d-5e6f-8a9b-0c1d2e3f4a5b';

/**
 * An Occurrence's id comes from its series and its day, so two offline devices that both create the Occurrence
 * for the same day write the same row (and per-column last write wins merges them), not two.
 */
export const occurrenceId = (seriesId: string, date: DateStr): string => v5(`${seriesId}|${date}`, OCCURRENCE_NS);

/** A Sub-task of an Occurrence: from the Occurrence's id and the series' Sub-task key. */
export const occurrenceSubtaskId = (occurrenceId: string, subtaskKey: string): string => v5(`${occurrenceId}|${subtaskKey}`, OCCURRENCE_NS);
